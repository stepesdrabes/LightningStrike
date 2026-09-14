// node bench/drumeval/convert-rbma.ts --audio=DIR --annotations=DIR [--out=bench/corpus/rbma13]
// RBMA13 (Vogl et al.): 27 electronic full mixes from the purchased Red Bull Music Academy
// "Various Assets 2013" album, with kick/snare/hi-hat annotations. Marked held out (see corpus.ts).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { DrumClass, DrumEvent } from './corpus.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const audio = resolve(flag('audio')!);
const annotations = resolve(flag('annotations')!);
const out = resolve(flag('out') ?? 'bench/corpus/rbma13');
const CLASS: DrumClass[] = ['kick', 'snare', 'hat'];

const flacs = readdirSync(audio).filter((f) => f.endsWith('.flac'));
const tracks = readdirSync(join(annotations, 'drums')).filter((f) => /^RBMA-13-Track-\d+\.txt$/.test(f)).sort().map((file) => {
	const number = file.match(/Track-(\d+)/)![1];
	const flac = flacs.find((f) => f.includes(`Red Bull Music - ${number} `));
	if (!flac) throw new Error(`No audio for track ${number}`);
	const events: DrumEvent[] = readFileSync(join(annotations, 'drums', file), 'utf8').split(/\r?\n/).flatMap((line) => {
		const [time, label] = line.trim().split(/\s+/);
		return time && label ? [{ time: Number(time), cls: CLASS[Number(label)] ?? 'other' }] : [];
	}).sort((a, b) => a.time - b.time);
	return { name: `Track-${number}`, title: flac.replace(/^.* - \d+ /, '').replace('.flac', ''), audio: relative(out, join(audio, flac)).split('\\').join('/'), events };
});
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'tracks.json'), JSON.stringify({
	corpus: 'rbma', source: 'RBMA13 annotations (ifs.tuwien.ac.at/~vogl/datasets) with the purchased album audio', heldOut: true,
	classes: ['kick', 'snare', 'hat'],
	tracks
}, null, '\t'));
console.log(`${tracks.length} tracks, ${tracks.reduce((n, t) => n + t.events.length, 0)} events`);
