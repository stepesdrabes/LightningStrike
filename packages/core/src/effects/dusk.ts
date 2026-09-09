import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { computeU } from '../dsl/space.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * A sky, laid across the room rather than up it.
 *
 * Every LED in this fixture is at the same height - the frame is one plane at 2.4 m -
 * so there is no vertical axis to put a horizon on. What there is is a horizontal plane, and a
 * sunset seen from inside a room is a horizontal thing anyway: one side glows, the far side has
 * already gone blue, and the bearing walks round as the sun goes down.
 *
 * So the glow is a wide lobe on a world-space axis that turns about once every seven minutes, over
 * an even wash that never lets the far side reach black. The turn is the only thing here that
 * varies colour over time, and seven minutes is slow enough to be allowed to.
 */
export const dusk: EffectDef = {
	id: 'dusk',
	name: 'Dusk',
	role: 'bed',
	blurb: 'One side of the room still holds the light. The bearing walks round over minutes.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'void', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0,
		quiet: 1.78
	},
	params: [INTENSITY, param('turn', 'How fast it turns', 0.4), param('depth', 'Depth', 0.5)],
	create(g) {
		const u = new Float32Array(g.count);
		const passage = new BeatHold(0.5);
		let angle = 0;
		let heard = 0;
		// Recomputed on a bearing change rather than every frame: `computeU` walks the room twice
		// and the bearing moves about a thousandth of a radian a second.
		let projectedAt = Number.NaN;

		return {
			reset() {
				angle = 0;
				heard = 0;
				projectedAt = Number.NaN;
				passage.reset();
				u.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				angle += f.dt * (0.0055 + p.turn * 0.019) * motion;
				heard = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);

				if (!(Math.abs(angle - projectedAt) < 0.004)) {
					computeU(u, g, 'sweep', angle);
					projectedAt = angle;
				}

				// How far the far side falls. Shallow by default: a room where one wall is lit and
				// the opposite one is out is a spotlight, not a sky.
				const depth = 0.24 + clamp(p.depth) * 0.26;
				const gain = (0.5 + p.intensity * 0.42) * (0.88 + heard * 0.26);

				for (let i = 0; i < g.count; i++) {
					// Widened past a plain cosine so the glow covers rather more than half the room and
					// the shadow side is a narrower band than the lit one, which is how a sky sits.
					const lobe = Math.pow(sinewave(u[i] * 0.5 + 0.25), 0.72);
					const v = 1 - depth + depth * lobe;
					// Colour by position, over the whole spend from the cool shade to the warm third.
					// The lit side crosses `white` into the second hue only at the very top of the
					// lobe, so the room carries two colours and the transition between them is wide.
					const slot =
						lobe < 0.62
							? lerp(SLOT.deep, SLOT.base, lobe / 0.62)
							: lerp(SLOT.base, SLOT.third, (lobe - 0.62) / 0.38);
					setSample(out, i, palette, slot + hueShift, v * gain);
				}
			}
		};
	}
};
