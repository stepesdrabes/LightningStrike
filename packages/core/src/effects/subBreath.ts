import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { sinewave, triwave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Move standing-pattern contrast while holding mean level, avoiding repeated full-field
 * brightness changes and leaving headroom for other layers.
 */
export const subBreath: EffectDef = {
	id: 'subBreath',
	name: 'Sub Breath',
	role: 'bed',
	blurb: 'The room breathes with the bottom end at constant total output.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0,
		// An even bass-independent floor lets this carry a cue between notes.
		carries: true,
		// Low quiet movement is expected: the mean deliberately holds still.
		quiet: 4.96
	},
	params: [INTENSITY, param('depth', 'Breath depth', 0.62)],
	create(g) {
		/** How much of the bottom end is harmonics: how far the ring may reach for a second hue. */
		const grit = new Follower(0.25, 0.9);
		let env = 0;
		let drift = 0;

		return {
			reset() {
				env = 0;
				drift = 0;
				grit.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Follow spectrum so bass contrast articulates between beats.
				env = envelope(
					env,
					clamp(bandBetween(f, 0, 0.12) * 2.2),
					f.dt,
					Math.max(0.03, f.beatPeriod * 0.1),
					Math.max(0.4, f.beatPeriod * 1.1)
				);
				const harmonics = grit.update(clamp(bandBetween(f, 0.12, 0.32) * 1.4), f.dt);
				// Kick deepens contrast without changing mean level; bass can still drive a
				// kit-free passage.
				const depth = clamp(env * 0.85 + f.kickEnv * 0.12) * p.depth;

				// Drift the standing pattern over 32 bars so favoured walls change
				// unobtrusively.
				drift += (f.dt * motion) / Math.max(1, 128 * f.beatPeriod);
				const mean = 0.62;
				const gain = 0.55 + p.intensity * 0.9;

				for (let i = 0; i < g.count; i++) {
					const onBeam = g.perim[i] < 0;
					const u = ringU(g, i);
					// The beam holds the mean as a still, visibly lit reference.
					const lobe = onBeam ? mean : mean + depth * 0.38 * sinewave(2 * u + drift);
					// Use spatial colour, with slowly measured harmonics controlling reach
					// toward third.
					// Fast temporal hue changes would defeat the constant-level gesture.
					const slot = lerp(SLOT.base, SLOT.third, triwave(u) * (0.3 + harmonics * 0.5));
					setSample(out, i, palette, slot + hueShift, clamp(lobe) * gain);
				}
			}
		};
	}
};
