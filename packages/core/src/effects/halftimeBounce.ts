import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** Ease front-to-back over half a beat so the shift reads as a head-nod rather than a cut. */
export const halftimeBounce: EffectDef = {
	id: 'halftimeBounce',
	name: 'Halftime Bounce',
	role: 'rhythm',
	blurb: 'A broad warm lobe nods front to back, lifting on kicks and opening with the snare.',
	taste: {
		energy: 3,
		sections: ['groove', 'verse', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		kickAccent: true
	},
	params: [INTENSITY, param('width', 'Lobe width', 0.3, 0.15, 0.6)],
	create(g) {
		// Expand fixture-normalized depth so the lobe reaches both walls.
		let lo = Infinity;
		let hi = -Infinity;
		for (let i = 0; i < g.count; i++) {
			if (g.ny[i] < lo) lo = g.ny[i];
			if (g.ny[i] > hi) hi = g.ny[i];
		}
		const span = hi - lo || 1;
		// Latch interpolated beat energy before applying it to brightness.
		const passage = new BeatHold(0.45);
		let seat = Number.NaN;

		return {
			reset() {
				passage.reset();
				seat = Number.NaN;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Seat from the bar grid, never from a counted beat, so a seek re-seats it.
				const target = f.barPhase < 0.5 ? 0 : 1;
				if (Number.isNaN(seat)) seat = target;
				seat += (target - seat) * alphaFor(f.dt, (f.beatPeriod * 0.17) / Math.max(0.05, motion));

				const level = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const snare = f.snareEnv;
				const kick = Math.pow(clamp(f.kickEnv), 0.85);
				// The snare widens the current nod instead of starting another.
				const width = p.width + snare * 0.15;
				const gain = (0.14 + p.intensity * 0.43) * clamp(0.35 + level * 0.65)
					* (0.75 + snare * 0.5 + kick * 0.9);

				for (let i = 0; i < g.count; i++) {
					const d = (g.ny[i] - lo) / span - seat;
					const lobe = Math.exp((-d * d) / (2 * width * width));
					const slot = lerp(SLOT.base, SLOT.glow, lobe * (0.4 + snare * 0.5));
					setSample(out, i, palette, slot + hueShift, lobe * gain);
				}
			}
		};
	}
};
