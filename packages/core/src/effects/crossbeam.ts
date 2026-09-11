import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { Follower, Presence, PulseEnv } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { GAMMA } from '../output.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Share of perimeter light transferred at a hit. Concentrating it onto the shorter beam
 * amplifies per-pixel movement.
 */
const TRADE_SHARE = 0.7;

/**
 * Conserve total light while kicks move it between ring and beam, preserving contrast
 * without raising whole-room adaptation.
 */
export const crossbeam: EffectDef = {
	id: 'crossbeam',
	name: 'Crossbeam',
	role: 'transient',
	blurb: 'The kick trades light from the perimeter to the beam and back.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		kit: 'kick'
	},
	params: [INTENSITY, param('trade', 'How much moves', 0.6)],
	create(g) {
		const hit = new PulseEnv();
		const kit = new Presence();
		/** A track with no real bottom end trades less: the gesture is the bass arriving. */
		const weight = new Follower(0.2, 0.8);

		// Normalize beam shape to unit mean so spatial shaping preserves the light transfer.
		const profile = new Float32Array(g.count);
		let beamPixels = 0;
		let sum = 0;
		for (let i = 0; i < g.count; i++) {
			if (g.perim[i] >= 0) continue;
			const d = Math.abs(g.local[i] - 0.5) * 2;
			profile[i] = 1 - d * d * 0.75;
			sum += profile[i];
			beamPixels++;
		}
		const mean = sum / Math.max(1, beamPixels);
		for (let i = 0; i < g.count; i++) if (g.perim[i] < 0) profile[i] /= Math.max(1e-3, mean);
		// Derive pixel-count ratio from geometry so transfer conserves light for any frame.
		const ringPixels = Math.max(1, g.count - beamPixels);
		const leverage = ringPixels / Math.max(1, beamPixels);

		return {
			reset() {
				hit.reset();
				kit.reset();
				weight.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);
				if (f.kick) hit.fire(clamp(0.4 + f.kickEnv * 0.6) * playing);
				const reach = weight.update(clamp(bandBetween(f, 0, 0.12) * 1.8), f.dt);
				const v = hit.decay(f.dt, f.beatPeriod, 0.9 / Math.max(0.05, motion)) * reach;

				// Keep the resting level below a bed's so this transient cannot dominate the
				// stack.
				const floor = 0.07 + p.intensity * 0.09;
				const give = TRADE_SHARE * p.trade * v;

				// Conserve in linear light using the shared GAMMA. Equal authoring-unit
				// transfers would
				// change total light, and a duplicated exponent could drift from the output
				// chain.
				const ringScale = Math.pow(Math.max(0, 1 - give), 1 / GAMMA);

				for (let i = 0; i < g.count; i++) {
					const onBeam = g.perim[i] < 0;
					const level = onBeam
						? floor * Math.pow(1 + give * leverage * profile[i], 1 / GAMMA)
						: floor * ringScale;
					setSample(out, i, palette, SLOT.base + hueShift, clamp(level));
				}
			}
		};
	}
};
