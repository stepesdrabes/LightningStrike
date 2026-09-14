// node bench/drumeval/convert-idmt.ts --root=DIR [--out=bench/corpus/idmt-smt-drums]
// IDMT-SMT-Drums V2 (Zenodo 7544164, CC BY-NC-ND 4.0): drum-only loops from real kits, drum
// machines and samples, with kick/snare/hi-hat onsets. Mixes only.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { DrumClass, DrumEvent } from './corpus.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(flag('root')!);
const out = resolve(flag('out') ?? 'bench/corpus/idmt-smt-drums');
const CLASS: Record<string, DrumClass> = { KD: 'kick', SD: 'snare', HH: 'hat' };

const tracks = readdirSync(join(root, 'audio')).filter((f) => f.endsWith('#MIX.wav')).sort().map((file) => {
	const base = file.slice(0, -4);
	const xml = readFileSync(join(root, 'annotation_xml', `${base}.xml`), 'utf8');
	// A few onsets near zero are written as negative or exponent numbers.
	const events: DrumEvent[] = [...xml.matchAll(/<onsetSec>(-?[\d.]+(?:e[-+]?\d+)?)<\/onsetSec>[\s\S]*?<instrument>(\w+)<\/instrument>/gi)]
		.map((m) => ({ time: Number(m[1]), cls: CLASS[m[2]] ?? 'other', sub: m[2] }))
		.sort((a, b) => a.time - b.time);
	return {
		name: base.replace('#MIX', ''), genre: base.replace(/\d.*$/, ''),
		audio: relative(out, join(root, 'audio', file)).split('\\').join('/'), events
	};
});
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'tracks.json'), JSON.stringify({
	corpus: 'idmt', source: 'IDMT-SMT-Drums V2 (zenodo.org/records/7544164)', license: 'CC BY-NC-ND 4.0',
	classes: ['kick', 'snare', 'hat'], tracks
}, null, '\t'));
console.log(`${tracks.length} tracks, ${tracks.reduce((n, t) => n + t.events.length, 0)} events`);
