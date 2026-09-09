import type { EffectDef } from '../contracts/effect.ts';
import { sample } from '../color/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import { alphaFor, clamp, frac, lerp, paletteArc } from '../dsl/math.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { BeatHold } from '../dsl/env.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * A spiral field in (theta, dist) space. The ceiling beam sits near the room's axis, so
 * it naturally becomes the vortex's bright eye. The kick surge is integrated, which gives
 * the swirl inertia instead of a twitch.
 *
 * Arms, direction, twist and speed are all params the planner draws per cue, because this
 * was in 64 of 65 shows as the same two-armed spiral turning the same way.
 */
export const vortex: EffectDef = {
	id: 'vortex',
	name: 'Vortex',
	role: 'rhythm',
	blurb: 'A palette spiral swirling around the room, kicked forward by the kick; arms and direction vary.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 0.2
	},
	params: [
		INTENSITY,
		param('barsPerRev', 'Bars per revolution', 2, 0.5, 8, 0.5),
		param('twist', 'Spiral twist', 0.5),
		param('arms', 'Arms', 2, 1, 3, 1),
		param('dir', 'Direction', 1, -1, 1, 2)
	],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		// The passage's own level, latched on the beat. Straight off `f.energy` this swung the
		// whole field four to one between frames, which is the arrangement's dynamics arriving
		// as a dimmer rather than as a gesture.
		const passage = new BeatHold(0.5);
		let surge = 0;

		return {
			reset() {
				passage.reset();
				surge = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				surge += f.kickEnv * f.dt * 1.8 * motion;
				surge *= Math.exp(-f.dt / Math.max(0.1, f.beatPeriod * 3));
				// The phase is read off the absolute bar clock so a seek reproduces the frame
				// exactly; ctx.motion deliberately does not scale it, because multiplying a
				// growing counter by a value the player cross-fades between cues moves the
				// pattern by the whole elapsed length.
				const dir = p.dir < 0 ? -1 : 1;
				const spin = dir * ((f.barIndex + f.barPhase) / Math.max(0.5, p.barsPerRev) + surge);
				const twist = 1 + p.twist * 3;
				const arms = Math.max(1, Math.round(p.arms));
				const held = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				// The arms are the picture and the dark between them is what makes it turn: held
				// under full so the swirl is contrast rather than a bright field with a pattern on it.
				const gain = (0.27 + p.intensity * 0.5) * clamp(0.7 + held * 0.3);

				for (let i = 0; i < g.count; i++) {
					const s = frac(g.theta[i] + g.dist[i] * twist * 0.4 - spin);
					const w = Math.pow(sinewave(s * arms), 2);
					// Near the axis, brightness lifts toward white: the eye of the vortex.
					const eye = Math.max(0, 1 - g.r[i] * 3.2);
					const arc = paletteArc(s + hueShift);
					const u = eye > 0 ? lerp(arc, SLOT.white, eye * 0.6) : arc;
					sample(palette, u, (0.12 + 0.7 * w + eye * 0.4) * gain, rgb);
					setPixel(buf, i, rgb[0], rgb[1], rgb[2]);
				}

				nblend(out, buf, alphaFor(f.dt, 0.05));
			}
		};
	}
};
