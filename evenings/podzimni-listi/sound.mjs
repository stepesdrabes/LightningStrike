/**
 * Renders the evening's scored moments beside this script, deterministically:
 *
 *   node evenings/podzimni-listi/sound.mjs [moment ...] [--out dir] [--wav dir]
 *
 * Without names it renders them all. Needs Node 22.18 or later (it imports timing.ts) and ffmpeg.
 */
import { join } from 'node:path';
import { scoreBurcak, scoreDrakiada, scoreList, scoreNarozeniny, scoreOrionidy, scorePulnoc, scoreSfouknuto, scoreSpacci, scoreVitr, scoreZare } from './scores.mjs';
import { createStudio, finish } from './studio.mjs';
import { BURCAK, DRAKIADA, LIST, NAROZENINY, ORIONIDY, PULNOC, SFOUKNUTO, SPACCI, VITR, ZARE } from './timing.ts';

// The songs either side play at -7 to -9 LUFS, so a moment's bloom arrives about as loud as they
// are. Each rings out after its drop; the fade only takes the last of the tail.
const MOMENTS = {
	vitr: { table: VITR, lufs: -12, fade: 2.5, score: scoreVitr },
	drakiada: { table: DRAKIADA, lufs: -11, fade: 2.5, score: scoreDrakiada },
	spacci: { table: SPACCI, lufs: -10.5, fade: 2.5, score: scoreSpacci },
	burcak: { table: BURCAK, lufs: -10.5, fade: 2.5, score: scoreBurcak },
	narozeniny: { table: NAROZENINY, lufs: -11.5, fade: 3, score: scoreNarozeniny },
	sfouknuto: { table: SFOUKNUTO, lufs: -9.5, fade: 2.5, score: scoreSfouknuto },
	zare: { table: ZARE, lufs: -11.5, fade: 3, score: scoreZare },
	pulnoc: { table: { ...PULNOC, bpm: 60 }, lufs: -10.5, fade: 3, score: scorePulnoc },
	orionidy: { table: ORIONIDY, lufs: -11, fade: 2.5, score: scoreOrionidy },
	'posledni-list': { table: { ...LIST, bpm: 60 }, lufs: -13, fade: 4, score: scoreList }
};

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const outDir = option('--out') ?? import.meta.dirname;
const wavDir = option('--wav');
const names = args.filter((a, i) => !a.startsWith('--') && !['--out', '--wav'].includes(args[i - 1]));
for (const name of names.length ? names : Object.keys(MOMENTS)) {
	const moment = MOMENTS[name];
	if (!moment) throw new Error(`No moment "${name}": ${Object.keys(MOMENTS).join(', ')}.`);
	const started = performance.now();
	const mix = createStudio(moment.table.end, { bpm: moment.table.bpm });
	moment.score(mix, moment.table);
	const target = join(outDir, `${name}.m4a`);
	const result = finish(mix, target, { lufs: moment.lufs, fade: moment.fade, wav: wavDir ? join(wavDir, `${name}.wav`) : null });
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	console.log(`${name}: ${moment.table.end} s, ${result.integrated} LUFS, ${result.truePeak} dBTP (ceiling ${result.ceiling.toFixed(2)}), ${seconds} s`);
}
