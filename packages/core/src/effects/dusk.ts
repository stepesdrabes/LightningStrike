import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { computeU } from '../dsl/space.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The coplanar fixture needs a horizontal horizon. A broad world-space lobe turns over
 * seven minutes, with an even floor keeping the far side lit.
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
		quiet: 4.59
	},
	params: [INTENSITY, param('turn', 'How fast it turns', 0.4), param('depth', 'Depth', 0.5)],
	create(g) {
		const u = new Float32Array(g.count);
		const passage = new BeatHold(0.5);
		let angle = 0;
		let heard = 0;
		// Recompute projection only when bearing changes; computeU walks the room twice.
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

				// Keep shadow shallow so the scene remains a sky rather than a spotlight.
				const depth = 0.24 + clamp(p.depth) * 0.26;
				const gain = (0.5 + p.intensity * 0.42) * (0.88 + heard * 0.26);

				for (let i = 0; i < g.count; i++) {
					// Widen the lobe beyond a cosine so more than half the room stays lit.
					const lobe = Math.pow(sinewave(u[i] * 0.5 + 0.25), 0.72);
					const v = 1 - depth + depth * lobe;
					// Spatial colour crosses toward the warm third only near the crest.
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
