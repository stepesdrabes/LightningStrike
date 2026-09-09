import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Phase-spread brightness with the crests tinted - the most restrained motion layer, and the
 * right default when the groove should feel liquid rather than punchy.
 *
 * Restrained is not the same as monochrome. The troughs hold the room's own colour and only the
 * crests reach for a second one, by as much as the mix has opened up: the wave is then legible
 * as a wave rather than as one hue getting brighter, and the show's other hue is spent on a
 * sixth of the room rather than all of it.
 */
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
		// Named for what it is - a period, not a rate. It shared the key `perBeat` with the
		// effects that count events per beat, and the planner's hat-density hook wrote a RATE
		// into it: a sparse song got 1, which here means one cycle per beat, four times the
		// designed speed. The planner keys its two mappings on the param name, so the period
		// param must never be called `perBeat` again.
		param('cycleBeats', 'Beats per cycle', 4, 1, 16, 1),
		param('waves', 'Waves around room', 4, 1, 8, 1)
	],
	create(g) {
		// The passage's own level. `f.energy` is beat resolution whatever it is passed through,
		// so this only says how loud the passage is and belongs slow.
		const passage = new Follower(0.09, 0.65);
		// How far the crests are allowed to travel from home. Slower still: a hue that moves at
		// the speed of the wave is a second brightness envelope beating against the first.
		const lean = new Follower(0.15, 0.6);
		return {
			reset() {
				passage.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// Motion stretches the cycle in beats rather than driving a clock of its own, so a
				// slow cue rolls slowly and the crest still arrives on the grid.
				// ctx.motion deliberately does NOT scale this. The phase is read off the absolute
				// bar clock so a seek reproduces the frame exactly, and multiplying a growing
				// counter by a value the player cross-fades between cues moves the pattern by the
				// whole elapsed length: at bar 120 a routine 1.0 to 1.25 is 7.5 revolutions in one
				// frame. A grid-locked phase takes its speed from the grid, and that is the point
				// of it.
				const phase = (f.beatIndex + f.beatPhase) / Math.max(1, p.cycleBeats);
				const waves = Math.max(1, Math.round(p.waves));
				const passageLevel = passage.update(f.energy, f.dt);
				const tilt = lean.update(spectralTilt(f), f.dt);
				const gain = (0.14 + p.intensity * 0.35) * clamp(0.3 + passageLevel * 0.9);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Squared, so the wave dwells near dark and the crests punch.
					const w = Math.pow(sinewave(u * waves - phase), 2);
					// Deep through glow is one hue at three lightnesses, so the wave used to be a
					// brightness ramp wearing a palette's clothes. Past the crest it crosses into
					// the third, which is where it becomes a colour.
					const slot = lerp(lerp(SLOT.deep, SLOT.glow, w), SLOT.third, Math.pow(w, 3) * (0.7 + tilt * 0.3));
					setSample(out, i, palette, slot + hueShift, (0.15 + 0.85 * w) * gain);
				}
			}
		};
	}
};
