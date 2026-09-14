// node bench/drumeval/convert-rwc.ts --audio=DIR --annotations=DIR [--out=bench/corpus/rwc]
// RWC 2.0 (Zenodo 17177919, CC BY-NC 4.0) pop and genre songs with drums: labels from the
// DTW-aligned MIDI's General MIDI drum channel. Writes tracks.json referencing the WAV files.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { DrumEvent } from './corpus.ts';
import { SHAKERS, gmClass, readMidi } from './midi.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const audioRoot = resolve(flag('audio')!);
const annotations = resolve(flag('annotations')!);
const out = resolve(flag('out') ?? 'bench/corpus/rwc');

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

const wavs = new Map(walk(audioRoot).filter((p) => p.toLowerCase().endsWith('.wav')).map((p) => [p.split(/[\\/]/).pop()!.slice(0, -4), p]));
const metadata = readFileSync(join(annotations, 'metadata.csv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
	.map((line) => line.split(';'));
const tracks = [];
for (const row of metadata) {
	const [id, collection, , , , title, artist, , , , , , drumInfo, , , genre, subgenre] = row;
	if (collection !== 'P' && collection !== 'G') continue;
	if (collection === 'P' && (!drumInfo || drumInfo === 'Without drums')) continue;
	if (collection === 'G' && Number(id.slice(5, 8)) > 27) continue;
	const midiPath = join(annotations, '01_annotations_preprocessed', 'MIDI_aligned', `RWC-${collection}`, `${id}.mid`);
	const wav = wavs.get(id);
	if (!existsSync(midiPath) || !wav) {
		console.warn(`${id}: missing ${existsSync(midiPath) ? 'audio' : 'MIDI'}`);
		continue;
	}
	const notes = readMidi(readFileSync(midiPath)).filter((n) => n.channel === 9);
	if (notes.filter((n) => gmClass(n.note) === 'kick' || gmClass(n.note) === 'snare').length < 20) {
		console.warn(`${id}: too few drum notes`);
		continue;
	}
	const events: DrumEvent[] = notes.map((n) => {
		const cls = gmClass(n.note);
		const optional = n.note === 44 || SHAKERS.includes(n.note) || (cls === 'snare' && n.velocity < 40);
		return { time: +n.time.toFixed(4), cls, sub: `GM${n.note}`, ...(optional ? { optional: true } : {}) };
	});
	tracks.push({
		name: id, title, artist, genre: `${genre}/${subgenre}`, drums: drumInfo || subgenre,
		audio: relative(out, wav).split('\\').join('/'), events
	});
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'tracks.json'), JSON.stringify({
	corpus: 'rwc', source: 'RWC 2.0 audio (zenodo.org/records/17177919) with rwc-annotations aligned MIDI', license: 'CC BY-NC 4.0',
	tracks
}, null, '\t'));
console.log(`${tracks.length} tracks, ${tracks.reduce((n, t) => n + t.events.length, 0)} drum events`);
