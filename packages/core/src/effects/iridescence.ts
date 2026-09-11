import type { EffectDef } from '../contracts/effect.ts';
import { sample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, paletteArc } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { noise3 } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Wrapping noise creates thin-film fringes. Cross quickly between declared hues to avoid
 * spending the field on intermediate colours.
 */
export const iridescence: EffectDef = {
	id: 'iridescence',
	name: 'Iridescence',
	role: 'bed',
	blurb: 'Oil-slick interference fringes flowing slowly through the room.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 4.95,
		// A thin film reads as a sheen on a lit surface rather than as the light itself.
		carries: false
	},
	params: [INTENSITY, param('scale', 'Fringe scale', 0.45)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		// Smooth beat-energy readings for passage level.
		const passage = new Follower(0.1, 0.7);
		let clock = 0;
		let level = 0;

		return {
			reset() {
				clock = 0;
				level = 0;
				passage.reset();
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Use mid-spectrum content for motion within the bar.
				clock += f.dt * 0.05 * motion * (1 + bandBetween(f, 0.3, 0.7) * 0.8);
				// Keep a high floor because cue intensity already dims quiet passages.
				const passageLevel = passage.update(f.energy, f.dt);
				level = envelope(level, clamp(0.55 + passageLevel * 0.45), f.dt, 0.15, 0.9);
				const bright = level * (0.7 + p.intensity * 1.2);
				const scale = 1.5 + p.scale * 5;
				const t = clock;

				for (let i = 0; i < g.count; i++) {
					// Use time as the third noise axis; the fixture itself is coplanar.
					const n1 = noise3(g.nx[i] * scale + t, g.ny[i] * scale - t * 0.6, t * 0.3);
					const n2 = noise3(g.nx[i] * scale * 1.9 + 17, g.ny[i] * scale * 1.9 - t, 5.1);
					// paletteArc preserves the declared-hue fringes better than a linear slot
					// sweep.
					sample(palette, paletteArc(n1 * 1.6 + hueShift), (0.34 + 0.66 * n2 * n2) * bright, rgb);
					setPixel(buf, i, rgb[0], rgb[1], rgb[2]);
				}

				nblend(out, buf, alphaFor(f.dt, 0.09));
			}
		};
	}
};
