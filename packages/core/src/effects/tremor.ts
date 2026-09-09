import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { hash01 } from '../dsl/rng.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The room's GRAIN answers the kit while its level does not.
 *
 * Every pixel carries a fixed deterministic offset, and what the drums move is how deeply
 * that texture is cut: barely at rest, visibly on a hit, easing back over half a beat. The
 * mean is constant, so nothing brightens and nothing flashes - at 60 LED/m seen from under
 * the frame this reads as the room graining rather than as an event, because there is no
 * coherent edge for the eye to be pulled to. Abrupt onsets and luminance increments capture
 * gaze; a change in VARIANCE does not, while still being something peripheral vision tracks
 * well.
 *
 * `taste.kit` is deliberately absent. Over a passage with no drums at all this settles into a
 * still, even, fully-covering field, which is exactly what an intro wants - and it is why
 * this can carry a bare cue where a kick-declaring effect would be refused outright. The
 * carrying accent pool was three effects for intro, outro and breakdown alike, none of which
 * read the kit at all; this is the fourth, and the first that does.
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
		// Measured over the cache's real quiet sections: mid-pack among the carrying accents,
		// which is where a fourth one has to land to be worth adding rather than to be the one
		// never picked.
		quiet: 2.18
	},
	params: [INTENSITY, param('grain', 'Grain depth', 0.6)],
	create(g) {
		// Rolled once, never re-rolled: the texture has to be the room's own fixed surface, or
		// it reads as noise rather than as grain. Two fresh instances must agree bit for bit.
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

				// The whole gesture: 4% of the level at rest, 16% on a hit. The mean is the same
				// either way, because the grain is centred on zero.
				const depth = (0.04 + 0.12 * hit) * p.grain;
				const mean = (0.34 + loud * 0.28) * (0.5 + p.intensity * 0.6);

				for (let i = 0; i < g.count; i++) {
					const level = mean * (1 + depth * grain[i] * 2);
					// Colour by POSITION only, and only inside base..glow, which is the span that
					// costs no light. The grain never touches the slot: a texture in hue would be
					// a texture in brightness wearing a palette's clothes.
					const slot = lerp(SLOT.base, SLOT.glow, clamp(grain[i] + 0.5) * tone * 0.6);
					setSample(out, i, palette, slot + hueShift, clamp(level));
				}
			}
		};
	}
};
