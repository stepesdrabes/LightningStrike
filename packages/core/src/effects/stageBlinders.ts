import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { Presence } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** Seconds a blinder holds full before the filament starts to cool. */
const HOLD = 0.05;

/**
 * Kit-driven hits keep the room dark between events; the grid alone would overfill every drop.
 * Hold briefly, then cool like a filament within one hue family.
 */
export const stageBlinders: EffectDef = {
	id: 'stageBlinders',
	name: 'Stage Blinders',
	role: 'accent',
	blurb: 'Tungsten blinders: the downbeat hit at full, the hard hits between it answered, cooling white to amber.',
	taste: {
		energy: 4,
		// Exclude breakdowns; this event cannot carry a stripped passage.
		sections: ['groove', 'build', 'drop'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false,
		activity: 1,
		carries: false,
		character: 'impact',
		kit: 'any'
	},
	params: [INTENSITY, param('answer', 'How hard the off-beats answer', 0.25)],
	create(g) {
		const kit = new Presence();
		let level = 0;
		let held = 0;
		let lastHit = -Infinity;

		return {
			reset() {
				kit.reset();
				level = 0;
				held = 0;
				lastHit = -Infinity;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const env = Math.max(f.kickEnv, f.snareEnv);
				const playing = kit.update(env, f.dt, f.beatPeriod);

				// Limit to one hit per third of a beat so rolls do not become strobes.
				if ((f.kick || f.snare) && f.t - lastHit > f.beatPeriod * 0.34 && playing > 0.08) {
					const strength = f.downbeat ? 1 : env > 0.45 ? p.answer * clamp(0.4 + 0.6 * env) : 0;
					if (strength > 0) {
						lastHit = f.t;
						if (strength * playing > level) {
							level = strength * playing;
							held = HOLD;
						}
					}
				}
				// A half-beat tail (~200-300 ms at club tempos) approximates a large tungsten
				// filament.
				if (held > 0) held -= f.dt;
				else level *= Math.exp(-f.dt / Math.max(0.04, f.beatPeriod * 0.5));
				if (level < 0.004) {
					level = 0;
					out.fill(0);
					return;
				}

				// Cool only to the bright base read; crossing third would add a hue change on
				// every hit.
				const slot = lerp(SLOT.white, SLOT.glow, (1 - level) * 0.8);
				// Exceed one before mixing to reach white through the accent role's 0.55
				// opacity.
				fillSolid(out, g.count, sample(palette, slot + hueShift, level * (0.8 + p.intensity * 1.1)));
			}
		};
	}
};
