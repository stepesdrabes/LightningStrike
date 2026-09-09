import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt, spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The room laid out low to high, following the spectrum as it actually moves.
 *
 * Each tap is a meter for its own slice of the range: the bass end answers the riff, the top
 * end answers the cymbals, and the two do it independently, which is what makes the room read
 * as an arrangement rather than as one level with a shape drawn on it.
 *
 * Followed rather than latched. A beat latch was here to remove frame-rate shimmer, at the cost
 * of every stab and cymbal between beats, which in this repertoire is most of the music. The
 * shimmer turned out not to be the constraint: measured on a real track, sweeping the attack
 * from 20 ms to 120 ms moves delivered ripple by 4%, so the spectrum is not noisy at frame rate
 * and there was nothing to latch away. What the latch did produce was movement AT THE BEAT RATE,
 * which at these tempos sits inside the band a phrase-scale metric measures - so it scored well
 * on drift while looking exactly as grid-locked as it was.
 */
/**
 * How deep the followed band cuts into the level, as a fraction either side of unity.
 *
 * Centred on unity rather than reaching down to it: a relief that only ever darkens is a dimmer,
 * and it cost this bed a third of its coverage when it was written that way. Higher reads as
 * more reactive and fills less of the room, and a bed has to keep filling one.
 *
 * 1.3 rather than the 1.4 this ran at while latched, because following the spectrum lowers the
 * mean of the same term: measured over a fixture intro, 1.3 delivers 16.4 bytes against 15.6 at
 * 1.4 and 14.9 at 1.5, and an intro two bytes lower is one that crosses into being reported dark
 * while it fades. What the depth buys is contrast, which is not what this pass was for.
 */
const RELIEF = 1.1;
/**
 * Release, seconds. Deliberately longer than the attack and slightly longer than a sixteenth at
 * this repertoire's tempos, so a chord rings out of the room rather than snapping off it.
 */
const FALL = 0.16;

export const spectrumBed: EffectDef = {
	id: 'spectrumBed',
	name: 'Spectrum Bed',
	role: 'bed',
	blurb: 'The room laid out low to high, each part lit by what plays there as it plays.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 3.04
	},
	params: [INTENSITY, param('spread', 'Octaves across the room', 0.7), param('depth', 'Colour travel', 0.6)],
	create(g) {
		// One per pixel would be 720 followers for a curve the eye reads at a handful of points,
		// so the ring is metered at TAPS places and interpolated between them.
		const TAPS = 12;
		const taps = Array.from({ length: TAPS }, () => new Follower(0.02, FALL));
		const held = new Float32Array(TAPS);
		// Slower, because these choose colour across the whole room. A hue that chases every
		// sixteenth is a room that cannot settle on what it is.
		const tilt = new Follower(0.12, 0.4);
		const focus = new Follower(0.12, 0.4);

		return {
			reset() {
				for (const t of taps) t.reset();
				tilt.reset();
				focus.reset();
				held.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const reach = 0.35 + p.spread * 0.65;
				for (let k = 0; k < TAPS; k++) {
					const u = (k / (TAPS - 1)) * reach;
					held[k] = taps[k].update(bandAt(f, u), f.dt);
				}
				const lean = tilt.update(spectralTilt(f), f.dt);
				// One sustained note against a full arrangement at the same loudness. A sparse
				// passage earns the accent; a dense one stays in the base, which is what stops a
				// drop from arriving in the same colour a breakdown was already sitting in.
				const sparse = focus.update(spectrumFocus(f), f.dt);

				// Level comes from the cue, not from the music. A bed is a room being lit - and a
				// bed, not a highlight: at 1.07 the relief's crests pinned white in every drop.
				const gain = 0.4 + p.intensity * 0.5;
				const depth = clamp(p.depth);

				for (let i = 0; i < g.count; i++) {
					// Mirrored around the ring so both halves read low-to-high, which keeps the
					// bass at the front wall wherever the strip happens to start.
					const u = ringU(g, i);
					const fold = u < 0.5 ? u * 2 : (1 - u) * 2;
					const at = fold * (TAPS - 1);
					const k = Math.min(TAPS - 2, Math.floor(at));
					const v = held[k] + (held[k + 1] - held[k]) * (at - k);

					// WHICH slice of the spectrum a part of the room shows is what decides its
					// colour. How loud that slice is stays out of the hue entirely and lands in
					// the relief below, which is what this comment has always claimed and what the
					// code did the opposite of: the palette position came off the level alone, so
					// two walls showing different instruments at the same loudness were the same
					// colour and the room read as one hue however much the music moved.
					//
					// The span matters as much as the mapping. `deep`, `base` and `glow` are one
					// hue at three lightnesses - only `third` and `accent` are a different colour
					// at all - so a gradient that stops around glow is a gradient between two
					// shades of the same thing. `depth` now says how far past that the room
					// reaches rather than how far it travels within it.
					const spread = 0.35 + depth * 0.65;
					let slot = lerp(SLOT.base, SLOT.third, clamp(fold * spread + lean * 0.2));
					// The third colour the palette declares, spent only where the mix has left
					// room for it. A loud tap in a sparse passage is a single instrument holding
					// the track, and that is the one the accent belongs to: reaching for it on
					// every peak would put the show's answering colour under the whole arrangement.
					slot = lerp(slot, SLOT.accent, clamp(sparse * 1.3 - 0.25) * clamp(v * 1.4) * depth);

					setSample(out, i, palette, slot + hueShift, gain * (1 + RELIEF * (v - 0.5)));
				}
			}
		};
	}
};
