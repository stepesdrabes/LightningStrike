import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * The techno architectural event: the room as one lamp being switched. Everything is
 * whole-room and instantaneous, because a gradient or a soft edge anywhere would turn the
 * cut into a fade and lose the move.
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
		// Redundant with the bloom-excludes-flash veto today, declared so the exclusion
		// survives anyone refactoring that veto away.
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

				// A chorus is the song vocabulary's drop; arming on the literal kind alone would
				// leave a pop peak carrying this and never firing it.
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

				// The grid is laid down at arm time: every cut lands on an eighth-note boundary
				// however the frames fall, and a tempo drift mid-sequence cannot shear it off.
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

				// The cuts are grid-locked; the release afterwards is the one speed motion scales.
				// White fading in place: a release that walked to the base was a colour change.
				const decayT = (eighth * 4) / Math.max(0.05, motion);
				const u = clamp((age - eighth * 4) / decayT);
				const v = (1 - u) * (1 - u);
				fillSolid(out, g.count, sample(palette, SLOT.white + hueShift, white * v));
			}
		};
	}
};
