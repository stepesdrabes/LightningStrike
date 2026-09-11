import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * Instant whole-room edges preserve the architectural cut; gradients would soften it into a
 * fade.
 */
export const shutterCut: EffectDef = {
	id: 'shutterCut',
	name: 'Shutter Cut',
	role: 'master',
	blurb: 'White/black cuts on the eighth grid over one bar, then a half-bar decay to rest.',
	taste: {
		energy: 5,
		sections: ['drop'],
		minBars: 0,
		maxBars: 2,
		peakReserved: false,
		activity: 1,
		character: 'flash',
		// Declare peak treatment independently of the flash-family veto.
		peakStyle: 'slam'
	},
	params: [INTENSITY, param('trigger', 'Trigger', 0, 0, 1, 1)],
	create(g) {
		const edge = new Edge();
		let armedFor = Number.NaN;
		let t0 = -1;
		let eighth = 0.25;

		return {
			reset() {
				edge.reset();
				armedFor = Number.NaN;
				t0 = -1;
				eighth = 0.25;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Arm on drop class so choruses also fire.
				if (sectionBase(f.section) === 'drop' && f.downbeat) {
					const impact = f.timeSinceDrop < 0.3;
					if ((impact || f.phraseStart) && armedFor !== f.barIndex) {
						armedFor = f.barIndex;
						t0 = f.t;
						eighth = f.beatPeriod / 2;
					}
				}
				if (edge.update(p.trigger > 0.5)) {
					t0 = f.t;
					eighth = f.beatPeriod / 2;
				}

				if (t0 < 0) {
					out.fill(0);
					return;
				}

				// Capture the eighth-note grid at arm time so frame timing and tempo drift
				// cannot shear the cuts.
				const age = f.t - t0;
				const step = Math.floor(age / eighth);
				const white = 0.6 + p.intensity;

				if (step < 4) {
					if (step % 2 === 0) {
						fillSolid(out, g.count, sample(palette, SLOT.white + hueShift, white));
					} else {
						out.fill(0);
					}
					return;
				}

				// Motion scales only release; grid cuts stay fixed and white fades without
				// changing hue.
				const decayT = (eighth * 4) / Math.max(0.05, motion);
				const u = clamp((age - eighth * 4) / decayT);
				const v = (1 - u) * (1 - u);
				fillSolid(out, g.count, sample(palette, SLOT.white + hueShift, white * v));
			}
		};
	}
};
