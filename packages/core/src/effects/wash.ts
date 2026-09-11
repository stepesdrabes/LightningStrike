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
		activity: 0,
		quiet: 3.86
	},
	params: [INTENSITY, param('breath', 'Breath', 0.45), param('drift', 'Drift', 0.06, 0, 0.4)],
	create() {
		// Smooth beat energy on both sides so passage level settles slowly.
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
				// Keep a high floor because cue intensity already dims quiet passages.
				// Retune authoring values with gamma to preserve delivered light.
				const heard = passage.update(f.energy, f.dt);
				const target = clamp(0.59 + 0.41 * heard) * (0.36 + p.intensity * 0.85);
				level = envelope(level, target, f.dt, 0.08, 0.5);

				const bright = level * lerp(1 - p.breath, 1, breathe);
				// Spectral position moves the gradient around the room.
				const tilt = lean.update(spectralTilt(f), f.dt);
				const phase = (f.barIndex + f.barPhase) * p.drift * ctx.motion + tilt * 0.4;

				for (let i = 0; i < g.count; i++) {
					const along = ringU(g, i);
					const grad = sinewave(frac(along * 0.5 - phase));
					// Use base..glow, the nearly constant-flux saturation span, so the gradient
					// keeps the room lit.
				const u = lerp(SLOT.deep, SLOT.glow, 0.52 + 0.4 * grad) + ctx.hueShift;
					setSample(out, i, palette, u, bright);
				}
			}
		};
	}
};
