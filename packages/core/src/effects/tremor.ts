import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { hash01 } from '../dsl/rng.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Move fixed-grain depth on hits while preserving mean level. No kit requirement: without
 * drums it remains a still field that can carry a quiet cue.
 */
export const tremor: EffectDef = {
	id: 'tremor',
	name: 'Tremor',
	role: 'accent',
	blurb: 'The room grains on the beat without changing its level.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.2,
		carries: true,
		// Measured on the cache's quiet sections.
		quiet: 2.18
	},
	params: [INTENSITY, param('grain', 'Grain depth', 0.6)],
	create(g) {
		// Hash texture once so it remains a fixed surface and fresh instances agree.
		const grain = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) grain[i] = hash01(i * 2654435761) - 0.5;

		/** How hard the kit is hitting, smoothed: the depth, never the level. */
		const drive = new Follower(0.02, 0.13);
		/** Where the room's weight sits, slowly. A position may follow the music freely. */
		const tilt = new Follower(0.4, 0.9);
		/** The passage's own loudness, which is what the band envelopes are good for. */
		const body = new Follower(0.5, 1.2);

		return {
			reset() {
				drive.reset();
				tilt.reset();
				body.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const hit = drive.update(clamp(f.kickEnv * 0.8 + f.snareEnv * 0.5), f.dt);
				const loud = body.update(clamp(f.energy), f.dt);
				const tone = tilt.update(clamp(0.5 + spectralTilt(f) * 0.5), f.dt);

				// Zero-centred grain gives 4% depth at rest and 16% on hits without shifting
				// the mean.
				const depth = (0.04 + 0.12 * hit) * p.grain;
				const mean = (0.34 + loud * 0.28) * (0.5 + p.intensity * 0.6);

				for (let i = 0; i < g.count; i++) {
					const level = mean * (1 + depth * grain[i] * 2);
					// Keep colour spatial and inside base..glow; grain must not modulate
					// palette slots.
					const slot = lerp(SLOT.base, SLOT.glow, clamp(grain[i] + 0.5) * tone * 0.6);
					setSample(out, i, palette, slot + hueShift, clamp(level));
				}
			}
		};
	}
};
