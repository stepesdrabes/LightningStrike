import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, frac, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { Follower } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

export const wash: EffectDef = {
	id: 'wash',
	name: 'Wash',
	role: 'bed',
	blurb: 'The room in its home colour, breathing once per bar, gradient drifting around the ring.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		quiet: 3.45
	},
	params: [INTENSITY, param('breath', 'Breath', 0.45), param('drift', 'Drift', 0.06, 0, 0.4)],
	create() {
		// `f.energy` is beat-resolution data whatever it is passed through, so this only ever
		// says how loud the passage is. Slow on both sides, so it reads as the room settling.
		const passage = new Follower(0.1, 0.7);
		const lean = new Follower(0.1, 0.4);
		let level = 0;
		return {
			reset() {
				level = 0;
				passage.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, g, p, palette } = ctx;
				const breathe = Math.pow(sinewave(f.barPhase), 1.8);
				// The floor is high because the cue's own intensity already says the passage is
				// quiet. A bed that dims itself as well is dimmed twice, and two multiplications
				// of a number under one is how an intro reached byte zero. Raised from 0.55 with
				// GAMMA, so it emits the light it was chosen for rather than the number.
				const heard = passage.update(f.energy, f.dt);
				const target = clamp(0.59 + 0.41 * heard) * p.intensity;
				level = envelope(level, target, f.dt, 0.08, 0.5);

				const bright = level * lerp(1 - p.breath, 1, breathe);
				// Where the music sits pushes the gradient round the room, so a passage that opens
				// up moves the wash rather than only brightening it.
				const tilt = lean.update(spectralTilt(f), f.dt);
				const phase = (f.barIndex + f.barPhase) * p.drift * ctx.motion + tilt * 0.4;

				for (let i = 0; i < g.count; i++) {
					const along = ringU(g, i);
					const grad = sinewave(frac(along * 0.5 - phase));
					// Inside `base..glow` rather than starting a third of the way up `deep..base`. The
				// old span put the dark side of the ring in the x12.5 brightness step, so a bed
				// whose job is to fill a room spent a third of it near black; this one is the
				// saturation move, which costs no light and is what a gradient is supposed to be.
				const u = lerp(SLOT.deep, SLOT.glow, 0.52 + 0.4 * grad) + ctx.hueShift;
					setSample(out, i, palette, u, bright);
				}
			}
		};
	}
};
