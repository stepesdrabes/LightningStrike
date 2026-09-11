import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** Seconds a strike holds full before it cools: over the eye's integration window, under a beat. */
const HOLD = 0.05;

/**
 * Grid-timed wall strikes use kit presence for strength and permission, resting during
 * suspensions.
 */
export const blockChase: EffectDef = {
	id: 'blockChase',
	name: 'Block Chase',
	role: 'rhythm',
	blurb: 'The four walls struck in turn on the beat, hard white cooling to base; the beam takes the one.',
	taste: {
		energy: 4,
		sections: ['groove', 'verse', 'build', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.7,
		kit: 'kick'
	},
	params: [
		INTENSITY,
		// 0 walks the ring, 1 alternates opposite pairs, 2 takes the long walls then the short.
		param('order', 'Strike order', 0, 0, 2, 1),
		// 1 strikes every half bar instead of every beat: the half-time reading.
		param('half', 'Half time', 0, 0, 1, 1)
	],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const beam = g.strips.find((s) => !s.inPerimeter) ?? null;
		const block = new Uint8Array(g.count);
		for (let k = 0; k < walls.length; k++) {
			for (let i = 0; i < walls[k].count; i++) block[walls[k].offset + i] = k;
		}
		const beamBlock = walls.length;
		if (beam) for (let i = 0; i < beam.count; i++) block[beam.offset + i] = beamBlock;
		// Which walls a step strikes, per order, as bitmasks over the four walls.
		const ORDERS: readonly (readonly number[])[] = [
			[1, 2, 4, 8],
			[5, 10, 5, 10],
			[1, 4, 2, 8]
		];
		const level = new Float32Array(walls.length + 1);
		const held = new Float32Array(walls.length + 1);
		const kit = new Presence();
		let lastStep = -1;
		let strike = 0;

		return {
			reset() {
				level.fill(0);
				held.fill(0);
				kit.reset();
				lastStep = -1;
				strike = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);
				const per = p.half > 0.5 ? 2 : 1;

				const step = Math.floor((f.beatIndex + f.beatPhase) / per);
				if (step !== lastStep) {
					lastStep = step;
					if (playing > 0.08) {
						const order = ORDERS[Math.min(ORDERS.length - 1, Math.max(0, Math.round(p.order)))];
						const mask = order[strike % order.length];
						strike++;
						const strength = clamp(0.55 + 0.45 * f.kickEnv) * playing;
						for (let k = 0; k < walls.length; k++) {
							if (mask & (1 << k)) {
								level[k] = strength;
								held[k] = HOLD;
							}
						}
						if (f.downbeat) {
							level[beamBlock] = playing;
							held[beamBlock] = HOLD;
						}
					}
				}

				// Cool within a musical duration before the next strike.
				const tail = Math.max(0.03, f.beatPeriod * per * 0.5) / Math.max(0.05, motion);
				const k = Math.exp(-f.dt / tail);
				for (let b = 0; b < level.length; b++) {
					if (held[b] > 0) held[b] -= f.dt;
					else level[b] *= k;
					if (level[b] < 0.004) level[b] = 0;
				}

				const gain = 0.45 + p.intensity * 0.65;
				// A faint floor between strikes: the wall that just cooled is still a wall.
				const rest = 0.1 * gain;
				for (let i = 0; i < g.count; i++) {
					const v = level[block[i]];
					// Cool white through glow to base; softer kicks stop short of white.
					const slot = lerp(SLOT.base, SLOT.white, clamp(v * 1.15));
					setSample(out, i, palette, slot + hueShift, rest + v * gain);
				}
			}
		};
	}
};
