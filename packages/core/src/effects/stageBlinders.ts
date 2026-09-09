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
 * The slam is instant but the decay is filament physics: white-hot cooling through amber.
 * That cooldown is why tungsten blinders feel warm and LEDs feel cold.
 *
 * Struck by the kit, not by the grid. The downbeat's hit gets the full blinder; every other
 * kick or snare that lands hard enough gets an answer sized by how hard, and the room is dark
 * again between them. On the beat grid this fired the whole room to white four times a bar
 * through every drop of fifty-one shows, which was both the brightest thing in the room and
 * the reason nothing else in it could read as a hit.
 */
export const stageBlinders: EffectDef = {
	id: 'stageBlinders',
	name: 'Stage Blinders',
	role: 'accent',
	blurb: 'Tungsten blinders: the downbeat hit at full, the hard hits between it answered, cooling white to amber.',
	taste: {
		energy: 4,
		// No 'breakdown': a stripped passage lit by blinder slams is the documented failure
		// the mustCarry rule exists for, and this effect once caused it.
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

				// A hit lands only once per third of a beat, so a roll is one blow, not a strobe.
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
				// The tail is half a beat, 200 to 300 ms at club tempos, which is how long a
				// 500 to 1000 W lamp takes to go dark: a filament, not a shutter. A third of a
				// beat read as aggressive in the room.
				if (held > 0) held -= f.dt;
				else level *= Math.exp(-f.dt / Math.max(0.04, f.beatPeriod * 0.5));
				if (level < 0.004) {
					level = 0;
					out.fill(0);
					return;
				}

				// Cools white to the room's own bright read and no further: a hit is one colour
				// family, and a cool-down that reached the third hue was a colour change on
				// every blinder.
				const slot = lerp(SLOT.white, SLOT.glow, (1 - level) * 0.8);
				// Past one on purpose: an accent's budget is 0.55, and a blinder that arrives
				// under white is a lamp.
				fillSolid(out, g.count, sample(palette, slot + hueShift, level * (0.8 + p.intensity * 1.1)));
			}
		};
	}
};
