import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Several simple layers at different musical rates beat one complex layer: the bright
 * seams appear where the 8, 16 and 32-beat waves constructively interfere, so they are
 * emergent rather than authored.
 */
export const aurora: EffectDef = {
	id: 'aurora',
	name: 'Aurora',
	role: 'bed',
	blurb: 'Three bar-locked palette waves whose seams travel with the arrangement.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.05,
		quiet: 2.78,
		// Curtains with dark between them: 36% of its light in a tenth of the pixels. Lovely
		// under something, and a quiet cue lit by this alone shows as bands with gaps.
		carries: false
	},
	params: [INTENSITY, param('waves', 'Wave scale', 0.5)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const ph = new Float32Array(3);
		const slots = [SLOT.base, SLOT.third, SLOT.glow];
		const gains = [0.5, 0.35, 0.3];
		// Everything the music drives is latched on the beat. A threshold or a phase that
		// follows the spectrum frame by frame moves the seams at the frame rate, which is the
		// one thing a bed must never do.
		const lean = new BeatHold(0.35);
		const passage = new BeatHold(0.45);
		const air = new BeatHold(0.2);

		return {
			reset() {
				ph.fill(0);
				buf.fill(0);
				lean.reset();
				passage.reset();
				air.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const bp = Math.max(0.2, f.beatPeriod);
				ph[0] += (f.dt / (8 * bp)) * motion;
				ph[1] -= (f.dt / (16 * bp)) * motion;
				ph[2] += (f.dt / (32 * bp)) * motion;

				const tilt = lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const heard = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				// The floor is high because the cue's own intensity already says the passage is
				// quiet. A bed that dims itself as well is dimmed twice, and two multiplications
				// of a number under one is how an intro reached byte zero.
				const gain = (0.3 + p.intensity * 0.6) * clamp(0.6 + heard * 0.4);
				const scale = 1.5 + p.waves * 3.5;
				// Busy top end lowers the bar for a highlight, so dense passages shimmer.
				const threshold = 0.62 - air.update(f.bands[Band.Air], f.beat, f.dt, f.beatPeriod) * 0.2;
				// Each layer slides a different distance as the arrangement climbs, so where the
				// seams land is the music's business and not only the clock's.
				const walk = tilt * 0.3;
				// The lightest layer tints toward white with it. Inside one hue on purpose: a walk
				// between two of the show's hues spends most of its time on neither.
				// A spectral term may only walk the slot inside base..glow. That span is safe because it
				// is a SATURATION move at constant flux (measured x1.03 over 24 hues); crossing to
				// white is x2.66, a spectrum driving BRIGHTNESS through the palette, which is the
				// blinking the mixer already had to be rescued from once.
				const top = lerp(SLOT.base, SLOT.glow, clamp(tilt));

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					let r = 0;
					let gr = 0;
					let b = 0;
					let lum = 0;
					for (let l = 0; l < 3; l++) {
						const wave = sinewave(u * scale * (l + 1) * 0.7 + ph[l] + l * 0.31 + walk * (l + 1));
						const c = sample(palette, (l < 2 ? slots[l] : top) + hueShift, wave * gains[l] * gain);
						r += c[0];
						gr += c[1];
						b += c[2];
						lum += wave * gains[l];
					}
					if (lum > threshold) {
						const w = sample(palette, SLOT.white + hueShift, (lum - threshold) * 1.0 * gain);
						r += w[0];
						gr += w[1];
						b += w[2];
					}
					setPixel(buf, i, r, gr, b);
				}

				nblend(out, buf, alphaFor(f.dt, 0.1));
			}
		};
	}
};
