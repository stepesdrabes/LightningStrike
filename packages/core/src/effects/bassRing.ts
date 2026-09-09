import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { bandAt, bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/**
 * The perimeter carries the whole effect and the ceiling beam stays dark; that contrast
 * is what makes it read as a glow from below rather than as "lights on".
 *
 * The ring is a bass analyser wrapped around the room: each stretch of wall glows with its own
 * partial of the bottom end, so a bassline walking up shows as movement around the room rather
 * than as the whole perimeter breathing together. It used to read one number for everything -
 * `f.bands`, which is a per-beat envelope and cannot move inside a bar - and light 78% of the
 * room with it in a single hue.
 */
/** How far up the spectrum the ring reads. Above this it stops being bass. */
const BASS_TOP = 0.3;

export const bassRing: EffectDef = {
	id: 'bassRing',
	name: 'Bass Ring',
	role: 'bed',
	blurb: 'Deep perimeter underglow, each wall riding its own partial of the bass.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 2.17,
		// The dark ceiling beam is the whole point of the look, and it is also why this cannot
		// be the only thing in a cue: one of the room's five strips is off at all times.
		carries: false
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		// Eight is enough for the ring to show a bassline moving and few enough that each tap
		// still owns an audible slice of a range only a third of the spectrum wide.
		const TAPS = 8;
		const taps = Array.from({ length: TAPS }, () => new Follower(0.028, 0.17));
		const held = new Float32Array(TAPS);
		/**
		 * How much of the bottom end is harmonics rather than fundamental.
		 *
		 * A clean sine sub is the room's own colour; a bass with grit on it has content an
		 * octave up, and that is what earns a second hue. Slow on purpose: the slots differ in
		 * luminance as well as in hue, so a colour driven at the speed of a note is a brightness
		 * driven at the speed of a note.
		 */
		const grit = new Follower(0.2, 0.7);
		let env = 0;

		return {
			reset() {
				env = 0;
				for (const t of taps) t.reset();
				grit.reset();
				held.fill(0);
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				for (let k = 0; k < TAPS; k++) {
					held[k] = taps[k].update(bandAt(f, (k / (TAPS - 1)) * BASS_TOP), f.dt);
				}

				// The room's overall bass level still drives brightness as one number, because a
				// glow from below is one glow. Both constants are beats rather than seconds, so it
				// keeps the track's time at any tempo, and the slow release is what makes this an
				// 808 tail rather than a kick's snap.
				//
				// 2.2, not the 1.5 that stood here when this read `f.bands`. The two are not the
				// same scale: a band envelope is normalised across the track and reaches 1.0 in
				// any loud passage, while the spectrum is a fixed window against the track's loud
				// passages and sits well under it. Swapping one for the other at the same gain
				// took a third of the room's fill with it. Swept: 1.5 delivers 0.43 of the room,
				// 2.2 delivers 0.60, and 2.8 delivers 0.67 but starts flattening the reaction.
				const bottom = bandBetween(f, 0, 0.14);
				env = envelope(
					env,
					clamp(bottom * 2.2 + f.kickEnv * 0.25),
					f.dt,
					Math.max(0.03, f.beatPeriod * 0.1),
					Math.max(0.18, f.beatPeriod * 0.9)
				);
				const bright = env * (0.35 + p.intensity * 0.7);
				const harmonics = grit.update(
					clamp(bandBetween(f, 0.14, BASS_TOP) * 1.4 - bottom * 0.5),
					f.dt
				);

				for (let i = 0; i < g.count; i++) {
					if (g.perim[i] < 0) {
						setPixel(buf, i, 0, 0, 0);
						continue;
					}
					// Around the ring, and mirrored so both halves of the room read low-to-high
					// from the front wall rather than the seam landing wherever strip 0 starts.
					const around = g.perim[i];
					const fold = around < 0.5 ? around * 2 : (1 - around) * 2;
					const at = fold * (TAPS - 1);
					const k = Math.min(TAPS - 2, Math.floor(at));
					const partial = held[k] + (held[k + 1] - held[k]) * (at - k);

					// Colour is WHICH partial this stretch of wall shows, never how loud it is: an
					// underglow that changes hue with its own level is a brightness change wearing
					// a colour's clothes.
					//
					// The span has to cross `third` to be a colour change at all - `deep`, `base`
					// and `glow` are one hue at three lightnesses - and how far it crosses is how
					// much grit the bass has. A clean sine sub keeps the ring in the room's own
					// colour; a bass with harmonics on it spreads the ring across the palette,
					// which is the difference an ear already hears.
					const slot = lerp(SLOT.base, SLOT.third, fold * (0.45 + harmonics * 0.55));

					// Slow undulation so the glow reads as a liquid, not a tube light, and a
					// shallow relief from this stretch's own partial on top of it.
					const wave = 0.8 + 0.2 * sinewave(around * 2 + (f.barIndex + f.barPhase) * 0.05 * motion);
					setSample(buf, i, palette, slot + hueShift, bright * wave * (0.7 + partial * 0.6));
				}

				nblend(out, buf, alphaFor(f.dt, 0.06));
			}
		};
	}
};
