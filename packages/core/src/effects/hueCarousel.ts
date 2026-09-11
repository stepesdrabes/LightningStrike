import type { EffectDef } from '../contracts/effect.ts';
import { sample } from '../color/palette.ts';
import { clamp, paletteArc } from '../dsl/math.ts';
import { setPixel } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Quantized eighth-note steps make the palette wheel read as a musical machine, not a smooth
 * drift.
 */
export const hueCarousel: EffectDef = {
	id: 'hueCarousel',
	name: 'Hue Carousel',
	role: 'rhythm',
	blurb: "The show's colours around the ring, clicking in 8th-note steps, one rev per phrase.",
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false,
		activity: 0.2
	},
	params: [INTENSITY, param('barsPerRev', 'Bars per revolution', 8, 2, 16, 2)],
	create(g) {
		const rgb: [number, number, number] = [0, 0, 0];
		return {
			reset() {},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const steps = Math.max(2, p.barsPerRev) * 8;
				const stepIdx = Math.floor((f.barIndex + f.barPhase) * 8);
				const spin = (((stepIdx % steps) + steps) % steps) / steps;
				const gain = (0.14 + p.intensity * 0.32) * clamp(0.3 + f.energy * 0.9);

				for (let i = 0; i < g.count; i++) {
					const u = g.perim[i] >= 0 ? g.perim[i] : g.theta[i];
					// Square the bar-locked wave to leave dark gaps between colour bands.
					const w = 0.25 + 0.75 * Math.pow(sinewave(u * 3 - f.barPhase), 2);
					sample(palette, paletteArc(u - spin + hueShift), w * gain, rgb);
					setPixel(out, i, rgb[0], rgb[1], rgb[2]);
				}
			}
		};
	}
};
