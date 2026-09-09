import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { hash01 } from '../dsl/rng.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { Follower } from '../dsl/env.ts';
import { INTENSITY } from './helpers.ts';

/**
 * The chorus crown: the ceiling beam ignites on each downbeat and the light spills down
 * onto the walls a quarter-beat behind it, white cooling to the room's bright read as it
 * falls. Between downbeats the beam carries a snare-answering glitter, so the crown stays
 * alive through the bar without competing with the layers under it.
 *
 * Written for choruses in the song vocabulary and deliberately soft-edged: no character
 * tag, because this is the anthem accent the no-flash families are allowed to reach for.
 */
export const crownSpill: EffectDef = {
	id: 'crownSpill',
	name: 'Crown Spill',
	role: 'accent',
	blurb: 'Ceiling ignites on the downbeat, spilling down the walls a beat behind.',
	taste: {
		energy: 4,
		// Both loud vocabularies: a ceiling ignition on the downbeat is as much a drop's
		// answer as a chorus's, and without it the club-vocabulary drop accent pool at the
		// top band was stage blinders alone.
		sections: ['drop', 'chorus'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false,
		activity: 0.5,
		// An eruption with a quiet beam between: it decorates a chorus, it cannot floor one.
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
				// The crown flares and is gone within the bar; the walls run a slower envelope a
				// quarter-beat late and at three quarters of the level, which is what makes it a
				// spill rather than a flash of both. At the crown's own level the ring struck
				// white once a bar, in 136 cues of the corpus: the busiest accent in the catalog.
				const crown = Number.isFinite(since) ? Math.exp(-since / (beat * 0.9)) : 0;
				const spillT = Math.max(0, since - beat * 0.25);
				const spill = Number.isFinite(since) ? 0.75 * Math.exp(-spillT / (beat * 0.85)) : 0;

				// The backbeat and a little of the hats: at the hats' full share the beam's
				// glints blinked on every eighth.
				const sparkle = glitter.update(clamp(f.snareEnv * 0.9 + f.hatEnv * 0.2), f.dt);
				const gain = 0.4 + p.intensity * 0.84;

				for (let i = 0; i < g.count; i++) {
					if (ceiling[i]) {
						// Deterministic per-pixel glitter, re-rolled each bar: the beam keeps
						// answering the kit after the flare has left it, and a constellation that
						// holds for a bar reads as glints where one re-rolled per beat read as
						// noise.
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
						// A soft arc keeps the spill from being one flat wall level; it drifts
						// with the phrase so consecutive bars do not stamp the same picture.
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
