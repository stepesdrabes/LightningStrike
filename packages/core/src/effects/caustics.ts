import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp, smoothstep } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { noise3 } from '../dsl/wave.ts';
import { Follower } from '../dsl/env.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The zero set between two noise fields gives thin bright filaments; a single threshold
 * would produce broad clouds. A dim wash beneath them keeps the room lit.
 */
export const caustics: EffectDef = {
	id: 'caustics',
	name: 'Caustics',
	role: 'bed',
	blurb: 'The refracted net off water, crawling slowly round the room.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'void', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 2.51
	},
	params: [INTENSITY, param('flow', 'Flow', 0.45), param('listen', 'How much it hears', 0.4)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		// Slow, because it decides how tight the net is rather than answering anything.
		const air = new Follower(0.25, 0.8);
		let clock = 0;
		let heard = 0;

		return {
			reset() {
				buf.fill(0);
				air.reset();
				clock = 0;
				heard = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				clock += f.dt * (0.028 + p.flow * 0.075) * motion;
				// Top-end content tightens the net; sparse air leaves broad, slow caustics.
				heard = air.update(bandAt(f, 0.82), f.dt);
				const listen = clamp(p.listen);

				const scale = 3.4 + heard * listen * 2.6;
				const gain = 0.66 + p.intensity * 0.72;
				const t = clock;

				for (let i = 0; i < g.count; i++) {
					const x = g.nx[i];
					const y = g.ny[i];
					const a = noise3(x * scale + t, y * scale - t * 0.62, t * 0.21);
					const b = noise3(x * scale * 1.37 - t * 0.83, y * scale * 1.37 + t * 0.44, 11.3);
					// Bright where the two fields agree. Squared so the filaments stay thin as the
					// scale opens up, which is what stops a slow passage looking like fog.
					const line = smoothstep(0.55, 1, 1 - Math.abs(a - b) * 2.1);
					const wash = 0.42 + 0.18 * a;
					const v = clamp(wash + line * line * 0.72);
					setSample(buf, i, palette, lerp(SLOT.deep, SLOT.glow, v) + hueShift, v * gain);
				}

				// Long enough that a filament arriving reads as the water moving rather than as the
				// field being resampled, short enough that the net still travels.
				nblend(out, buf, alphaFor(f.dt, 0.08));
			}
		};
	}
};
