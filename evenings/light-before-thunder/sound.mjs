/**
 * Renders the evening's scored moments beside this script, deterministically:
 *
 *   node evenings/light-before-thunder/sound.mjs [moment ...] [--wav dir]
 *
 * Without names it renders them all. Needs Node 22.18 or later (it imports timing.ts) and ffmpeg.
 */
import { join } from 'node:path';
import { createMix, master } from './instruments.mjs';
import { scoreHomecoming, scoreOpenSky, scoreWallCloud } from './moments.mjs';
import { scoreStorm } from './storm.mjs';
import { HOMECOMING, OPENING, OPEN_SKY, RETURN_STROKE, WALL_CLOUD } from './timing.ts';

const MOMENTS = {
	'first-strike': {
		length: OPENING.end,
		lufs: null,
		score: (mix) =>
			scoreStorm(mix, OPENING, {
				root: 41.2,
				notes: [880, 1318.5],
				// Each thunder is nearer than the last: sooner after its flash, brighter, sharper and louder.
				thunders: [
					{ duration: 5.5, rise: 0.5, cutoff: 190, gain: -28, pan: 0.45, spread: 0.2, decay: 1.2 },
					{ duration: 5, rise: 0.22, cutoff: 380, gain: -27, pan: 0.25, spread: 0.3, decay: 1.5 },
					{ duration: 4.5, rise: 0.05, cutoff: 900, gain: -21, pan: 0.05, spread: 0.4, decay: 1.8, crack: -16, crackPan: 0.1 },
					{ duration: 3.5, rise: 0.015, cutoff: 1300, gain: -21, pan: 0, spread: 0.5, decay: 2.2, crack: -11, crackPan: 0 }
				],
				tail: { rise: 0.35, cutoff: 1100, gain: -19, spread: 0.6, decay: 5.5 }
			})
	},
	'return-stroke': {
		length: RETURN_STROKE.end,
		lufs: -14,
		// In B rising to E, the key Back In Black answers in.
		score: (mix) =>
			scoreStorm(mix, RETURN_STROKE, {
				root: 61.74,
				notes: [987.77, 1479.98],
				thunders: [
					null,
					null,
					{ duration: 3.5, rise: 0.03, cutoff: 1000, gain: -22, pan: 0, spread: 0.4, decay: 2, crack: -13, crackPan: -0.1 },
					{ duration: 3, rise: 0.015, cutoff: 1300, gain: -22, pan: 0, spread: 0.5, decay: 2.2, crack: -10, crackPan: 0.1 }
				],
				tail: { rise: 0.3, cutoff: 1100, gain: -19, spread: 0.6, decay: 5 }
			})
	},
	// These two hand straight to a block, so their sound dies with the room's last half second.
	'wall-cloud': {
		length: WALL_CLOUD.end,
		lufs: -14,
		fade: 0.5,
		score: (mix) => scoreWallCloud(mix, WALL_CLOUD)
	},
	'open-sky': {
		length: OPEN_SKY.end,
		lufs: -14,
		fade: 0.5,
		score: (mix) => scoreOpenSky(mix, OPEN_SKY)
	},
	homecoming: {
		length: HOMECOMING.end,
		lufs: -14,
		score: (mix) => scoreHomecoming(mix, HOMECOMING)
	}
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
