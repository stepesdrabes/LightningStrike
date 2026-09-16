// node bench/annotate/prepare.ts [--corpus=library] [--run=lib-v19] [--clips=30] [--seconds=24]
//   [--only=ID,ID] [--genres=hiphop,house]
// Cuts annotation clips from prepared drumeval evidence: the mix, the four separated sources, the
// beat grid, what the --run run emitted and a high-recall proposal set for the owner to confirm.
// Writes bench/reports/annotate/clips/<id>/ for bench/annotate/server.ts.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tracks, type CorpusTrack } from '../drumeval/corpus.ts';
import { proposals, readProposalInputs, SOURCES, type Proposal, type Source } from './proposals.ts';
import { EVAL_ROOT, evidenceDir, files, readJson, type AudioRecord, type BeatsRecord } from '../drumeval/evidence.ts';

/** 16-bit mono WAV, the format the annotator's decoder reads back. */
function wav(mono: Float32Array, rate: number): Buffer {
	const body = Buffer.alloc(mono.length * 2);
	for (let i = 0; i < mono.length; i++) {
		body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mono[i])) * 32767), i * 2);
	}
	const head = Buffer.alloc(44);
	head.write('RIFF', 0);
	head.writeUInt32LE(36 + body.length, 4);
	head.write('WAVEfmt ', 8);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(1, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * 2, 28);
	head.writeUInt16LE(2, 32);
	head.writeUInt16LE(16, 34);
	head.write('data', 36);
	head.writeUInt32LE(body.length, 40);
	return Buffer.concat([head, body]);
}

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const corpusName = flag('corpus') ?? 'library';
const wanted = Number(flag('clips') ?? 30);
const seconds = Number(flag('seconds') ?? 24);
const only = flag('only')?.split(',');
const runLabel = flag('run') ?? 'lib-v19';
const genres = flag('genres')?.split(',');
const OUT = join(EVAL_ROOT, '..', 'annotate');
const SRC = join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src');
const RATE = 22050;
const load = async (file: string) => import(pathToFileURL(join(SRC, file)).href);
const { decodeAudio } = await load('decode.ts');

function window(proposalsByKind: Record<Source, Proposal[]>, downbeats: number[], duration: number): number {
	const marks = SOURCES.flatMap((k) => proposalsByKind[k].map((p) => p.t)).sort((a, b) => a - b);
	const starts = downbeats.filter((t) => t >= Math.min(20, duration * 0.15) && t + seconds <= duration - 1);
	if (!starts.length) return Math.max(0, Math.min(duration * 0.35, duration - seconds - 1));
	let best = starts[0];
	let bestCount = -1;
	for (const start of starts) {
		let count = 0;
		for (const t of marks) if (t >= start && t < start + seconds) count++;
		if (count > bestCount) {
			bestCount = count;
			best = start;
		}
	}
	return best;
}

function cut(audio: Float32Array, rate: number, start: number, length: number): Float32Array {
	const from = Math.max(0, Math.round(start * rate));
	return audio.subarray(from, Math.min(audio.length, from + Math.round(length * rate)));
}

/** What the installed model emitted for this track, from an evaluate.ts run, or nothing. */
function emitted(track: CorpusTrack): Record<string, number[]> | null {
	const path = join(EVAL_ROOT, 'runs', runLabel, 'tracks', `${track.corpus}__${track.name}.json`);
	const result = readJson<{ classes?: Record<string, { times: number[] }> }>(path);
	if (!result?.classes) return null;
	return Object.fromEntries(SOURCES.map((k) => [k, result.classes![k]?.times ?? []]));
}

const all = tracks([corpusName]).filter((t) => (!only || only.includes(t.name)) && (!genres || genres.includes(t.genre ?? '')));
// Spread the choice over genres so one crowded genre does not take every clip.
const byGenre = new Map<string, CorpusTrack[]>();
for (const track of all) {
	const list = byGenre.get(track.genre ?? 'other') ?? [];
	list.push(track);
	byGenre.set(track.genre ?? 'other', list);
}
const order: CorpusTrack[] = [];
for (let round = 0; order.length < all.length; round++) {
	for (const list of byGenre.values()) if (list[round]) order.push(list[round]);
}
const chosen = only ? order : order.slice(0, wanted);

mkdirSync(join(OUT, 'clips'), { recursive: true });
const index: unknown[] = [];
for (const track of chosen) {
	const dir = evidenceDir(track);
	if (!existsSync(join(dir, files.cymbal22))) {
		console.log(`skip ${track.name}: no evidence`);
		continue;
	}
	const audio = readJson<AudioRecord>(join(dir, files.audio))!;
	const beats = readJson<BeatsRecord>(join(dir, files.beats))!;
	const decoded = await decodeAudio(track.audio);
	if (decoded.hash !== audio.hash22) {
		console.log(`skip ${track.name}: stale evidence`);
		continue;
	}
	const inputs = readProposalInputs(dir);
	const proposed = Object.fromEntries(SOURCES.map((k) =>
		[k, proposals(k, inputs)])) as Record<Source, Proposal[]>;
	const start = window(proposed, beats.downbeats, decoded.duration);
	const end = start + seconds;
	const within = (times: number[]) => times.filter((t) => t >= start && t < end).map((t) => +(t - start).toFixed(4));

	const shipped = emitted(track);

	const id = `${track.corpus}__${track.name}`;
	const clipDir = join(OUT, 'clips', id);
	mkdirSync(clipDir, { recursive: true });
	writeFileSync(join(clipDir, 'mix.wav'), wav(cut(decoded.mono, RATE, start, seconds), RATE));
	for (const k of SOURCES) writeFileSync(join(clipDir, `${k}.wav`), wav(cut(inputs.sources[k], RATE, start, seconds), RATE));
	const clip = {
		id, corpus: track.corpus, track: track.name, title: (track as { title?: string }).title ?? track.name,
		artist: (track as { artist?: string }).artist ?? '', genre: track.genre ?? '',
		start, seconds, rate: RATE,
		beats: within(beats.beats), downbeats: within(beats.downbeats),
		striker: shipped ? Object.fromEntries(SOURCES.map((k) => [k, within(shipped[k])])) : {},
		proposals: Object.fromEntries(SOURCES.map((k) => [k, proposed[k]
			.filter((p) => p.t >= start && p.t < end)
			.map((p) => ({ t: +(p.t - start).toFixed(4), src: p.src, score: +p.score.toFixed(3) }))]))
	};
	writeFileSync(join(clipDir, 'clip.json'), JSON.stringify(clip));
	index.push({
		id, title: clip.title, artist: clip.artist, genre: clip.genre, seconds,
		proposals: SOURCES.reduce((n, k) => n + clip.proposals[k].length, 0)
	});
	console.log(`${id} ${clip.title.slice(0, 40)} @${start.toFixed(1)}s `
		+ SOURCES.map((k) => `${k[0]}${clip.proposals[k].length}`).join(' '));
}
writeFileSync(join(OUT, 'clips', 'index.json'), JSON.stringify(index, null, '\t'));
console.log(`\n${index.length} clips in ${join(OUT, 'clips')}`);
