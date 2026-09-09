import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { nblend } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/**
 * A loud rolling floor for the club sections: two long swells travelling the perimeter in
 * opposite directions, their speed and weight riding the low end of the mix, the kick
 * cutting the troughs deeper so the roll reads against the beat.
 *
 * The point of it is to be a second honest answer where `chorusBloom` was the only loud bed
 * in the catalog: same energy band, a completely different body - that one is six petals
 * answering six bands, this one is one mass of water answering the low end.
 */
export const undertow: EffectDef = {
	id: 'undertow',
	name: 'Undertow',
	role: 'bed',
	blurb: 'Two counter-rolling swells around the room, weighted by the low end.',
	taste: {
		energy: 3,
		sections: ['groove', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		// The weight of the water answers the music through a follower, per the house rule:
		// band envelopes cannot move inside a bar, and a floor pinned for four beats is a
		// picture of the track rather than the track.
		const low = new Follower(0.035, 0.22);
		const punch = new Follower(0.012, 0.1);
		let swellA = 0;
		let swellB = 0.5;

		return {
			reset() {
				low.reset();
				punch.reset();
				swellA = 0;
				swellB = 0.5;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const weight = low.update(clamp(bandAt(f, 0.08) * 1.1 + bandAt(f, 0.25) * 0.5), f.dt);
				const kick = punch.update(clamp(f.kickEnv), f.dt);

				// Both swells make a lap in a handful of bars, faster when the low end leans in,
				// and in opposite directions so the room never reads as one chase.
				const lap = Math.max(0.1, f.beatPeriod * 16);
				swellA += (f.dt * ctx.motion * (0.7 + weight * 0.6)) / lap;
				swellB -= (f.dt * ctx.motion * (0.55 + weight * 0.5)) / lap;

				const gain = (0.36 + p.intensity * 0.76) * (0.42 + weight * 0.6);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const a = 0.5 + 0.5 * sinewave(u - swellA);
					const b = 0.5 + 0.5 * sinewave(u * 2 + swellB);
					// The kick deepens the troughs rather than brightening the crests, so the
					// beat arrives as contrast instead of as another push toward full.
					const sea = clamp(0.3 + a * 0.5 + b * 0.35 - kick * (1 - a) * 0.45);
					// Deep water to the room's bright read, by position only: the crest is the
					// lit part of the roll, and the ramp between them is the shape of the wave.
					const slot = lerp(SLOT.deep, SLOT.glow, sea);
					setSample(buf, i, palette, slot + hueShift, gain * sea);
				}

				nblend(out, buf, alphaFor(f.dt, lerp(0.09, 0.03, kick)));
			}
		};
	}
};
