// node bench/drumeval/convert-fsl30.ts [--source=bench/corpus/downloads/fsl30] [--seconds=24]
// FSL-30 (Yi and Barthet 2026, CC BY 4.0): 30 Freesound loops hand annotated in Sonic Visualiser,
// ten each of house and techno, rock and hip-hop, and jungle and breakbeat. The audio comes from
// the Freesound Loop Dataset (Zenodo 3967852); two of the thirty are not in it.
//
// The loops run from 1.4 to 16 seconds, too short for a beat tracker or a separator to settle, so
// each is repeated a whole number of times to at least --seconds and its annotations repeat with
// it. That is how a loop is heard anyway, and it keeps the measurement about the drums rather than
// about the length of the file.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DrumClass, DrumEvent } from './corpus.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = resolve(flag('source') ?? join(import.meta.dirname, '..', 'corpus', 'downloads', 'fsl30'));
const seconds = Number(flag('seconds') ?? 24);
const OUT = resolve(join(import.meta.dirname, '..', 'corpus', 'fsl30'));
const SRC = join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src');
const RATE = 44100;

const { decodeAudio } = await import(pathToFileURL(join(SRC, 'decode.ts')).href);

const CLASS_OF: Record<string, DrumClass> = { KD: 'kick', SD: 'snare', HH: 'hat' };

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

/** `time<tab>KD,SD.HH`: simultaneous hits are separated by a comma or a full stop. */
function readAnnotation(path: string): { time: number; cls: DrumClass }[] {
	const out: { time: number; cls: DrumClass }[] = [];
	for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
		const match = /^\s*([0-9]*\.?[0-9]+)\s+(.*)$/.exec(line);
		if (!match) continue;
		const time = Number(match[1]);
		for (const label of match[2].split(/[,.]/)) {
			const cls = CLASS_OF[label.trim().toUpperCase()];
			if (cls) out.push({ time, cls });
		}
	}
	return out.sort((a, b) => a.time - b.time);
}

const annotations = join(source, 'annotation');
if (!existsSync(annotations)) throw new Error(`no FSL-30 annotations at ${annotations}`);
const audioFiles = readdirSync(join(source, 'audio'));
mkdirSync(join(OUT, 'audio'), { recursive: true });

const tracks: unknown[] = [];
let events = 0;
let missing = 0;
for (const file of readdirSync(annotations).filter((f) => f.endsWith('.txt')).sort()) {
	const id = file.split('_')[0];
	const audio = audioFiles.find((name) => name.startsWith(`${id}_`));
	if (!audio) {
		missing++;
		continue;
	}
	const marks = readAnnotation(join(annotations, file));
	if (!marks.length) {
		missing++;
		continue;
	}
	const decoded = await decodeAudio(join(source, 'audio', audio), RATE);
	const repeats = Math.max(1, Math.ceil(seconds / decoded.duration));
	const looped = new Float32Array(decoded.mono.length * repeats);
	for (let r = 0; r < repeats; r++) looped.set(decoded.mono, r * decoded.mono.length);
	const list: DrumEvent[] = [];
	for (let r = 0; r < repeats; r++) {
		for (const mark of marks) list.push({ time: +(mark.time + r * decoded.duration).toFixed(6), cls: mark.cls });
	}
	const name = file.slice(0, -4).replace(/[^\w.-]+/g, '-');
	writeFileSync(join(OUT, 'audio', `${name}.wav`), wav(looped, RATE));
	tracks.push({ name, audio: `audio/${name}.wav`, genre: 'electronic', events: list });
	events += list.length;
	console.log(`${name.slice(0, 44).padEnd(44)} ${decoded.duration.toFixed(1)} s x${repeats}, ${list.length} events`);
}

writeFileSync(join(OUT, 'tracks.json'), JSON.stringify({
	corpus: 'fsl30', labeled: true, heldOut: true, classes: ['kick', 'snare', 'hat'],
	source: 'FSL-30, Yi and Barthet 2026 (CC BY 4.0), audio from the Freesound Loop Dataset',
	tracks
}));
console.log(`\n${tracks.length} loops, ${events} events -> ${OUT}` + (missing ? `, ${missing} without audio` : ''));
