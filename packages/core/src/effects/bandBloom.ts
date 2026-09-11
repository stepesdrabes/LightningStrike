import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

const SPAN_LO = [0, 0.3, 0.65];
const SPAN_HI = [0.3, 0.65, 1];

export const bandBloom: EffectDef = {
	id: 'bandBloom',
	name: 'Band Bloom',
	role: 'accent',
	blurb: 'Three broad fields answer low, middle and high notes while their colours slowly turn.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 2,
		maxBars: 48,
		peakReserved: false,
		activity: 0.1,
		quiet: 6.04
	},
	params: [INTENSITY, param('spread', 'Lobe width', 0.5), param('turn', 'How fast it turns', 0.4)],
	create(g) {
		const bands = Array.from({ length: 3 }, () => new Follower(0.09, 0.5));
		const held = new Float32Array(3);
		const body = new Follower(1, 3);
		const slots = [SLOT.base, SLOT.glow, SLOT.third];
		let turn = 0;
		return {
			reset() {
				held.fill(0);
				body.reset();
				turn = 0;
				for (const b of bands) b.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);
				const beats = f.dt / Math.max(0.15, f.beatPeriod);
				turn += beats * motion * p.turn / 24;
				for (let k = 0; k < held.length; k++) {
					held[k] = bands[k].update(bandBetween(f, SPAN_LO[k], SPAN_HI[k]), beats);
				}
				// Cue intensity already follows passage energy; preserve the quiet voice here.
				const weight = body.update(f.energy, beats);
				const gain = (0.32 + p.intensity * 0.64) * (0.65 + weight * 0.35);
				const lively = clamp(0.35 + motion * 0.65);
				const width = 0.3 + p.spread * 0.2;
				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					for (let k = 0; k < held.length; k++) {
						const centre = turn + k / held.length;
						const d = Math.abs(u - centre - Math.round(u - centre));
						const v = clamp(1 - d / width);
						if (v <= 0) continue;
						// Notes change local level, leaving hue and position stable through attacks.
						const slot = k < 2 ? lerp(slots[k], SLOT.glow, held[k] * 0.2) : slots[k];
						const swell = 1 + (held[k] - 0.3) * 1.15 * lively;
						addSample(out, i, palette, slot + hueShift, v * v * gain * swell);
					}
				}
			}
		};
	}
};
