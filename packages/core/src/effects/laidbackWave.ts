import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/** Heavy easing lets the half-time wave linger at each wall like a nod. */
export const laidbackWave: EffectDef = {
	id: 'laidbackWave',
	name: 'Laidback Wave',
	role: 'rhythm',
	blurb: 'One eased head-nod wave rolling through the room every two bars.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1
	},
	params: [INTENSITY, param('barsPerWave', 'Bars per wave', 2, 1, 4, 1)],
	create(g) {
		// Smooth beat energy for passage level.
		const passage = new Follower(0.09, 0.65);
		// Colour moves slower than the wave so it belongs to the passage.
		const lean = new Follower(0.15, 0.6);
		// Expand fixture-normalized depth so the nod settles on actual walls.
		let lo = Infinity;
		let hi = -Infinity;
		for (let i = 0; i < g.count; i++) {
			if (g.ny[i] < lo) lo = g.ny[i];
			if (g.ny[i] > hi) hi = g.ny[i];
		}
		const span = hi - lo || 1;

		return {
			reset() {
				passage.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// Do not scale absolute grid phase by motion: changing motion at a large bar
				// index
				// would jump the pattern by the elapsed time.
				const phase = frac((f.barIndex + f.barPhase) / Math.max(1, p.barsPerWave));
				const front = sinewave(phase);
				const passageLevel = passage.update(f.energy, f.dt);
				const tilt = lean.update(spectralTilt(f), f.dt);
				const level = clamp(0.3 + passageLevel * 0.7) * (0.12 + p.intensity * 0.3);

				for (let i = 0; i < g.count; i++) {
					const d = (g.ny[i] - lo) / span - front;
					const wave = Math.exp(-d * d * 12);
					// Let the crest reach the third spatially while the background holds the
					// base hue.
					const slot = lerp(
						lerp(SLOT.deep, SLOT.base, clamp(0.4 + wave * 0.6)),
						SLOT.third,
						Math.pow(wave, 3) * (0.7 + tilt * 0.3)
					);
					setSample(out, i, palette, slot + hueShift, (0.3 + 0.7 * wave) * level);
				}
			}
		};
	}
};
