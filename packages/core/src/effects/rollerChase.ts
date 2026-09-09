import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { frac, lerp } from '../dsl/math.ts';
import { ringsFor, scatter } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/** Middle of the front wall in the counter-clockwise frame. */
const FRONT_THETA = 0.75;

/**
 * The drum & bass roller. Position comes straight off the bar grid rather than from an
 * accumulated clock, so both pulses arrive at front-centre exactly ON the downbeat and a
 * seek reproduces the frame; the eye extrapolates the orbit into the impact, which is the
 * whole trick. Motion widens the wake instead of scaling the lap, because the lap is the
 * grid's.
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
		// The felt orbit, not the musical one: one bar is 1.4 s at 174 bpm and reads as a
		// blur at 140, so the planner stretches the lap to whole bars until it runs at least
		// ~2.2 s. Whole bars only - the heads still meet front-centre on a downbeat, just not
		// on every one. Default 2 so an unplanned instance errs slow rather than frantic.
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
				// Off the absolute bar clock, so a seek reproduces the frame and the lap cannot
				// drift against the grid however long the track runs.
				const lap = frac((f.barIndex + f.barPhase) / Math.max(1, Math.round(p.lapBars)));
				const headA = Math.round(frac(frontPerim + lap) * n);
				const headB = Math.round(frac(frontPerim - lap) * n);

				const bright = 1 - p.swell + p.swell * f.kickEnv;
				const gain = (0.53 + p.intensity * 0.83) * bright;
				const tailPx = n * p.tail * (0.35 + 0.65 * Math.max(0.05, motion));

				// Tails trail against each pulse's own direction of travel; where the two heads
				// cross - the front on the downbeat, the back at the half-bar - they stack.
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
