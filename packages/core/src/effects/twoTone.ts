import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { nblend } from '../dsl/buffer.ts';
import { stripAxis } from '../dsl/space.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Split base and third spatially across wall pairs; phrase-length swaps keep temporal colour
 * slow.
 */
export const twoTone: EffectDef = {
	id: 'twoTone',
	name: 'Two Tone',
	role: 'bed',
	blurb: 'The long walls in the base, the short walls in the third, swapping every phrase; the floor leans with the bass.',
	taste: {
		energy: 3,
		sections: ['groove', 'verse', 'build', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0
	},
	params: [INTENSITY, param('contrast', 'How far the two colours sit apart', 0.7)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		// Opposite axis pairs take 0/1; interpolate along the beam so the colours meet on it.
		const side = new Float32Array(g.count);
		const edge = new Float32Array(g.count);
		for (const s of g.strips) {
			for (let k = 0; k < s.count; k++) {
				const i = s.offset + k;
				const x = (k + 0.5) / s.count;
				side[i] = s.inPerimeter ? (stripAxis(s) === 'x' ? 1 : 0) : x;
				// Softened toward the corners, so the two colours meet in a blend rather than a cut.
				edge[i] = s.inPerimeter ? 1 - Math.pow(Math.abs(x - 0.5) * 2, 6) : 1;
			}
		}
		const low = new Follower(0.03, 0.25);
		const lean = new Follower(0.15, 0.6);

		return {
			reset() {
				buf.fill(0);
				low.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				const weight = low.update(clamp(bandBetween(f, 0, 0.15) * 1.6), f.dt);
				const tilt = lean.update(clamp(bandBetween(f, 0.5, 1) * 1.4), f.dt);
				// Read phrase swaps from the grid so seeks preserve the split.
				const swap = Math.floor(f.barIndex / 8) % 2;
				const gain = (0.42 + p.intensity * 0.79) * (0.6 + weight * 0.4);
				const apart = 0.3 + clamp(p.contrast) * 0.7;

				for (let i = 0; i < g.count; i++) {
					const s = swap ? 1 - side[i] : side[i];
					const mix = lerp(s, 1 - s, 1 - edge[i]);
					// Spatial base-to-third colour; top-end modulation stays within base..glow.
					const home = lerp(SLOT.base, SLOT.glow, tilt * 0.7);
					const slot = lerp(home, SLOT.third, (1 - mix) * apart);
					setSample(buf, i, palette, slot + hueShift, gain * (0.75 + 0.25 * mix));
				}

				nblend(out, buf, alphaFor(f.dt, 0.06));
			}
		};
	}
};
