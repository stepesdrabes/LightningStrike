import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * The player arms timeline hits through trigger. Hold then decay in one colour;
 * hue changes during the tail would turn a slam into another palette event.
 */
const HOLD_SECONDS = 0.06;

export const slam: EffectDef = {
	id: 'slam',
	name: 'Slam',
	role: 'master',
	blurb: 'One full-room white blow, held a breath, fading in place. The blinder hit.',
	taste: {
		energy: 5,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 0,
		maxBars: 1,
		peakReserved: false,
		activity: 0,
		hitOnly: true,
		character: 'impact'
	},
	params: [
		INTENSITY,
		param('trigger', 'Trigger', 0, 0, 1, 1),
		param('beats', 'Decay beats', 1.4, 0.25, 4, 0.1)
	],
	create(g) {
		const edge = new Edge();
		let age = Infinity;

		return {
			reset() {
				edge.reset();
				age = Infinity;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				if (edge.update(p.trigger > 0.5)) age = 0;
				else age += f.dt;

				// Time constant a third of the decay length, so the blow is gone by then.
				const tau = Math.max(0.02, (p.beats * f.beatPeriod) / 3);
				const v = age <= HOLD_SECONDS ? 1 : Math.exp(-(age - HOLD_SECONDS) / tau);
				if (v < 0.004) {
					out.fill(0);
					return;
				}
				fillSolid(out, g.count, sample(palette, SLOT.white + hueShift, v * (0.5 + p.intensity * 0.75)));
			}
		};
	}
};
