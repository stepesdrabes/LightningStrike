// node bench/drumeval/convert-drumloop101.ts [--source=bench/corpus/downloads/drumloop101/sample] [--tracks=150]
// The 101-200 Drum Loop Dataset (Yi and Barthet 2026, CC BY 4.0): drum machine one-shots sequenced
// from the 101 Drum Machine Patterns book and rendered with per-track effects, a master bus and
// loudness normalisation. Its step vectors give the onsets exactly.
//
// This is a second synthetic electronic set built by other people from the same kind of material,
// so it answers a question our own renderer cannot: whether a model trained on ours generalises to
// electronic drums it has not seen, or only to our way of making them. Benchmark only.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DrumClass, DrumEvent } from './corpus.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = resolve(flag('source')
	?? join(import.meta.dirname, '..', 'corpus', 'downloads', 'drumloop101', 'sample'));
const wanted = Number(flag('tracks') ?? 150);
const OUT = resolve(join(import.meta.dirname, '..', 'corpus', 'drumloop101'));
const seconds = Number(flag('seconds') ?? 24);
const RATE = 44100;
const SRC = join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src');
const { decodeAudio } = await import(pathToFileURL(join(SRC, 'decode.ts')).href);

/** A loop of four seconds tells a beat tracker and a separator nothing, so each is repeated. */
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

interface SeqParams {
	kick_step_vector: string;
	snare_step_vector: string;
	hh_step_vector: string;
	tempo: number;
	beat_type: string;
	kick_swing_amount: string;
	snare_swing_amount: string;
	hh_swing_amount: string;
}

const CLASS_OF: Record<string, DrumClass> = { kick: 'kick', snare: 'snare', hh: 'hat' };

function findParams(root: string): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) walk(path);
			else if (entry === 'seq_params.json') out.push(path);
		}
	};
	walk(root);
	return out.sort();
}

/** 16-bit WAV header only: the length in seconds, without decoding. */
function wavSeconds(path: string): number {
	const head = readFileSync(path).subarray(0, 64);
	const rate = head.readUInt32LE(24);
	const bytes = statSync(path).size - 44;
	const channels = head.readUInt16LE(22);
	const bits = head.readUInt16LE(34);
	return bytes / Math.max(1, rate * channels * (bits / 8));
}

if (!existsSync(source)) throw new Error(`no extracted loops at ${source}`);
mkdirSync(join(OUT, 'audio'), { recursive: true });
const tracks: unknown[] = [];
let events = 0;

for (const path of findParams(source).slice(0, wanted)) {
	const dir = dirname(path);
	const file = readdirSync(dir).find((f) => f.endsWith('_tiled.wav'));
	if (!file) continue;
	const params = JSON.parse(readFileSync(path, 'utf8')) as SeqParams;
	const steps = params.kick_step_vector.trim().split(/\s+/).length;
	// A step is a sixteenth, whatever `beat_type` says. Read as eighths, 53% of the strong attacks
	// in the audio have no label near them and snare labels land on 94% of their own attacks; as
	// sixteenths those become 14% and 99.9%.
	const perBeat = Number(flag('steps-per-beat')) || 4;
	const step = 60 / params.tempo / perBeat;
	const pattern = steps * step;
	// Every render is cut to a flat four seconds, so the last repeat is usually partial and its
	// hits still sound. Round up and let the length test drop what falls past the end.
	const rendered = wavSeconds(join(dir, file));
	const repeats = Math.max(1, Math.ceil(rendered / pattern));

	const list: DrumEvent[] = [];
	for (const [key, cls] of Object.entries(CLASS_OF)) {
		const vector = (params as unknown as Record<string, string>)[`${key}_step_vector`].trim().split(/\s+/);
		const swing = Number((params as unknown as Record<string, string>)[`${key}_swing_amount`] ?? 0);
		vector.forEach((on, i) => {
			if (on !== '1') return;
			// Swing delays the off-steps by that fraction of a step, as the renderer does.
			const offset = i % 2 === 1 ? swing * step : 0;
			for (let r = 0; r < repeats; r++) {
				const time = r * pattern + i * step + offset;
				if (time < rendered) list.push({ time: +time.toFixed(6), cls });
			}
		});
	}
	if (!list.length) continue;
	list.sort((a, b) => a.time - b.time);
	const name = basename(dirname(dir));
	const decoded = await decodeAudio(join(dir, file), RATE);
	const cycles = Math.max(1, Math.ceil(seconds / decoded.duration));
	const looped = new Float32Array(decoded.mono.length * cycles);
	const full: DrumEvent[] = [];
	for (let c = 0; c < cycles; c++) {
		looped.set(decoded.mono, c * decoded.mono.length);
		for (const e of list) full.push({ ...e, time: +(e.time + c * decoded.duration).toFixed(6) });
	}
	writeFileSync(join(OUT, 'audio', `${name}.wav`), wav(looped, RATE));
	tracks.push({ name, audio: `audio/${name}.wav`, genre: 'electronic', events: full });
	events += full.length;
}

writeFileSync(join(OUT, 'tracks.json'), JSON.stringify({
	corpus: 'drumloop101', labeled: true, heldOut: true, classes: ['kick', 'snare', 'hat'],
	source: 'the 101-200 Drum Loop Dataset, AudioEFX and loudness normalised condition (CC BY 4.0)',
	tracks
}));
console.log(`${tracks.length} loops, ${events} events -> ${OUT}`);
