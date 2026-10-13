/**
 * Renders the evening's scored moments beside this script, deterministically:
 *
 *   node evenings/babi-leto/sound.mjs [moment ...] [--wav dir]
 *
 * Without names it renders them all. Needs Node 22.18 or later (it imports timing.ts) and ffmpeg.
 */
import { join } from 'node:path';
import { createMix, master } from '../light-before-thunder/instruments.mjs';
import { scoreBurcak, scoreDrakiada, scoreList, scoreNarozeniny, scoreOrionidy, scorePulnoc, scoreSfouknuto, scoreSpacci, scoreVitr, scoreZare } from './scores.mjs';
import { BURCAK, DRAKIADA, LIST, NAROZENINY, ORIONIDY, PULNOC, SFOUKNUTO, SPACCI, VITR, ZARE } from './timing.ts';

// Each moment rings out after its drop; the fade only takes the last of the tail.
const MOMENTS = {
	vitr: { length: VITR.end, lufs: -14, fade: 2.5, score: (mix) => scoreVitr(mix, VITR) },
	drakiada: { length: DRAKIADA.end, lufs: -14, fade: 2.5, score: (mix) => scoreDrakiada(mix, DRAKIADA) },
	spacci: { length: SPACCI.end, lufs: -14, fade: 2.5, score: (mix) => scoreSpacci(mix, SPACCI) },
	burcak: { length: BURCAK.end, lufs: -14, fade: 2.5, score: (mix) => scoreBurcak(mix, BURCAK) },
	narozeniny: { length: NAROZENINY.end, lufs: -14, fade: 3, score: (mix) => scoreNarozeniny(mix, NAROZENINY) },
	sfouknuto: { length: SFOUKNUTO.end, lufs: -14, fade: 2.5, score: (mix) => scoreSfouknuto(mix, SFOUKNUTO) },
	zare: { length: ZARE.end, lufs: -14, fade: 3, score: (mix) => scoreZare(mix, ZARE) },
	pulnoc: { length: PULNOC.end, lufs: -14, fade: 3, score: (mix) => scorePulnoc(mix, PULNOC) },
	orionidy: { length: ORIONIDY.end, lufs: -14, fade: 2.5, score: (mix) => scoreOrionidy(mix, ORIONIDY) },
	'posledni-list': { length: LIST.end, lufs: -14, fade: 4, score: (mix) => scoreList(mix, LIST) }
};

const args = process.argv.slice(2);
const wavDir = args.includes('--wav') ? args[args.indexOf('--wav') + 1] : null;
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--wav');
for (const name of names.length ? names : Object.keys(MOMENTS)) {
	const moment = MOMENTS[name];
	if (!moment) throw new Error(`No moment "${name}": ${Object.keys(MOMENTS).join(', ')}.`);
	const started = performance.now();
	const mix = createMix(moment.length);
	moment.score(mix);
	const target = join(import.meta.dirname, `${name}.m4a`);
	const result = master(mix, target, { lufs: moment.lufs, fade: moment.fade, wav: wavDir ? join(wavDir, `${name}.wav`) : null });
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	console.log(`${name}: ${moment.length} s, ${result.integrated} LUFS, ${result.truePeak} dBTP (ceiling ${result.ceiling.toFixed(2)}), ${seconds} s`);
}
