import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp, envelope } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_GLINTS = 140;

/**
 * A fixed constellation swept by a spot the room cannot see: each glint fires with a
 * sharp cosine-power flash as the sweep passes its phase, and the eye reads a mirror ball
 * that is not there.
 */
export const discoBall: EffectDef = {
	id: 'discoBall',
	name: 'Disco Ball',
	role: 'accent',
	blurb: 'A fixed constellation of glints swept once per 4 bars, like an unseen mirror ball.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		quiet: 3.68,
		// Discrete beams sweeping over an unlit room.
		carries: false
	},
	params: [INTENSITY, param('density', 'Glint density', 0.5)],
	create(g) {
		const idx = new Uint16Array(MAX_GLINTS);
		const phase = new Float32Array(MAX_GLINTS);
		for (let k = 0; k < MAX_GLINTS; k++) {
			idx[k] = Math.floor(hash01(k * 17 + 3) * g.count);
			phase[k] = hash01(k * 29 + 11);
		}
		let level = 0;

		return {
			reset() {
				level = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, 0.08);

				level = envelope(level, clamp(0.2 + f.energy), f.dt, 0.1, 0.8);
				const rot = (f.barIndex + f.barPhase) / 4;
				const count = Math.floor(MAX_GLINTS * (0.3 + p.density * 0.7));
				const gain = (0.5 + p.intensity) * level;

				for (let k = 0; k < count; k++) {
					const d = Math.cos((rot - phase[k]) * Math.PI * 2);
					if (d < 0.86) continue;
					const v = Math.pow((d - 0.86) / 0.14, 3) * gain;
					addSample(out, idx[k], palette, SLOT.white + hueShift, v);
					addSample(out, idx[k], palette, SLOT.glow + hueShift, v * 0.4);
				}
			}
		};
	}
};
