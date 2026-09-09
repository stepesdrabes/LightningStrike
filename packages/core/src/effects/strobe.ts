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
		// Alternating pairs rather than the whole room: perceived flash rate at any point in
		// the room is half the strobe rate, so a 2-per-beat burst at club tempos sits near
		// 2 Hz locally against the room's own `STROBE_MAX_HZ` of 6. The owner's word.
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
				// Each flash detonates and DECAYS from its first frame instead of holding a
				// square: the same number of events reads sharper at the attack and calmer in
				// the tail. A held, full-white version was judged too aggressive in the room;
				// this is the shape the owner liked, a step brighter. The train front-loads the
				// beat so the burst keeps the grid's hierarchy instead of flattening it.
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
