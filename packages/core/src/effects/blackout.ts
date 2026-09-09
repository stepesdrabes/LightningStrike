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
		// The void's bed and nothing else's.
		//
		// This used to declare every section, which reads as "darkness is always available" and
		// is true only of the one section that means it. It also made this the ONLY bed legal in
		// a one-bar cue in a drop, and the peak's opening cue is one bar because that is how long
		// a master burst holds the room - so the biggest moment of every show was lit by a bed
		// that emits nothing but a keep-alive on the beam.
		sections: ['void'],
		minBars: 1,
		maxBars: 4,
		peakReserved: false,
		activity: 0,
		quiet: 1.06,
		// Darkness is the whole instruction.
		carries: false
	},
	params: [param('keepAlive', 'Keep-alive', 0.02, 0, 0.15)],
	create(g) {
		// The beam is the strip that is not part of the perimeter ring, not whichever strip a
		// room spec happens to list last.
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
