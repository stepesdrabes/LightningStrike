import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { stampOnStrip, stripAxis } from '../dsl/space.ts';
import { beatRelease, INTENSITY } from './helpers.ts';

/**
 * Symmetry is what makes this read as a crowd of hands rather than as scattered hits:
 * every clap fires mirrored positions on both side walls, cycling four spots, over a
 * flash of the whole side wall that is gone inside the beat.
 */
export const clapAlong: EffectDef = {
	id: 'clapAlong',
	name: 'Clap Along',
	role: 'transient',
	blurb: 'Mirrored double-flashes on the side walls with every clap, the walls lighting under them.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.5,
		kit: 'snare'
	},
	params: [INTENSITY],
	create(g) {
		const sideWalls = g.strips.filter((s) => s.inPerimeter && stripAxis(s) === 'y');
		const wash = new PulseEnv();
		let clapCount = 0;
		let lastHit = -1;

		return {
			reset() {
				wash.reset();
				clapCount = 0;
				lastHit = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				// Over half a beat to leave: the hands are seen, then the light lets go the
				// way a lamp does.
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.55));
				if (sideWalls.length === 0) return;

				const refractory = Math.max(0.06, f.beatPeriod * 0.3);
				const gain = 0.55 + p.intensity * 0.85;
				if (f.snare && f.t - lastHit > refractory) {
					lastHit = f.t;
					clapCount++;
					wash.fire(clamp(0.35 + 0.65 * f.snareEnv));
					const spot = (clapCount % 4) / 4 + 0.125;
					const hit = gain * clamp(0.35 + 0.65 * f.snareEnv);
					for (const wall of sideWalls) {
						const centre = spot * wall.count;
						// A hand is a palm's width of light with a soft core, not a pin.
						stampOnStrip(out, g.count, wall, centre, 7, sample(palette, SLOT.accent + hueShift, hit));
						stampOnStrip(out, g.count, wall, centre, 2.6, sample(palette, SLOT.white + hueShift, hit * 0.5));
					}
				}

				// The wall lights under the hands. Laid under the stamps with a max rather than
				// added into the decaying buffer, which would integrate it into a glow that
				// outlasts the clap.
				const v = wash.decay(f.dt, f.beatPeriod, 0.8) * gain * 0.4;
				if (v <= 0.005) return;
				for (const wall of sideWalls) {
					const c = sample(palette, SLOT.glow + hueShift, v);
					for (let k = 0; k < wall.count; k++) {
						const o = (wall.offset + k) * 3;
						if (c[0] > out[o]) out[o] = c[0];
						if (c[1] > out[o + 1]) out[o + 1] = c[1];
						if (c[2] > out[o + 2]) out[o + 2] = c[2];
					}
				}
			}
		};
	}
};
