import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { nblend } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/** Opposing low-end swells form a broad floor; kicks deepen troughs for beat contrast. */
export const undertow: EffectDef = {
	id: 'undertow',
	name: 'Undertow',
	role: 'bed',
	blurb: 'Two counter-rolling swells around the room, weighted by the low end.',
	taste: {
		energy: 3,
		sections: ['groove', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		// Follow spectrum for low-end movement inside the bar.
		const low = new Follower(0.035, 0.22);
		const punch = new Follower(0.012, 0.1);
		let swellA = 0;
		let swellB = 0.5;

		return {
			reset() {
				low.reset();
				punch.reset();
				swellA = 0;
				swellB = 0.5;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const weight = low.update(clamp(bandAt(f, 0.08) * 1.1 + bandAt(f, 0.25) * 0.5), f.dt);
				const kick = punch.update(clamp(f.kickEnv), f.dt);

				// Opposite directions prevent the rolling field from reading as one chase.
				const lap = Math.max(0.1, f.beatPeriod * 16);
				swellA += (f.dt * ctx.motion * (0.7 + weight * 0.6)) / lap;
				swellB -= (f.dt * ctx.motion * (0.55 + weight * 0.5)) / lap;

				const gain = (0.36 + p.intensity * 0.76) * (0.42 + weight * 0.6);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const a = 0.5 + 0.5 * sinewave(u - swellA);
					const b = 0.5 + 0.5 * sinewave(u * 2 + swellB);
					// Kick deepens troughs instead of pushing crests closer to full.
					const sea = clamp(0.3 + a * 0.5 + b * 0.35 - kick * (1 - a) * 0.45);
					// Spatial shade-to-glow gives the wave its shape.
					const slot = lerp(SLOT.deep, SLOT.glow, sea);
					setSample(buf, i, palette, slot + hueShift, gain * sea);
				}

				nblend(out, buf, alphaFor(f.dt, lerp(0.09, 0.03, kick)));
			}
		};
	}
};
