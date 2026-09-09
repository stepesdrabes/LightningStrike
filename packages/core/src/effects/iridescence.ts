import type { EffectDef } from '../contracts/effect.ts';
import { sample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, paletteArc } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { noise3 } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Thin-film interference: colour is a WRAPPING function of the noise field, so it repeats in
 * fringes like a soap bubble. The fringes rest on the show's own three colours and cross between
 * them quickly, because a linear sweep the length of the palette spends most of its travel on
 * blends the show never declared, which is the difference between a sheen and tie-dye.
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
		quiet: 2.43,
		// A thin film reads as a sheen on a lit surface rather than as the light itself.
		carries: false
	},
	params: [INTENSITY, param('scale', 'Fringe scale', 0.45)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		// How loud the passage is, which is a level and belongs slow. `f.energy` is beat resolution
		// whatever it is passed through, so this only ever sets where the bed sits.
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

				// The mid of the spectrum rather than `f.bands`, so the field's travel answers the
				// arrangement within the bar instead of stepping once a beat.
				clock += f.dt * 0.05 * motion * (1 + bandBetween(f, 0.3, 0.7) * 0.8);
				// The floor is high because the cue's own intensity already says the passage is
				// quiet. A bed that dims itself as well is dimmed twice, and two multiplications
				// of a number under one is how an intro reached byte zero.
				const passageLevel = passage.update(f.energy, f.dt);
				level = envelope(level, clamp(0.55 + passageLevel * 0.45), f.dt, 0.15, 0.9);
				const bright = level * (0.7 + p.intensity * 1.2);
				const scale = 1.5 + p.scale * 5;
				const t = clock;

				for (let i = 0; i < g.count; i++) {
					// The plan is the only extent this fixture has: every run sits in the same plane,
					// so a third spatial axis would carry nothing. Time takes that axis instead and
					// the film flows as one sheet.
					const n1 = noise3(g.nx[i] * scale + t, g.ny[i] * scale - t * 0.6, t * 0.3);
					const n2 = noise3(g.nx[i] * scale * 1.9 + 17, g.ny[i] * scale * 1.9 - t, 5.1);
					// `paletteArc` and not a lerp between two slots. Slot space is a ring of declared
					// colours with blends in between, so interpolating from one to the next spends
					// most of its travel on hues the show never declared: measured, that took the
					// share of lit bytes on a palette hue from 82% to 10%.
					sample(palette, paletteArc(n1 * 1.6 + hueShift), (0.34 + 0.66 * n2 * n2) * bright, rgb);
					setPixel(buf, i, rgb[0], rgb[1], rgb[2]);
				}

				nblend(out, buf, alphaFor(f.dt, 0.09));
			}
		};
	}
};
