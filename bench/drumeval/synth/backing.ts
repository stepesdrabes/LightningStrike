// node bench/drumeval/synth/backing.ts [--corpus=library] [--tracks=60] [--seconds=150]
// Writes drum-free backing for the synthetic corpus: the decoded mix minus the cached HTDemucs drum
// stem, at 44.1 kHz stereo. The subtraction leaves some drum residue, so each backing also records
// the times the shipped pipeline heard drums there, per class; the renderer marks those as optional
// references rather than teaching the classifier that a real hit is a negative.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tracks } from '../corpus.ts';
import { EVAL_ROOT, evidenceDir, files, readF32, readJson, type AudioRecord } from '../evidence.ts';
import { proposals, readProposalInputs, SOURCES } from '../../annotate/proposals.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const corpusName = flag('corpus') ?? 'library';
const wanted = Number(flag('tracks') ?? 60);
const seconds = Number(flag('seconds') ?? 150);
const OUT = join(EVAL_ROOT, 'synth', 'backing');
const SRC = join(import.meta.dirname, '..', '..', '..', 'packages', 'analysis', 'src');
const RATE = 44100;

const { decodeAudio } = await import(pathToFileURL(join(SRC, 'decode.ts')).href);

/** 16-bit stereo WAV. */
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

mkdirSync(OUT, { recursive: true });
const index: unknown[] = [];
let written = 0;
for (const track of tracks([corpusName])) {
	if (written >= wanted) break;
	const dir = evidenceDir(track);
	if (!existsSync(join(dir, files.drumsStereo44))) continue;
	const audio = readJson<AudioRecord>(join(dir, files.audio))!;
	const decoded = await decodeAudio(track.audio, RATE);
	if (decoded.hash !== audio.hash44) {
		console.log(`skip ${track.name}: stale evidence`);
		continue;
	}
	const stereo = readF32(join(dir, files.drumsStereo44));
	const frames = Math.min(decoded.left.length, stereo.length / 2);
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	let drumEnergy = 0;
	let restEnergy = 0;
	for (let i = 0; i < frames; i++) {
		left[i] = decoded.left[i] - stereo[i];
		right[i] = decoded.right[i] - stereo[frames + i];
		drumEnergy += stereo[i] * stereo[i];
		restEnergy += left[i] * left[i];
	}
	// A backing that is mostly removed drums is residue, not accompaniment.
	if (restEnergy < drumEnergy * 0.25) {
		console.log(`skip ${track.name}: little outside the drums`);
		continue;
	}
	const start = Math.min(Math.max(0, frames / RATE - seconds - 1), 25);
	const from = Math.round(start * RATE);
	const to = Math.min(frames, from + Math.round(seconds * RATE));
	// Generous on purpose: an optional reference only withholds training signal, while a missed
	// residual drum would teach the classifier to reject a real hit.
	const inputs = readProposalInputs(dir);
	// Per class: a residual kick should withhold the kick class's signal, not every class's. Marking
	// them all at the union of four high-recall detectors covered most of a rendered track and left
	// the corpus unable to penalise a false positive.
	const inWindow = (times: number[]) => times
		.filter((t) => t >= start && t < to / RATE).map((t) => +(t - start).toFixed(4)).sort((a, b) => a - b);
	const residueBy = Object.fromEntries(SOURCES.map((k) =>
		[k, inWindow([...new Set(proposals(k, inputs).map((p) => p.t))])])) as Record<string, number[]>;
	const residue = inWindow([...new Set(SOURCES.flatMap((k) => proposals(k, inputs).map((p) => p.t)))]);

	writeFileSync(join(OUT, `${track.name}.wav`), wav(left.subarray(from, to), right.subarray(from, to), RATE));
	writeFileSync(join(OUT, `${track.name}.json`), JSON.stringify({
		name: track.name, title: (track as { title?: string }).title ?? track.name, genre: track.genre ?? '',
		start, seconds: (to - from) / RATE, residue, residueBy
	}));
	index.push({ name: track.name, genre: track.genre ?? '', seconds: (to - from) / RATE, residue: residue.length });
	written++;
	console.log(`${track.name} ${((to - from) / RATE).toFixed(0)} s, ${residue.length} residue marks`);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, '\t'));
console.log(`\n${written} backings in ${OUT}`);
