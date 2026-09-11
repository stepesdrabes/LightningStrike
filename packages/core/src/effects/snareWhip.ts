import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { stampOnStrip, stripAxis } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/** Cross the beam in a quarter beat so the snare gesture reads as a whip. */
export const snareWhip: EffectDef = {
	id: 'snareWhip',
	name: 'Snare Whip',
	role: 'transient',
	blurb: 'A whip-crack streak down the beam on every snare. The backbeat, visible.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.4,
		kit: 'snare'
	},
	params: [INTENSITY, param('crackBeats', 'Beats to cross', 0.3, 0.125, 1, 0.025)],
	create(g) {
		const beam = g.strips.find((s) => !s.inPerimeter) ?? g.strips[g.strips.length - 1];
		const sides = g.strips.filter((s) => s.inPerimeter && stripAxis(s) === 'y');
		let whipT = -1;
		let dir = 1;
		let power = 1;

		return {
			reset() {
				whipT = -1;
				dir = 1;
				power = 1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.55));

				if (f.snare) {
					whipT = f.t;
					dir = -dir;
					power = clamp(0.5 + f.snareEnv * 0.7);
				}
				if (whipT < 0) return;

				const travel = Math.max(0.05, (p.crackBeats * f.beatPeriod) / Math.max(0.2, motion));
				const u = (f.t - whipT) / travel;
				if (u > 1.2) return;

				const gain = (0.5 + p.intensity * 0.9) * power;

				if (u <= 1) {
					const pos = (dir > 0 ? u : 1 - u) * (beam.count - 1);
					stampOnStrip(out, g.count, beam, pos, 5, sample(palette, SLOT.accent + hueShift, gain));
					stampOnStrip(out, g.count, beam, pos, 2.2, sample(palette, SLOT.white + hueShift, gain * 0.7));
				}

				// Delay the side-wall shiver slightly after the beam crack.
				const echo = clamp(u - 0.2) * gain * 0.45;
				if (echo > 0.02) {
					for (const wall of sides) {
						const c = sample(palette, SLOT.accent + hueShift, echo * (1.2 - u));
						stampOnStrip(out, g.count, wall, wall.count / 2, wall.count * 0.28, c);
					}
				}
			}
		};
	}
};
