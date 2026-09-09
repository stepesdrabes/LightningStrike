import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * Every real desk keeps a colour bump under a finger for the moments timecode cannot
 * predict. Floods the room in the accent hue and decays over a beat and a half.
 *
 * No hold and no hard edge on purpose: it is a flood, not a flash, and the version with a
 * hold read as a second slam. This is the shape the room was judged on.
 */
export const colorBump: EffectDef = {
	id: 'colorBump',
	name: 'Colour Bump',
	role: 'master',
	blurb: 'Manual one-shot accent-colour flood.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 0,
		maxBars: 1,
		peakReserved: false,
		activity: 0,
		hitOnly: true
	},
	params: [INTENSITY, param('trigger', 'Trigger', 0, 0, 1, 1)],
	create(g) {
		const edge = new Edge();
		let level = 0;

		return {
			reset() {
				edge.reset();
				level = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				if (edge.update(p.trigger > 0.5)) level = 1;

				level *= Math.exp(-f.dt / Math.max(0.1, f.beatPeriod * 0.9));
				if (level < 0.004) {
					out.fill(0);
					return;
				}

				const bright = level * (0.6 + p.intensity * 1.4);
				fillSolid(out, g.count, sample(palette, SLOT.accent + hueShift, bright));
			}
		};
	}
};
