import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt, spectrumPeak } from '../dsl/spectrum.ts';
import { Follower } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Keep the grid-driven breath alive after notes decay. Spectrum articulation adds above
 * the swell instead of gating it, so sparse riffs remain visible.
 */
export const breathe: EffectDef = {
	id: 'breathe',
	name: 'Breathe',
	role: 'accent',
	blurb: 'The whole room swelling on a two-bar cycle, tinted by what is left playing.',
	taste: {
		energy: 1,
		sections: ['intro', 'breakdown', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0,
		quiet: 3.17
	},
	params: [INTENSITY, param('bars', 'Bars per breath', 0.5), param('tilt', 'Colour travel', 0.5)],
	create(g) {
		// The passage's own level. Slow on purpose: this is how loud the passage is, not what it
		// is doing, and it only ever trims the gain.
		const level = new Follower(0.08, 0.7);
		const hue = new Follower(0.15, 0.45);
		// Subtract a slow spectral baseline to isolate struck-note articulation from sustained
		// level.
		const voice = new Follower(0.03, 0.22);
		const floor = new Follower(0.7, 1.4);

		return {
			reset() {
				level.reset();
				hue.reset();
				voice.reset();
				floor.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// From the bar index and phase rather than from a clock, so a seek lands in the
				// same part of the breath the music is in.
				const period = 2 + Math.round(clamp(p.bars) * 2);
				const cycle = (f.barIndex % period) + f.barPhase;
				const swell = sinewave(cycle / period);

				// What is left playing decides the tint; the swell decides the shape.
				const colour = hue.update(spectralTilt(f), f.dt);
				// Use only light energy scaling so low-energy passages remain visible.
				const heard = level.update(f.energy, f.dt);
				const gain = (0.3 + p.intensity * 0.6) * clamp(0.55 + heard * 0.45);
				// Add peak articulation; multiplying would erase the breath in a decayed outro.
				const peak = spectrumPeak(f);
				const played = clamp((voice.update(peak, f.dt) - floor.update(peak, f.dt)) * 3) * 0.55;
				// Latched spectral tilt controls spatial breath lag without controlling level.
				const depth = lerp(0.15, 0.5, colour);
				const tint = lerp(SLOT.base, SLOT.third, colour * p.tilt);

				for (let i = 0; i < g.count; i++) {
					// Offset around the room, so the breath arrives at the far wall a moment after
					// the near one and the room has depth.
					const lag = sinewave(cycle / period - ringU(g, i) * depth);
					// Scale articulation by the breath so highlights belong to the same
					// gesture.
					const v = clamp(0.35 + (swell * 0.5 + lag * 0.5) * 0.65 + played * (0.4 + lag * 0.6));
					setSample(out, i, palette, lerp(tint, SLOT.glow, v * 0.4) + hueShift, v * gain);
				}
			}
		};
	}
};
