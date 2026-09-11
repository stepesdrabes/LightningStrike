import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { hash01 } from '../dsl/rng.ts';
import { ringU } from '../dsl/space.ts';
import { Follower } from '../dsl/env.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

const LAMPS = 5;

/**
 * Hash unequal wander and breath periods so lamps never align into a chase.
 * Sparse pools require a bed; the beam receives their even mean as bounced light.
 */
export const lanterns: EffectDef = {
	id: 'lanterns',
	name: 'Lanterns',
	role: 'accent',
	blurb: 'A handful of soft pools drifting round the walls, each breathing on its own clock.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'void', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 2.22,
		carries: false
	},
	params: [
		INTENSITY,
		param('drift', 'Drift', 0.45),
		param('width', 'Width', 0.5),
		param('listen', 'How much it hears', 0.5)
	],
	create(g) {
		const home = new Float32Array(LAMPS);
		const wander = new Float32Array(LAMPS);
		const breath = new Float32Array(LAMPS);
		const slot = new Float32Array(LAMPS);
		for (let k = 0; k < LAMPS; k++) {
			home[k] = k / LAMPS + hash01(k * 31 + 5) * 0.06;
			// Never a whole-number ratio between any two, so the set never lines up.
			wander[k] = 0.0031 + hash01(k * 17 + 2) * 0.0043;
			breath[k] = 0.021 + hash01(k * 53 + 9) * 0.031;
			// Keep most lamps in the base hue and one in the third.
			slot[k] = hash01(k * 71 + 3) < 0.25 ? SLOT.third : lerp(SLOT.base, SLOT.glow, hash01(k * 13));
		}
		const pos = new Float32Array(LAMPS);
		const level = new Float32Array(LAMPS);
		const onBeam = new Uint8Array(g.count);
		for (let i = 0; i < g.count; i++) onBeam[i] = g.perim[i] < 0 ? 1 : 0;
		// Give each lamp a spectral slice with a slow release so musical gaps do not turn it
		// into a meter.
		const voices = Array.from({ length: LAMPS }, () => new Follower(0.09, 0.55));
		let phase = 0;

		return {
			reset() {
				phase = 0;
				pos.fill(0);
				level.fill(0);
				for (const v of voices) v.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);

				phase += f.dt * motion;
				const roam = 0.02 + clamp(p.drift) * 0.06;
				const sigma = 0.035 + clamp(p.width) * 0.075;
				const gain = 0.25 + p.intensity * 0.5;
				const listen = clamp(p.listen);

				let mean = 0;
				for (let k = 0; k < LAMPS; k++) {
					pos[k] = home[k] + (sinewave(phase * wander[k] + hash01(k * 7)) - 0.5) * roam;
					// Unity-centred spectral modulation shades lamps without switching them
					// off.
					const voice = voices[k].update(bandAt(f, k / (LAMPS - 1)), f.dt);
					const breathing = 0.52 + 0.48 * sinewave(phase * breath[k] + hash01(k * 23));
					level[k] = breathing * gain * (1 + listen * (voice - 0.35));
					mean += level[k];
				}
				mean /= LAMPS;

				const twoSigmaSq = 2 * sigma * sigma;
				for (let i = 0; i < g.count; i++) {
					if (onBeam[i]) {
						// Dim, even beam spill reads as bounced light.
						addSample(out, i, palette, SLOT.base + hueShift, mean * 0.3);
						continue;
					}
					const u = ringU(g, i);
					for (let k = 0; k < LAMPS; k++) {
						let d = Math.abs(u - pos[k]);
						if (d > 0.5) d = 1 - d;
						if (d > sigma * 3) continue;
						addSample(out, i, palette, slot[k] + hueShift, level[k] * Math.exp(-(d * d) / twoSigmaSq));
					}
				}
			}
		};
	}
};
