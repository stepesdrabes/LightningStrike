import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { lerp } from '../dsl/math.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * The audience blinder translated to strips: attack inside one frame, because the point
 * of a blinder is that nobody saw it start, and an afterglow that settles into the
 * palette base rather than black, the way the eye keeps a bright room after the lamp is
 * gone.
 */
export const blinderWall: EffectDef = {
	id: 'blinderWall',
	name: 'Blinder Wall',
	role: 'master',
	blurb: 'Whole-room warm-white slam on the drop: a beat of hold, then afterglow into the base.',
	taste: {
		energy: 5,
		sections: ['drop', 'chorus'],
		minBars: 0,
		maxBars: 2,
		peakReserved: false,
		activity: 0.8,
		character: 'impact',
		peakStyle: 'slam'
	},
	params: [
		INTENSITY,
		param('trigger', 'Trigger', 0, 0, 1, 1),
		param('warmth', 'Warmth', 0.25, 0, 0.6)
	],
	create(g) {
		const edge = new Edge();
		let armedFor = Number.NaN;
		let t0 = -1;
		let period = 0.5;

		return {
			reset() {
				edge.reset();
				armedFor = Number.NaN;
				t0 = -1;
				period = 0.5;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// A chorus is the song vocabulary's drop; arming on the literal kind alone would
				// leave a pop peak carrying this and never firing it.
				if (sectionBase(f.section) === 'drop' && f.downbeat) {
					const impact = f.timeSinceDrop < 0.3;
					if ((impact || f.phraseStart) && armedFor !== f.barIndex) {
						armedFor = f.barIndex;
						t0 = f.t;
						period = f.beatPeriod;
					}
				}
				if (edge.update(p.trigger > 0.5)) {
					t0 = f.t;
					period = f.beatPeriod;
				}

				if (t0 < 0) {
					out.fill(0);
					return;
				}

				// Period captured at arm time, so a tempo drift mid-decay cannot stretch the hold.
				const hold = period;
				const decay = (period * 2) / Math.max(0.05, motion);
				const age = f.t - t0;
				const v = age < hold ? 1 : Math.max(0, 1 - (age - hold) / decay) ** 2;

				// Leaned toward glow rather than pure white: a blinder is tungsten, not a strobe.
				// One colour throughout: the afterglow fades in place rather than settling into
				// the base, because a hit that changes hue as it leaves reads as the room
				// changing colour, not as a blow (the owner's verdict on the slam).
				const warmWhite = lerp(SLOT.white, SLOT.glow, p.warmth);
				const bright = v * (0.4 + p.intensity * 0.9);
				fillSolid(out, g.count, sample(palette, warmWhite + hueShift, bright));
			}
		};
	}
};
