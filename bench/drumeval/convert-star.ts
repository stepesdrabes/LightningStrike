// node bench/drumeval/convert-star.ts --root=DIR [--out=bench/corpus/star] [--every=K]
// STAR Drums (Weber et al. 2025, Zenodo 15690078; audio CC BY-NC-SA/BY-NC/BY-SA/BY per source)
// training excerpts: drums re-rendered from pseudo-labels with Komplete kits over the real non-drum
// stems, so the labels match the drum audio exactly. Lists the extracted training mixes.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DrumClass, DrumEvent } from './corpus.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(flag('root')!);
const out = resolve(flag('out') ?? 'bench/corpus/star');
const every = Number(flag('every') ?? 1);

/** STAR's 18 classes. Side sticks and pedal hats are optional, tambourine keeps time like a hat. */
const CLASS: Record<string, DrumClass> = {
	BD: 'kick', SD: 'snare', CLP: 'snare', SS: 'snare', CHH: 'hat', PHH: 'hat', OHH: 'hat', TB: 'hat',
	LT: 'tom', MT: 'tom', HT: 'tom', SPC: 'cymbal', CHC: 'cymbal', CRC: 'cymbal', RD: 'cymbal', RB: 'cymbal',
	CB: 'other', CL: 'other'
};
const OPTIONAL = new Set(['SS', 'PHH', 'TB']);

const tracks = [];
let listed = 0;
for (const collection of readdirSync(join(root, 'training')).sort()) {
	const annotations = join(root, 'training', collection, 'annotation');
	const mixes = join(root, 'training', collection, 'audio', 'mix');
	if (!existsSync(annotations) || !existsSync(mixes)) continue;
	for (const file of readdirSync(annotations).filter((f) => f.endsWith('.txt')).sort()) {
		const base = file.slice(0, -4);
		const audio = join(mixes, `${base}.flac`);
		if (!existsSync(audio) || listed++ % every) continue;
		const events: DrumEvent[] = readFileSync(join(annotations, file), 'utf8').split(/\r?\n/).flatMap((line) => {
			const [time, label] = line.trim().split('\t');
			const cls = CLASS[label];
			if (!time || !cls) return [];
			// Tambourine is scored like MDB's TMB: optional hat, dropped from benchmark classes.
			const sub = label === 'TB' ? 'TMB' : label;
			return [{ time: +Number(time).toFixed(4), cls, sub, ...(OPTIONAL.has(label) ? { optional: true } : {}) }];
		}).sort((a, b) => a.time - b.time);
		tracks.push({ name: base.replace('_mix_', '_').replace(/_kit_full$/, ''), genre: 'electronic', audio, events });
	}
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'tracks.json'), JSON.stringify({
	corpus: 'star', source: 'STAR Drums training excerpts with electronic kits (zenodo.org/records/15690078)',
	license: 'per source track: CC BY-NC-SA, BY-NC, BY-SA or BY', tracks
}, null, '\t'));
console.log(`${tracks.length} tracks, ${tracks.reduce((n, t) => n + t.events.length, 0)} events`);
