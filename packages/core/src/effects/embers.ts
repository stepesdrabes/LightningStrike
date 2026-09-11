import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { alphaFor, clamp, envelope, frac, lerp } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** Hash pixel phases against the bar clock so seeks reproduce twinkle without per-pixel state. */
export const embers: EffectDef = {
	id: 'embers',
	name: 'Embers',
	role: 'bed',
	blurb: 'Slow deterministic twinkle pools, more of them alight the tighter the music gets.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.2,
		quiet: 4.71,
		// A twinkle field: 22% of the room is lit at any instant and the rest is dark.
		carries: false
	},
	params: [INTENSITY, param('pool', 'Pool size', 0.4)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const h1 = new Float32Array(g.count);
		const h2 = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) {
			h1[i] = hash01(i);
			h2[i] = hash01(i * 7 + 13);
		}
		// Latch interpolated beat-energy readings before brightness modulation.
		const passage = new BeatHold(0.45);
		const spread = new BeatHold(0.3);
		// Hold hue choices without glide so embers never cross unchosen intermediate hues.
		const lean = new BeatHold(0);
		let level = 0;

		return {
			reset() {
				level = 0;
				buf.fill(0);
				passage.reset();
				spread.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const heard = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				level = envelope(level, clamp(0.2 + heard), f.dt, 0.2, 1.2);
				// Latch spectral population and hue choices while each ember keeps its own
				// twinkle.
				const focus = spread.update(spectrumFocus(f), f.beat, f.dt, f.beatPeriod);
				const split = 0.4 + lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod) * 0.35;
				const duty = (0.1 + p.pool * 0.3) * (0.5 + 0.5 * level) * (0.8 + focus * 0.6);
				const gain = 0.6 + p.intensity * 1.1;
				// Clock in bars, so the twinkle tempo breathes with the track.
				const clock = (f.barIndex + f.barPhase) * 0.5 * motion;
				// A dim floor softens gaps but does not make this a carrying layer.
				const bed = 0.38 * (0.55 + 0.45 * level);

				for (let i = 0; i < g.count; i++) {
					const speed = 0.35 + h1[i] * 0.65;
					const cycle = frac(clock * speed + h2[i] * 7.13);
					let v = 0;
					if (cycle < duty) {
						const u = cycle / duty;
						// Fast attack, slow decay: incandescent rather than LED-blinky.
						v = u < 0.25 ? u / 0.25 : 1 - (u - 0.25) / 0.75;
						v *= v;
					}
					// Keep embers above deep so the palette's near-black shade cannot erase
					// their light.
					const slot = h2[i] < split ? lerp(SLOT.base, SLOT.glow, h1[i]) : SLOT.third;
					setSample(buf, i, palette, slot + hueShift, bed + v * gain * (0.3 + 0.7 * h1[i]));
				}

				nblend(out, buf, alphaFor(f.dt, 0.09));
			}
		};
	}
};
