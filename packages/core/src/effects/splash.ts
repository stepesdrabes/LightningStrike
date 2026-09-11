import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { stampOnStrip, stripAxis } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

export const splash: EffectDef = {
	id: 'splash',
	name: 'Splash',
	role: 'transient',
	blurb: 'Kicks splash the front and back walls, snares answer on the sides. Size codes velocity.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 1,
		maxBars: 32,
		peakReserved: false,
		activity: 0.4,
		kit: 'any'
	},
	params: [INTENSITY, param('size', 'Size', 0.35, 0.1, 1), param('decay', 'Decay beats', 0.55, 0.1, 2)],
	create(g) {
		// Fixed drum axes and hues make repeated hits read as the same instrument.
		const kickWalls = g.strips.filter((s) => s.inPerimeter && stripAxis(s) === 'x');
		const snareWalls = g.strips.filter((s) => s.inPerimeter && stripAxis(s) === 'y');
		let kickCount = 0;
		let snareCount = 0;

		return {
			reset() {
				kickCount = 0;
				snareCount = 0;
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				// A four-fifths-beat tail leaves like a lamp rather than snapping off.
				fadeToBlack(out, f.dt, p.decay * f.beatPeriod * 0.8);

				const sigma = 8 + p.size * 30;

				if (f.kick && kickWalls.length > 0) {
					const wall = kickWalls[kickCount % kickWalls.length];
					// Golden-ratio placement gives deterministic, even spread without repeated
					// positions.
					const u = (kickCount * 0.618034) % 1;
					kickCount++;
					const strength = clamp(0.5 + 0.4 * f.bands[Band.Sub]) * (0.45 + p.intensity * 0.7);
					const c = sample(palette, SLOT.base + ctx.hueShift, strength);
					stampOnStrip(
						out,
						g.count,
						wall,
						u * (wall.count - 1),
						sigma * (0.7 + 0.6 * strength),
						c
					);
				}

				if (f.snare && snareWalls.length > 0) {
					const wall = snareWalls[snareCount % snareWalls.length];
					const u = (snareCount * 0.618034 + 0.5) % 1;
					snareCount++;
					const strength = clamp(0.45 + 0.5 * f.snareEnv) * (0.45 + p.intensity * 0.7);
					const c = sample(palette, SLOT.accent + ctx.hueShift, strength);
					stampOnStrip(out, g.count, wall, u * (wall.count - 1), sigma * 0.7, c);
				}
			}
		};
	}
};
