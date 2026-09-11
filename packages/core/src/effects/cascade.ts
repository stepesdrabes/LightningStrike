import type { EffectDef } from '../contracts/effect.ts';
import type { StripSpec } from '../contracts/room.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { beatRelease, INTENSITY } from './helpers.ts';

/** Sequence beam, front, sides and back to make the chase follow the architecture. */
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
		// Latch beat energy so level does not slide under a grid-locked chase.
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
				// Keep spectral tint in the nearly constant-flux base..glow span.
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
