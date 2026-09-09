import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { Follower, Presence, PulseEnv } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { GAMMA } from '../output.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The share of the perimeter's LIGHT that crosses to the beam at a full hit.
 *
 * It reads larger than it looks because the beam is a fifth of the pixels, so half of the
 * ring's light arriving there is several times what that strip was carrying. Raised from a
 * quarter when the floor came down: the trade is the whole gesture, and at a low floor a
 * quarter of it was a flicker.
 */
const TRADE_SHARE = 0.7;

/**
 * The room's weight trades between the perimeter and the beam on every kick, at constant
 * total output.
 *
 * The frame's one architectural fact is that it is a closed ring with a bar across the middle,
 * and no effect in the catalog uses that as a compositional axis - the beam is either masked
 * out, given a fixed spill, or handed the mean. Here it is the other half of a see-saw: the
 * ring gives up a quarter of its light and the beam takes exactly that back, which at a fifth
 * of the pixel count is a much larger move per pixel. So the room's centre of gravity pulses
 * hard while its total output does not move at all.
 *
 * Conserved displacement is the one gesture the eye reads as physics rather than as a dimmer,
 * and because the global level is flat it never raises the adaptation state - a whole-room
 * pulse at four-on-the-floor is 2 Hz of full-field modulation, which is exactly the rate at
 * which each successive hit lands with less contrast than the last.
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

		// How the beam receives what the ring gives up. Normalised to unit mean, so whatever
		// shape this is the conservation arithmetic below stays exact.
		const profile = new Float32Array(g.count);
		let beamPixels = 0;
		let sum = 0;
		for (let i = 0; i < g.count; i++) {
			if (g.perim[i] >= 0) continue;
			// Centre-out, so the trade gathers at the middle of the room rather than reading
			// as a bar switching on.
			const d = Math.abs(g.local[i] - 0.5) * 2;
			profile[i] = 1 - d * d * 0.75;
			sum += profile[i];
			beamPixels++;
		}
		const mean = sum / Math.max(1, beamPixels);
		for (let i = 0; i < g.count; i++) if (g.perim[i] < 0) profile[i] /= Math.max(1e-3, mean);
		// What the ring gives up has to arrive on a fifth as many pixels, so the beam's own
		// share moves five times as far. Read from the geometry rather than assumed, because a
		// room with a different frame divides differently.
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

				// A transient's resting level, not a bed's: at 0.63 this was the brightest
				// constant thing in any stack it joined, 112 bytes of flat light over the bed.
				const floor = 0.07 + p.intensity * 0.09;
				// The share of the ring's LIGHT that crosses the room at a full hit.
				const give = TRADE_SHARE * p.trade * v;

				// Conserved in light, not in authoring units. The authoring domain is gamma
				// encoded, so trading equal authoring level moves unequal light and the room
				// would brighten on every kick by exactly the amount this effect exists not to
				// spend. Same lesson the lounge handover learned when two looks mixed in the
				// authoring domain dropped the room to 60% of its own brightness mid-dissolve.
				// `GAMMA` is imported rather than written down here: the room's exponent is a
				// measured property of the strips that has already moved once (2.2 -> 2.45), and
				// a second copy of it would silently stop conserving anything the next time.
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
