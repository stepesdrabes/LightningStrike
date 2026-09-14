// node bench/drumeval/convert-enst.ts --root=DIR [--solo | --two-thirds] [--out=bench/corpus/enst-drums]
// ENST-Drums (Zenodo 7432188, CC BY-NC-ND 4.0) minus-one pieces: the wet drum mix summed with
// its accompaniment at equal weight, written as 44.1 kHz stereo WAV beside tracks.json. --solo
// lists the wet drum mixes alone (corpus enstsolo); --two-thirds mixes drums at 2/3 and
// accompaniment at 1/3 as in Paulus and Klapuri and the Wu et al. review (corpus enst23).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DrumClass, DrumEvent } from './corpus.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(flag('root')!);
const solo = args.includes('--solo');
const twoThirds = args.includes('--two-thirds');
const out = resolve(flag('out') ?? (solo ? 'bench/corpus/enst-solo' : twoThirds ? 'bench/corpus/enst-23' : 'bench/corpus/enst-drums'));
const [drumGain, accompanimentGain] = twoThirds ? [2 / 3, 1 / 3] : [0.5, 0.5];

/** ENST labels (Gillet and Richard 2006). Soft snare strokes are optional. */
function enstClass(label: string): DrumClass {
	if (label === 'bd') return 'kick';
	if (['sd', 'sd-', 'rs', 'cs'].includes(label)) return 'snare';
	if (label === 'chh' || label === 'ohh') return 'hat';
	if (['lft', 'lt', 'lmt', 'mt'].includes(label)) return 'tom';
	if (/^(cr|c|rc|ch|spl)\d*$/.test(label)) return 'cymbal';
	return 'other';
}

const drummers = readdirSync(root).filter((d) => d.startsWith('drummer_'));
mkdirSync(solo ? out : join(out, 'audio'), { recursive: true });
const tracks = [];
for (const drummer of drummers) {
	const accompaniment = join(root, drummer, 'audio', 'accompaniment');
	if (!existsSync(accompaniment)) continue;
	for (const file of readdirSync(accompaniment).filter((f) => f.endsWith('.wav') && f.includes('minus-one')).sort()) {
		const base = file.slice(0, -4);
		const wet = join(root, drummer, 'audio', 'wet_mix', file);
		const annotation = join(root, drummer, 'annotation', `${base}.txt`);
		if (!existsSync(wet) || !existsSync(annotation)) continue;
		const name = `${drummer.replace('drummer_', 'd')}_${base}`.replace(/[^\w.-]/g, '_');
		const target = solo ? wet : join(out, 'audio', `${name}.wav`);
		if (!solo && !existsSync(target)) {
			execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', wet, '-i', join(accompaniment, file), '-filter_complex',
				`[0:a]volume=${drumGain}[d];[1:a]volume=${accompanimentGain}[a];[d][a]amix=inputs=2:duration=longest:normalize=0[m]`,
				'-map', '[m]', '-ar', '44100', '-ac', '2',
				'-c:a', 'pcm_s16le', '-y', target]);
		}
		const events: DrumEvent[] = readFileSync(annotation, 'utf8').split(/\r?\n/).flatMap((line) => {
			const [time, label] = line.trim().split(/\s+/);
			if (!time || !label) return [];
			const cls = enstClass(label);
			return [{ time: Number(time), cls, sub: label, ...(label === 'sd-' ? { optional: true } : {}) }];
		}).sort((a, b) => a.time - b.time);
		tracks.push({ name, genre: base.split('_')[2] ?? '', audio: solo ? wet : `audio/${name}.wav`, events });
	}
}
writeFileSync(join(out, 'tracks.json'), JSON.stringify({
	...(solo
		? { corpus: 'enstsolo', variantOf: 'enst', source: 'ENST-Drums minus-one (zenodo.org/records/7432188), wet mix alone' }
		: twoThirds
			? { corpus: 'enst23', variantOf: 'enst', source: 'ENST-Drums minus-one (zenodo.org/records/7432188), 2/3 wet mix + 1/3 accompaniment' }
			: { corpus: 'enst', source: 'ENST-Drums minus-one (zenodo.org/records/7432188), wet mix + accompaniment' }),
	license: 'CC BY-NC-ND 4.0', tracks
}, null, '\t'));
console.log(`${tracks.length} tracks, ${tracks.reduce((n, t) => n + t.events.length, 0)} events`);
