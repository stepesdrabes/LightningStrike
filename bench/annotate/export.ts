// node bench/annotate/export.ts [--min-pages=1]
// Turns the saved annotations into the `owner` drumeval corpus: the clip's audio at full rate and
// one event per confirmed hit. Pages nobody confirmed are filled with `unreviewed` references so a
// detection there is neither credited nor counted, which lets partial reviews score honestly.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tracks, trackKey, type DrumEvent } from '../drumeval/corpus.ts';
import { EVAL_ROOT } from '../drumeval/evidence.ts';
import { buildPages } from './pages.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const minPages = Number(flag('min-pages') ?? 1);
const ROOT = join(EVAL_ROOT, '..', 'annotate');
const OUT = join(EVAL_ROOT, '..', '..', 'corpus', 'owner');
const SRC = join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src');
const RATE = 44100;
/** One unreviewed reference per this many seconds: dense enough to absorb any detection there. */
const FILLER_S = 0.02;
const CLASSES = ['kick', 'snare', 'hat', 'cymbal'] as const;

const { decodeAudio } = await import(pathToFileURL(join(SRC, 'decode.ts')).href);

function wav(left: Float32Array, right: Float32Array, rate: number): Buffer {
	const n = Math.min(left.length, right.length);
	const body = Buffer.alloc(n * 4);
	for (let i = 0; i < n; i++) {
		body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), i * 4);
		body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), i * 4 + 2);
	}
	const head = Buffer.alloc(44);
	head.write('RIFF', 0);
	head.writeUInt32LE(36 + body.length, 4);
	head.write('WAVEfmt ', 8);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(2, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * 4, 28);
	head.writeUInt16LE(4, 32);
	head.writeUInt16LE(16, 34);
	head.write('data', 36);
	head.writeUInt32LE(body.length, 40);
	return Buffer.concat([head, body]);
}

interface Annotation {
	id: string;
	corpus: string;
	track: string;
	title: string;
	genre: string;
	start: number;
	seconds: number;
	hits: Record<string, number[]>;
	confirmed: number[];
	reviewed?: boolean;
}

const saved = join(ROOT, 'annotations');
if (!existsSync(saved)) throw new Error(`no annotations in ${saved}`);
mkdirSync(join(OUT, 'audio'), { recursive: true });
const out: unknown[] = [];
let hits = 0;
let reviewedSeconds = 0;

for (const file of readdirSync(saved).filter((f) => f.endsWith('.json')).sort()) {
	const annotation = JSON.parse(readFileSync(join(saved, file), 'utf8')) as Annotation;
	const clipPath = join(ROOT, 'clips', annotation.id, 'clip.json');
	if (!existsSync(clipPath)) {
		console.log(`skip ${annotation.id}: the clip is gone`);
		continue;
	}
	const clip = JSON.parse(readFileSync(clipPath, 'utf8')) as {
		beats: number[]; downbeats: number[]; seconds: number;
	};
	if ((annotation.confirmed?.length ?? 0) < minPages) continue;

	// Rebuild the pages the app drew, so a confirmed index means the same stretch of time.
	const pages = buildPages(clip) as { from: number; to: number }[];
	const confirmed = pages.filter((_, i) => (annotation.confirmed ?? []).includes(i) || annotation.reviewed);
	if (!confirmed.length) continue;
	const inside = (t: number) => confirmed.some((p) => t >= p.from && t < p.to);

	const source = tracks([`${annotation.corpus}:${annotation.track}`])
		.find((t) => trackKey(t) === `${annotation.corpus}/${annotation.track}`);
	if (!source) {
		console.log(`skip ${annotation.id}: the source track is gone`);
		continue;
	}
	const decoded = await decodeAudio(source.audio, RATE);
	const from = Math.round(annotation.start * RATE);
	const to = Math.min(decoded.left.length, from + Math.round(annotation.seconds * RATE));
	writeFileSync(join(OUT, 'audio', `${annotation.id}.wav`),
		wav(decoded.left.subarray(from, to), decoded.right.subarray(from, to), RATE));

	const events: DrumEvent[] = [];
	for (const cls of CLASSES) {
		for (const time of annotation.hits[cls] ?? []) {
			if (inside(time)) events.push({ time: +time.toFixed(4), cls });
		}
	}
	hits += events.length;
	for (let t = 0; t < annotation.seconds; t += FILLER_S) {
		if (inside(t)) continue;
		for (const cls of CLASSES) events.push({ time: +t.toFixed(4), cls, sub: 'unreviewed', optional: true });
	}
	events.sort((a, b) => a.time - b.time);
	reviewedSeconds += confirmed.reduce((sum, p) => sum + (p.to - p.from), 0);
	out.push({
		name: annotation.id, audio: `audio/${annotation.id}.wav`, genre: annotation.genre,
		title: annotation.title, events
	});
	console.log(`${annotation.id} ${confirmed.length}/${pages.length} pages, `
		+ CLASSES.map((c) => `${c[0]}${(annotation.hits[c] ?? []).filter(inside).length}`).join(' '));
}

writeFileSync(join(OUT, 'tracks.json'), JSON.stringify({
	corpus: 'owner', labeled: true, heldOut: true,
	source: 'bench/annotate, hand confirmed by the owner in the library the product plays',
	tracks: out
}));
console.log(`\n${out.length} clips, ${reviewedSeconds.toFixed(0)} s confirmed, ${hits} hits -> ${OUT}`);
