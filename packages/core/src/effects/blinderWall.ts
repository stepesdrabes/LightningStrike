import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { lerp } from '../dsl/math.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * A one-frame attack reads as a blinder; the afterglow sustains the impression of a bright
 * room.
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

				// Arm on drop class so choruses also fire.
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

				// Capture period at arm time so tempo drift cannot stretch the hold.
				const hold = period;
				const decay = (period * 2) / Math.max(0.05, motion);
				const age = f.t - t0;
				const v = age < hold ? 1 : Math.max(0, 1 - (age - hold) / decay) ** 2;

				// Use one glow-leaning hue throughout; changing hue during decay would become a
				// colour event.
				const warmWhite = lerp(SLOT.white, SLOT.glow, p.warmth);
				const bright = v * (0.4 + p.intensity * 0.9);
				fillSolid(out, g.count, sample(palette, warmWhite + hueShift, bright));
			}
		};
	}
};
