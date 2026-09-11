import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower, Presence, PulseEnv } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Kick-driven glow -> base resaturation changes perceived brightness with nearly constant flux.
 * Keep temporal movement inside base..glow; crossing white would add a flash.
 */
export const emberBump: EffectDef = {
	id: 'emberBump',
	name: 'Ember Bump',
	role: 'rhythm',
	blurb: 'The room saturates on the kick and cools back, at constant total output.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1,
		// Requires kicks; without them the whole gesture is absent.
		kit: 'kick'
	},
	params: [INTENSITY, param('lag', 'Front-to-back lag', 0.5)],
	create(g) {
		const hit = new PulseEnv();
		// Permission, not timing: when the kit rests, so does the bump.
		const kit = new Presence();
		/** Where the light sits in the room, slowly. Position may move; level may not. */
		const tilt = new Follower(0.4, 0.9);
		// Front of the room to the back, 0..1, so the lag has a coordinate to run along.
		const depth = new Float32Array(g.count);
		let near = Infinity;
		let far = -Infinity;
		for (let i = 0; i < g.count; i++) {
			if (g.ny[i] < near) near = g.ny[i];
			if (g.ny[i] > far) far = g.ny[i];
		}
		const span = Math.max(1e-3, far - near);
		for (let i = 0; i < g.count; i++) depth[i] = (g.ny[i] - near) / span;

		return {
			reset() {
				hit.reset();
				kit.reset();
				tilt.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);
				if (f.kick) hit.fire(clamp(0.45 + f.kickEnv * 0.55) * playing);
				const v = hit.decay(f.dt, f.beatPeriod, 0.75 / Math.max(0.05, motion));

				// Use spectral position to place the room's weight.
				const centre = tilt.update(clamp(0.5 + spectralTilt(f) * 0.5), f.dt);
				const level = 0.16 + p.intensity * 0.17;

				for (let i = 0; i < g.count; i++) {
					// Lag the back by tens of milliseconds so resaturation sweeps through the
					// room.
					const lagged = clamp(v - depth[i] * 0.18 * p.lag);
					// Saturation, NOT lightness. The only span where a fast signal is safe.
					const slot = lerp(SLOT.glow, SLOT.base, lagged);
					// A shallow, slowly moving spatial shape preserves the bed under the rhythm
					// layer.
					const u = ringU(g, i);
					const shape = 0.82 + 0.18 * sinewave(u + centre);
					setSample(out, i, palette, slot + hueShift, level * shape);
				}
			}
		};
	}
};
