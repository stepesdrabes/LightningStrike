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
 * Two bars in, two bars out, across the whole room.
 *
 * The quietest thing here that is still doing something, and the one to reach for when a
 * passage should feel held rather than lit. It takes its period from the bar table, so it
 * breathes with the song at any tempo and stays in phase with it across a track that drifts.
 *
 * The spectrum never GATES it: an outro where the last note has decayed should still show the
 * room breathing, or the track ends by looking switched off. What it does do is ride on top,
 * as articulation above the swell rather than as a multiplier into it. An intro with a riff in
 * it was being lit by nothing but the bar table, which is a metronome with the room attached.
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
		// What is actually being played, at the rate it is played, against a slow baseline of the
		// same signal. The difference is the articulation and not the level: a sustained pad sits
		// at the baseline and adds nothing, a struck chord rises above it and shows. Reading the
		// level directly instead just lifted the room by a constant and left the breath doing all
		// the moving, which is the thing this is here to fix.
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
				// Only a light energy term: this exists for the passages that have no energy, so
				// scaling it hard by the thing it is written for would leave it with nothing.
				const heard = level.update(f.energy, f.dt);
				const gain = (0.3 + p.intensity * 0.6) * clamp(0.55 + heard * 0.45);
				// Added, never multiplied. At zero the room breathes exactly as it did before, so
				// the decayed outro is unchanged; with a riff in the passage the swell picks up the
				// notes on its way past. The peak rather than a band, because in a passage this
				// bare whatever is playing IS the loudest thing in the spectrum.
				const peak = spectrumPeak(f);
				const played = clamp((voice.update(peak, f.dt) - floor.update(peak, f.dt)) * 3) * 0.55;
				// How far the breath lags across the room rides on the same latched tilt: a bright
				// passage reaches the far wall well after the near one, a dark one moves as one
				// body. The spectrum may move the room without being allowed to light it.
				const depth = lerp(0.15, 0.5, colour);
				const tint = lerp(SLOT.base, SLOT.third, colour * p.tilt);

				for (let i = 0; i < g.count; i++) {
					// Offset around the room, so the breath arrives at the far wall a moment after
					// the near one and the room has depth.
					const lag = sinewave(cycle / period - ringU(g, i) * depth);
					// The breath decides where the room is in its cycle; what is playing decides
					// how far above that it reaches. Where the breath is already high the note
					// lands as a highlight, where it is low it barely shows, so the two read as
					// one gesture rather than as a light with a meter drawn over it.
					const v = clamp(0.35 + (swell * 0.5 + lag * 0.5) * 0.65 + played * (0.4 + lag * 0.6));
					setSample(out, i, palette, lerp(tint, SLOT.glow, v * 0.4) + hueShift, v * gain);
				}
			}
		};
	}
};
