import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY } from './helpers.ts';

/**
 * The rock build is a held breath rather than a snare-roll meter: the whole room swells
 * while a vibrato shimmer tightens from a slow wow into a scream, released on the one.
 */
export const feedbackSwell: EffectDef = {
	id: 'feedbackSwell',
	name: 'Feedback Swell',
	role: 'rhythm',
	blurb: 'The room swells and its shimmer tightens, like feedback into the chorus.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 0.3
	},
	params: [INTENSITY],
	create(g) {
		// Where the arrangement sits decides the shimmer's pitch and the colour it drains
		// through. Latched, so those only change on a beat instead of following the spectrum's
		// own noise at the frame rate.
		const tilt = new BeatHold(0.4);
		const focus = new BeatHold(0.25);
		let fill = 0;
		let shimmer = 0;

		return {
			reset() {
				tilt.reset();
				focus.reset();
				fill = 0;
				shimmer = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const perBeat = f.dt / Math.max(0.05, f.beatPeriod);
				fill = clamp(fill + clamp(f.buildProgress - fill, -perBeat * 1.5, perBeat * 0.25));
				if (fill < 0.01) {
					out.fill(0);
					return;
				}

				const bright = tilt.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const focused = focus.update(spectrumFocus(f), f.beat, f.dt, f.beatPeriod);

				// Cycles per beat rather than per second: a scream that arrives on the one is the
				// whole gesture, and at a fixed rate it arrives wherever the tempo leaves it.
				shimmer += perBeat * (0.7 + fill * fill * 10) * motion;
				const gain = (0.6 + p.intensity * 1.2) * (0.25 + fill * 0.75);
				// A single sustained note ripples in a tight band; a full arrangement spreads it
				// around the room.
				const waves = 3 + bright * 8;
				// Colour drains toward white as the feedback peaks, and further as the passage
				// fills out, so a thin build and a dense one do not read the same.
				// The swell may bleach toward white; the spectrum may not push it there. See meterBuild.
				const slot = lerp(lerp(SLOT.base, SLOT.glow, clamp(1 - focused)), SLOT.white, clamp(fill * fill * 0.8));

				for (let i = 0; i < g.count; i++) {
					const vib = 1 - 0.35 * fill * (0.5 + 0.5 * sinewave(ringU(g, i) * waves + shimmer));
					setSample(out, i, palette, slot + hueShift, gain * vib);
				}
			}
		};
	}
};
