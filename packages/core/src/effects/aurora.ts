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

/** Interference among 8-, 16- and 32-beat waves creates the bright seams. */
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
		quiet: 4.90,
		// Curtain gaps leave too much darkness to carry a quiet cue alone.
		carries: false
	},
	params: [INTENSITY, param('waves', 'Wave scale', 0.5)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const ph = new Float32Array(3);
		const slots = [SLOT.base, SLOT.third, SLOT.glow];
		const gains = [0.5, 0.35, 0.3];
		// Latch musical modulation to prevent frame-rate seam movement.
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
				// Keep a high floor because cue intensity already dims quiet passages.
				const gain = (0.3 + p.intensity * 0.6) * clamp(0.6 + heard * 0.4);
				const scale = 1.5 + p.waves * 3.5;
				// Busy top end lowers the bar for a highlight, so dense passages shimmer.
				const threshold = 0.62 - air.update(f.bands[Band.Air], f.beat, f.dt, f.beatPeriod) * 0.2;
				// Different offsets let the arrangement move the interference seams.
				const walk = tilt * 0.3;
				// Keep spectral tint in the nearly constant-flux base..glow span.
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
