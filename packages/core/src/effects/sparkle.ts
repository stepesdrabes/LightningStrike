import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, frac, paletteArc } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { BeatHold } from '../dsl/env.ts';
import { Rng } from '../dsl/rng.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

export const sparkle: EffectDef = {
	id: 'sparkle',
	name: 'Sparkle',
	role: 'accent',
	blurb: 'Micro-sparks on the hats, drawn around the band of the mix that is carrying the tune.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.4,
		quiet: 5.35,
		// Isolated points on black; between them the room is unlit.
		carries: false
	},
	params: [
		INTENSITY,
		param('rate', 'Sparks/sec', 120, 5, 400, 5),
		param('decay', 'Decay', 0.18, 0.02, 0.6),
		param('white', 'White share', 0.6)
	],
	create(g) {
		const rng = new Rng(0x51ed2701);
		// Use the spectrum for position and spawn colour. Glide position; hold each colour
		// choice.
		const where = new BeatHold(0.7);
		const tint = new BeatHold(0.1);
		const spread = new BeatHold(0.4);
		// Carry fractional spawn counts so density is independent of frame rate.
		let carry = 0;
		return {
			reset() {
				rng.seed(0x51ed2701);
				where.reset();
				tint.reset();
				spread.reset();
				carry = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				fadeToBlack(out, f.dt, p.decay);

				const tilt = spectralTilt(f);
				const at = where.update(tilt, f.beat, f.dt, f.beatPeriod);
				const hue = tint.update(tilt, f.beat, f.dt, f.beatPeriod);
				// Keep even narrow constellations across at least a third of the ring.
				const band = 0.34 + spread.update(1 - spectrumFocus(f), f.beat, f.dt, f.beatPeriod) * 0.66;
				// How far the music is allowed to move the constellation, from the cue's motion.
				const centre = 0.5 + (at - 0.5) * clamp(0.25 + motion * 0.75);

				// A drive floor keeps this a visible quiet-passage layer as well as a hat
				// response.
				carry += p.rate * clamp(0.3 + f.hatEnv * 0.7) * f.dt;
				const n = Math.floor(carry);
				carry -= n;

				const gain = 0.6 + p.intensity * 1.0;
				for (let k = 0; k < n; k++) {
					const pos = frac(centre + (rng.float() - 0.5) * band) * g.count;
					const i = Math.min(g.count - 1, Math.floor(pos));
					const strip = g.strips[g.strip[i]];
					const slot = rng.float() < p.white ? SLOT.white : paletteArc(hue);
					const c = sample(palette, slot + hueShift, gain * rng.range(0.55, 1));
					// A 1.5-pixel sigma is visible from the floor without a hot point.
					stampOnStrip(out, g.count, strip, pos - strip.offset, 1.5, c);
				}
			}
		};
	}
};
