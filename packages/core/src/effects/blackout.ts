import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { param } from './helpers.ts';

export const blackout: EffectDef = {
	id: 'blackout',
	name: 'Blackout',
	role: 'bed',
	blurb: 'Everything off but a faint keep-alive on the beam. The void, held.',
	taste: {
		energy: 1,
		// Restrict to voids so short peak cues cannot select a black bed.
		sections: ['void'],
		minBars: 1,
		maxBars: 4,
		peakReserved: false,
		activity: 0,
		quiet: 1.06,
		carries: false
	},
	params: [param('keepAlive', 'Keep-alive', 0.02, 0, 0.15)],
	create(g) {
		// Find the beam by topology, never by strip order.
		const beam = g.strips.find((s) => !s.inPerimeter) ?? g.strips[g.strips.length - 1];
		return {
			reset() {},
			render(out, ctx) {
				const { p, palette } = ctx;
				out.fill(0);
				if (p.keepAlive <= 0) return;
				for (let k = 0; k < beam.count; k++) {
					setSample(out, beam.offset + k, palette, SLOT.deep + ctx.hueShift, p.keepAlive);
				}
			}
		};
	}
};
