import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { hash01 } from '../dsl/rng.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { Follower } from '../dsl/env.ts';
import { INTENSITY } from './helpers.ts';

/** Soft crown-and-spill gestures omit character so no-flash families can use them. */
export const crownSpill: EffectDef = {
	id: 'crownSpill',
	name: 'Crown Spill',
	role: 'accent',
	blurb: 'Ceiling ignites on the downbeat, spilling down the walls a beat behind.',
	taste: {
		energy: 4,
		// Eligible for both drop and chorus arrivals.
		sections: ['drop', 'chorus'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false,
		activity: 0.5,
		// The quiet beam between eruptions cannot carry a cue.
		carries: false
	},
	params: [INTENSITY],
	create(g) {
		const ceiling = new Uint8Array(g.count);
		for (const s of g.strips) {
			if (s.inPerimeter) continue;
			for (let k = 0; k < s.count; k++) ceiling[s.offset + k] = 1;
		}
		const glitter = new Follower(0.015, 0.12);
		let since = Infinity;

		return {
			reset() {
				glitter.reset();
				since = Infinity;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				if (f.downbeat) since = 0;
				else since += f.dt * ctx.motion;

				const beat = Math.max(0.1, f.beatPeriod);
				// Delay and soften the wall envelope so it reads as spill rather than another
				// white strike.
				const crown = Number.isFinite(since) ? Math.exp(-since / (beat * 0.9)) : 0;
				const spillT = Math.max(0, since - beat * 0.25);
				const spill = Number.isFinite(since) ? 0.75 * Math.exp(-spillT / (beat * 0.85)) : 0;

				// Limit hat contribution to keep beam glints from blinking on every eighth.
				const sparkle = glitter.update(clamp(f.snareEnv * 0.9 + f.hatEnv * 0.2), f.dt);
				const gain = 0.4 + p.intensity * 0.84;

				for (let i = 0; i < g.count; i++) {
					if (ceiling[i]) {
						// Hash glitter per bar; rerolling on each beat reads as noise.
						const grain = hash01(i * 131 + f.barIndex * 17);
						const glint = grain > 0.82 ? sparkle * (0.3 + grain * 0.5) : 0;
						const v = clamp(crown + glint * (1 - crown));
						setSample(
							out,
							i,
							palette,
							lerp(SLOT.glow, SLOT.white, v) + hueShift,
							v * gain
						);
					} else {
						const u = ringU(g, i);
						// A phrase-drifting soft arc avoids stamping the same flat wall level
						// every bar.
						const arc = 0.75 + 0.25 * sinewave(u * 2 + f.phrasePhase);
						const v = clamp(spill * arc);
						setSample(
							out,
							i,
							palette,
							lerp(SLOT.glow, SLOT.white, v * 0.6) + hueShift,
							v * gain
						);
					}
				}
			}
		};
	}
};
