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
 * Keep the beam dark for underglow contrast. Separate spectral taps show bassline movement
 * around the perimeter.
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
		quiet: 4.54,
		// The permanently dark beam prevents this from carrying a cue alone.
		carries: false
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		// Eight taps balance moving detail against audible bass-band width.
		const TAPS = 8;
		const taps = Array.from({ length: TAPS }, () => new Follower(0.028, 0.17));
		const held = new Float32Array(TAPS);
		/**
		 * Higher bass harmonics earn a second hue. Smooth slowly because hue-slot changes also
		 * alter light.
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

				// Use beat-derived attack/release for an 808 tail. Gain 2.2 compensates for the
				// spectrum's
				// lower scale than normalized band envelopes without flattening its response.
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
					// Mirror low-to-high taps from the front wall on both halves.
					const around = g.perim[i];
					const fold = around < 0.5 ? around * 2 : (1 - around) * 2;
					const at = fold * (TAPS - 1);
					const k = Math.min(TAPS - 2, Math.floor(at));
					const partial = held[k] + (held[k + 1] - held[k]) * (at - k);

					// Colour varies with spatial partials; slowly measured harmonic grit
					// controls the reach toward third.
					const slot = lerp(SLOT.base, SLOT.third, fold * (0.45 + harmonics * 0.55));

					// Slow undulation and shallow per-tap relief keep the glow liquid.
					const wave = 0.8 + 0.2 * sinewave(around * 2 + (f.barIndex + f.barPhase) * 0.05 * motion);
					setSample(buf, i, palette, slot + hueShift, bright * wave * (0.7 + partial * 0.6));
				}

				nblend(out, buf, alphaFor(f.dt, 0.06));
			}
		};
	}
};
