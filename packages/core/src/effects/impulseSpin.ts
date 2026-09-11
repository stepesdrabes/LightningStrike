import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Integrate kick-driven angular velocity with drag. Scaling velocity by motion is safe
 * because this phase is state, not an absolute clock.
 */
export const impulseSpin: EffectDef = {
	id: 'impulseSpin',
	name: 'Impulse Spin',
	role: 'rhythm',
	blurb: 'Kicks spin the ring up; drag coasts it between hits. Momentum instead of a clock.',
	taste: {
		energy: 3,
		sections: ['groove', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		kit: 'kick'
	},
	params: [
		INTENSITY,
		param('lobes', 'Lobes', 3, 2, 6, 1),
		param('drag', 'Drag', 0.4)
	],
	create(g) {
		let phase = 0;
		let velocity = 0;
		const presence = new Presence();

		return {
			reset() {
				phase = 0;
				velocity = 0;
				presence.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const permission = presence.update(f.kickEnv, f.dt, f.beatPeriod);

				// Impulse in laps/second. Defaults settle near one lap per two bars at 128 BPM.
				if (f.kick) velocity += (0.1 + 0.14 * f.kickEnv) * permission;
				const tau = lerp(1.4, 0.35, p.drag);
				velocity *= Math.exp(-f.dt / tau);
				phase = frac(phase + velocity * f.dt * Math.max(0.05, motion));

				const lobes = Math.max(2, Math.round(p.lobes));
				const gain = (0.28 + p.intensity * 0.52) * (0.4 + 0.6 * permission);
				const spin = velocity / 0.35;

				for (let i = 0; i < g.count; i++) {
					const u = frac((ringU(g, i) - phase + 2) * lobes);
					// Cap lobe sharpness at the third power so fast rotation remains broad
					// enough to avoid shimmer.
					const lobe = 0.5 - 0.5 * Math.cos(u * Math.PI * 2);
					const crest = Math.pow(lobe, 2 + clamp(spin) * 1.2);
					const slot = lerp(SLOT.deep, lerp(SLOT.base, SLOT.glow, clamp(spin)), crest);
					setSample(out, i, palette, slot + hueShift, (0.12 + crest * 0.88) * gain);
				}
			}
		};
	}
};
