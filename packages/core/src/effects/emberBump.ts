import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

export const emberBump: EffectDef = {
	id: 'emberBump',
	name: 'Ember Bump',
	role: 'rhythm',
	blurb: 'A rounded warm kick pulse, held briefly before it settles into a dark gap.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		carries: false,
		kickAccent: true,
		kit: 'kick'
	},
	params: [INTENSITY, param('lag', 'Front-to-back lag', 0.5)],
	create(g) {
		const tilt = new Follower(0.8, 1.8);
		const depth = new Float32Array(g.count);
		let near = Infinity;
		let far = -Infinity;
		for (let i = 0; i < g.count; i++) {
			near = Math.min(near, g.ny[i]);
			far = Math.max(far, g.ny[i]);
		}
		const span = Math.max(1e-3, far - near);
		for (let i = 0; i < g.count; i++) depth[i] = (g.ny[i] - near) / span;
		let born = -Infinity;
		let power = 0;
		return {
			reset() {
				born = -Infinity;
				power = 0;
				tilt.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				if (f.kick && f.kickEnv > 0.05) {
					born = f.t;
					power = Math.pow(clamp(f.kickEnv), 0.8);
				}
				const tempo = Math.max(0.15, f.beatPeriod);
				const centre = tilt.update(clamp(0.5 + spectralTilt(f) * 0.5), f.dt / tempo);
				const release = tempo * 0.24 / Math.max(0.35, motion);
				const delay = Math.min(0.035, tempo * 0.08) * clamp(p.lag);
				const gain = 0.25 + p.intensity * 0.52;

				for (let i = 0; i < g.count; i++) {
					// Every depth receives the same held pulse, delayed rather than weakened.
					const age = f.t - born - depth[i] * delay;
					const pulse = age < 0 ? 0 : power * Math.exp(-Math.max(0, age - 0.045) / release);
					const shape = 0.7 + 0.3 * sinewave(ringU(g, i) + centre);
					const slot = lerp(SLOT.base, SLOT.glow, 0.2 + pulse * 0.65);
					setSample(out, i, palette, slot + hueShift, gain * shape * pulse);
				}
			}
		};
	}
};
