// node bench/annotate/prepare.ts --corpus=library [--clips=30] [--only=ID,ID] [--genres=house,rock]
// node bench/annotate/prepare.ts --list=clips.json
//   [--seconds=30] [--align] [--floor=0.02] [--support=0.1] [--root=DIR] [--force]
// Cuts review clips from Striker 2.0's hearing of each whole song (hearing.ts: the settings' model in
// MV_MODEL_DIR, on the CPU, kept per audio). Per clip <root>/clips/<id>/ gets the mix as a 44.1 kHz
// mono WAV and clip.json: the beat grid, Striker's hits, the high-recall proposals and each class's
// onset probability. clips/index.json gains the clip. A clip somebody reviewed is never replaced.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import { tracks, type CorpusTrack } from '../drumeval/corpus.ts';
import { EVAL_ROOT } from '../drumeval/evidence.ts';
import { hearingWithHeads, stopHearing } from '../hearing.ts';
import { readClipList } from './cliplist.ts';
import {
	FLOOR, SUPPORT, alignedSeconds, cutClip, densestStart, proposals, wav16, type ClipMeta
} from './cut.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(flag('root') ?? join(EVAL_ROOT, '..', 'annotate'));
const seconds = Number(flag('seconds') ?? 30);
const align = args.includes('--align');
const floor = Number(flag('floor') ?? FLOOR);
const support = Number(flag('support') ?? SUPPORT);
const force = args.includes('--force');
const RATE = 44100;

interface Job {
	meta: ClipMeta;
	/** Absent for a library song: the window with the most proposals is cut. */
	start?: number;
	seconds: number;
	align: boolean;
	/** Library clips start from Striker's hits; validation clips from a list start empty. */
	prefill: boolean;
}

function libraryJobs(corpus: string): Job[] {
	const only = flag('only')?.split(',');
	const genres = flag('genres')?.split(',');
	const all = tracks([corpus]).filter((t) => (!only || only.includes(t.name))
		&& (!genres || genres.includes(t.genre ?? '')));
	// Spread the choice over genres so one crowded genre does not take every clip.
	const byGenre = new Map<string, CorpusTrack[]>();
	for (const track of all) {
		const genre = track.genre ?? 'other';
		byGenre.set(genre, [...byGenre.get(genre) ?? [], track]);
	}
	const order: CorpusTrack[] = [];
	for (let round = 0; order.length < all.length; round++) {
		for (const list of byGenre.values()) if (list[round]) order.push(list[round]);
	}
	const chosen = only ? order : order.slice(0, Number(flag('clips') ?? 30));
	return chosen.map((track) => {
		const named = track as CorpusTrack & { title?: string; artist?: string };
		return {
			meta: {
				id: '', corpus: track.corpus, track: track.name, title: named.title ?? track.name,
				artist: named.artist ?? '', genre: track.genre ?? '', tags: [], source: track.audio
			},
			seconds, align, prefill: true
		};
	});
}

function listJobs(path: string): Job[] {
	return readClipList(path).map((entry) => ({
		meta: {
			id: entry.id, corpus: 'file', track: basename(entry.file), title: entry.title,
			artist: entry.artist, genre: entry.genre, tags: entry.tags, source: entry.file
		},
		start: entry.start, seconds: entry.seconds ?? seconds, align: entry.align ?? align,
		prefill: entry.prefill
	}));
}

const list = flag('list');
const corpus = flag('corpus');
if (!list === !corpus) throw new Error('Give --corpus=library or --list=clips.json.');
const jobs = list ? listJobs(resolve(list)) : libraryJobs(corpus!);

const indexPath = join(root, 'clips', 'index.json');
const index: { id: string }[] = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
let made = 0;

for (const job of jobs) {
	const { meta } = job;
	if (!existsSync(meta.source)) {
		console.log(`skip ${meta.id || meta.track}: ${meta.source} is missing`);
		continue;
	}
	const wide = await decodeAudio(meta.source, RATE);
	const began = performance.now();
	const hearing = await hearingWithHeads(wide);
	const heardIn = (performance.now() - began) / 1000;
	const found = proposals(hearing.heads, hearing.model.drums.rules, floor);
	const start = job.start
		?? densestStart(hearing.heard.downbeats, found, wide.duration, job.seconds, support);
	if (start > wide.duration - 1) {
		console.log(`skip ${meta.id || meta.track}: it starts at ${start} s, `
			+ `the audio is ${wide.duration.toFixed(1)} s`);
		continue;
	}
	const length = job.align
		? alignedSeconds(hearing.heard.downbeats, start, job.seconds, wide.duration)
		: job.seconds;
	const id = meta.id || `${meta.corpus}__${meta.track}__${start.toFixed(1)}s`;
	const dir = join(root, 'clips', id);
	if (existsSync(join(root, 'annotations', `${id}.json`))) {
		console.log(`skip ${id}: it has a review, which a new cut would no longer match`);
		continue;
	}
	if (existsSync(dir) && !force) {
		console.log(`skip ${id}: it is already cut; --force cuts it again`);
		continue;
	}
	const { clip, mix } = cutClip({
		meta: { ...meta, id }, mono: wide.mono, rate: RATE, hearing, found, start, seconds: length,
		floor, support, prefill: job.prefill
	});
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'mix.wav'), wav16([mix], RATE));
	writeFileSync(join(dir, 'clip.json'), JSON.stringify(clip));
	const entry = {
		id, title: clip.title, artist: clip.artist, genre: clip.genre, seconds: clip.seconds,
		proposals: clip.classes.reduce((n, cls) => n + clip.proposals[cls].length, 0),
		...(clip.tags.length ? { tags: clip.tags } : {}),
		...(clip.tags.includes('heldOut') ? { heldOut: true } : {})
	};
	const at = index.findIndex((e) => e.id === id);
	if (at >= 0) index[at] = entry;
	else index.push(entry);
	made++;
	// Per class: Striker's hits, then the supported proposals it did not emit.
	console.log(`${id} @${clip.start.toFixed(3)} s for ${clip.seconds} s, heard in ${heardIn.toFixed(1)} s: `
		+ clip.classes.map((cls) => `${cls} ${clip.striker[cls].length}+${clip.proposals[cls]
			.filter((p) => p.score >= support && !clip.striker[cls].includes(p.t)).length}`).join(' '));
}

await stopHearing();
if (made) writeFileSync(indexPath, JSON.stringify(index, null, '\t'));
console.log(`\n${made} clips cut, ${index.length} in ${indexPath}`);
