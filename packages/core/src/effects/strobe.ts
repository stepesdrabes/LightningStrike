import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { stripAxis } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

export const strobe: EffectDef = {
	id: 'strobe',
	name: 'Strobe',
	role: 'master',
	blurb: 'Flashes on the beat grid, alternating wall pairs so each wall flashes at half the rate.',
	taste: {
		energy: 5,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 0,
		maxBars: 2,
		peakReserved: false,
		activity: 0,
		hitOnly: true,
		character: 'flash'
	},
	params: [
		INTENSITY,
		param('trigger', 'Trigger', 0, 0, 1, 1),
		param('perBeat', 'Flashes per beat', 2, 1, 4, 1)
	],
	create(g) {
		// Alternate wall pairs so each wall flashes at half the total rate capped by
		// STROBE_MAX_HZ.
		const groupA = new Set<number>();
		for (const s of g.strips) if (s.inPerimeter && stripAxis(s) === 'x') groupA.add(s.id);

		return {
			reset() {},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				if (p.trigger <= 0.5) {
					out.fill(0);
					return;
				}

				const rate = Math.round(p.perBeat);
				const beats = f.beatIndex + f.beatPhase;
				const step = Math.floor(beats * rate);
				const onA = step % 2 === 0;
				// Decay from each attack instead of holding full white, and emphasize the
				// beat's first
				// flash to preserve grid hierarchy.
				const flashPhase = beats * rate - step;
				const v = Math.pow(Math.max(0, 1 - flashPhase / 0.6), 1.4);
				const train = 1 - 0.35 * f.beatPhase;
				const level = (0.5 + p.intensity * 0.5) * v * train;

				for (let i = 0; i < g.count; i++) {
					const inA = groupA.has(g.strip[i]);
					setSample(out, i, palette, SLOT.white + ctx.hueShift, inA === onA ? level : 0);
				}
			}
		};
	}
};
