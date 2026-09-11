import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/** Spend the second hue only on crests, preserving the restrained liquid pattern. */
export const sineRoll: EffectDef = {
	id: 'sineRoll',
	name: 'Sine Roll',
	role: 'rhythm',
	blurb: 'A liquid brightness wave rolling around the room, one cycle per N beats.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1
	},
	params: [
		INTENSITY,
		// This parameter is a period, never perBeat: the planner treats perBeat as an event
		// rate.
		param('cycleBeats', 'Beats per cycle', 4, 1, 16, 1),
		param('waves', 'Waves around room', 4, 1, 8, 1)
	],
	create(g) {
		// Smooth beat energy for passage level.
		const passage = new Follower(0.09, 0.65);
		// Move colour slower than the wave to avoid a competing brightness envelope.
		const lean = new Follower(0.15, 0.6);
		return {
			reset() {
				passage.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// Read absolute bar phase without scaling by motion; changing a multiplier at a
				// large
				// bar index would teleport the pattern.
				const phase = (f.beatIndex + f.beatPhase) / Math.max(1, p.cycleBeats);
				const waves = Math.max(1, Math.round(p.waves));
				const passageLevel = passage.update(f.energy, f.dt);
				const tilt = lean.update(spectralTilt(f), f.dt);
				const gain = (0.14 + p.intensity * 0.35) * clamp(0.3 + passageLevel * 0.9);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Squared, so the wave dwells near dark and the crests punch.
					const w = Math.pow(sinewave(u * waves - phase), 2);
					// Cross toward third only at the crest; deep..glow alone contains one hue.
					const slot = lerp(lerp(SLOT.deep, SLOT.glow, w), SLOT.third, Math.pow(w, 3) * (0.7 + tilt * 0.3));
					setSample(out, i, palette, slot + hueShift, (0.15 + 0.85 * w) * gain);
				}
			}
		};
	}
};
