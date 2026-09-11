import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { Follower, PulseEnv } from '../dsl/env.ts';
import { nblend } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/** A chorus-only sustained floor; broad motion keeps the anthem legible without a busy pattern. */
export const anthemWash: EffectDef = {
	id: 'anthemWash',
	name: 'Anthem Wash',
	role: 'bed',
	blurb: 'Full-room chorus floor: one slow-orbiting crest, a swell on every downbeat.',
	taste: {
		energy: 3,
		sections: ['chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.05
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		// Follow the spectrum for articulation between beats.
		const body = new Follower(0.03, 0.2);
		const swell = new PulseEnv();
		let crest = 0;

		return {
			reset() {
				body.reset();
				swell.reset();
				crest = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const level = body.update(
					clamp(bandAt(f, 0.3) * 0.9 + bandAt(f, 0.6) * 0.7),
					f.dt
				);
				if (f.downbeat) swell.fire(0.7 + level * 0.3);
				const lift = swell.decay(f.dt, f.beatPeriod, 2);

				// One lap per 32 beats keeps the crest from reading as a chase.
				crest += (f.dt * ctx.motion) / Math.max(0.1, f.beatPeriod * 32);

				const gain = (0.34 + p.intensity * 0.75) * (0.5 + level * 0.55 + lift * 0.25);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const arc = 0.62 + 0.38 * sinewave(u - crest);
					// Colour varies spatially; the downbeat swell reaches a little white.
					const slot = lerp(lerp(SLOT.base, SLOT.glow, arc), SLOT.white, lift * 0.22);
					setSample(buf, i, palette, slot + hueShift, gain * arc);
				}

				nblend(out, buf, alphaFor(f.dt, lerp(0.08, 0.03, lift)));
			}
		};
	}
};
