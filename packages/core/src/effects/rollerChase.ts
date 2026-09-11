import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { frac, lerp } from '../dsl/math.ts';
import { ringsFor, scatter } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/** Middle of the front wall in the counter-clockwise frame. */
const FRONT_THETA = 0.75;

/**
 * Read phase from the bar grid so pulses meet front-centre on downbeats and survive seeks.
 * Motion widens wakes instead of changing the grid-locked lap.
 */
export const rollerChase: EffectDef = {
	id: 'rollerChase',
	name: 'Roller Chase',
	role: 'rhythm',
	blurb: 'Two counter-orbiting pulses lapping the ring each bar, meeting front-centre on the downbeat.',
	taste: {
		energy: 4,
		sections: ['groove', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.4
	},
	params: [
		INTENSITY,
		param('tail', 'Tail length', 0.22, 0.04, 0.4),
		param('swell', 'Kick swell', 0.6),
		// Use whole-bar laps lasting at least ~2.2 s to keep the orbit legible. Default two
		// bars
		// keeps unplanned instances calm while retaining downbeat alignment.
		param('lapBars', 'Bars per lap', 2, 1, 4, 1)
	],
	create(g) {
		const rings = ringsFor(g);
		const ring = rings.perimeter;
		const scratch = new Float32Array(ring.length * 3);
		let frontPerim = 0;
		let best = Infinity;
		for (let i = 0; i < ring.length; i++) {
			const px = ring.map[i];
			const d = Math.abs(frac(g.theta[px] - FRONT_THETA + 0.5) - 0.5);
			if (d < best) {
				best = d;
				frontPerim = g.perim[px];
			}
		}

		return {
			reset() {
				scratch.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				scratch.fill(0);

				const n = ring.length;
				const lap = frac((f.barIndex + f.barPhase) / Math.max(1, Math.round(p.lapBars)));
				const headA = Math.round(frac(frontPerim + lap) * n);
				const headB = Math.round(frac(frontPerim - lap) * n);

				const bright = 1 - p.swell + p.swell * f.kickEnv;
				const gain = (0.53 + p.intensity * 0.83) * bright;
				const tailPx = n * p.tail * (0.35 + 0.65 * Math.max(0.05, motion));

				// Each tail trails its own direction; crossing heads stack.
				for (let k = 0; k < n; k++) {
					const wgt = Math.exp(-k / tailPx);
					if (wgt < 0.004) break;
					const slot = lerp(SLOT.base, SLOT.white, wgt * wgt);
					const iA = (((headA - k) % n) + n) % n;
					addSample(scratch, iA, palette, slot + hueShift, wgt * gain);
					const iB = (((headB + k) % n) + n) % n;
					addSample(scratch, iB, palette, slot + hueShift, wgt * gain);
				}

				out.fill(0);
				scatter(ring, scratch, out);
			}
		};
	}
};
