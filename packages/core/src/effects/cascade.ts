import type { EffectDef } from '../contracts/effect.ts';
import type { StripSpec } from '../contracts/room.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { beatRelease, INTENSITY } from './helpers.ts';

/**
 * Four fixture groups fire in sequence across the bar - beam, front, sides, back - so
 * the light visibly pours from the ceiling down and around the room. A call-and-response
 * chase at the scale of the architecture.
 */
export const cascade: EffectDef = {
	id: 'cascade',
	name: 'Cascade',
	role: 'rhythm',
	blurb: 'Beam, front, sides, back: light pours through the room once per bar.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.5
	},
	params: [INTENSITY],
	create(g) {
		const beam = g.strips.find((s) => !s.inPerimeter) ?? null;
		const walls = g.strips.filter((s) => s.inPerimeter);
		const groups: StripSpec[][] = [
			beam ? [beam] : [],
			walls[0] ? [walls[0]] : [],
			[walls[1], walls[3]].filter((s): s is StripSpec => Boolean(s)),
			walls[2] ? [walls[2]] : []
		];
		const env = new Float32Array(4);
		// `f.energy` is beat-resolution data the player interpolates per frame, so a level
		// multiplied by it slides continuously under a chase that lands on the grid.
		const level = new BeatHold(0.5);
		const tilt = new BeatHold(0.25);
		let lastStage = -1;

		return {
			reset() {
				env.fill(0);
				level.reset();
				tilt.reset();
				lastStage = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				const stage = Math.floor(f.barPhase * 4) % 4;
				if (stage !== lastStage) {
					lastStage = stage;
					env[stage] = 1;
				}

				const tail = Math.exp(-f.dt / beatRelease(f.beatPeriod, 0.9));
				const held = level.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const gain = (0.4 + p.intensity * 0.8) * clamp(0.45 + held * 0.55);
				const warm = tilt.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				// Where the arrangement sits picks the walls' colour, so the same chase reads
				// as body under a bass passage and as texture when the top opens up.
				// A spectral term may only walk the slot inside base..glow. That span is safe because it
				// is a SATURATION move at constant flux (measured x1.03 over 24 hues); crossing to
				// white is x2.66, a spectrum driving BRIGHTNESS through the palette, which is the
				// blinking the mixer already had to be rescued from once.
				const wallLit = lerp(SLOT.base, SLOT.glow, clamp(warm * 0.7));

				for (let s = 0; s < 4; s++) {
					env[s] *= tail;
					const v = env[s];
					if (v < 0.015) continue;
					// The beam pours in glow; the walls drain back toward the deep shade as the
					// light leaves them - a waterfall of palette, not of position.
					const slot = s === 0 ? SLOT.glow : lerp(wallLit, SLOT.deep, (1 - v) * 0.6);
					const group = groups[s];
					for (let k = 0; k < group.length; k++) {
						const strip = group[k];
						for (let j = 0; j < strip.count; j++) {
							// Feathered ends so neighbouring groups blend at the corners.
							const e = Math.min(1, Math.min(j, strip.count - 1 - j) * 0.08 + 0.4);
							addSample(out, strip.offset + j, palette, slot + hueShift, v * gain * e);
						}
					}
				}
			}
		};
	}
};
