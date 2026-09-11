import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { hash01 } from '../dsl/rng.ts';
import { INTENSITY, param } from './helpers.ts';

/** Metres per second. About walking pace, so one crossing of a 5 m room takes six seconds. */
const SPEED = 0.85;

/** How many crests trail the leading one. A dropped stone makes a packet, not a single ring. */
const CRESTS = 3;

/**
 * Compute waves in world space so walls and beam receive the front at physical distances.
 * Hash each origin for deterministic seeks. Sparse output cannot carry a cue.
 */
export const ripple: EffectDef = {
	id: 'ripple',
	name: 'Ripple',
	role: 'accent',
	blurb: 'A single ring spreading out from one point in the room, every few seconds.',
	taste: {
		energy: 1,
		sections: ['intro', 'breakdown', 'void', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 2.99,
		carries: false
	},
	params: [
		INTENSITY,
		param('every', 'Seconds between', 10, 4, 24, 0.5),
		param('reach', 'Reach', 0.6)
	],
	create(g) {
		// The half-diagonal plus a margin: how far the front travels before it has left the room.
		let span = 1;
		for (let i = 0; i < g.count; i++) {
			const d = Math.hypot(g.x[i], g.y[i]);
			if (d > span) span = d;
		}
		span *= 2;

		let clock = 0;
		let seq = 0;
		let ox = 0;
		let oy = 0;

		const place = (n: number) => {
			// Keep origins off-centre to avoid symmetric wavefronts.
			const a = hash01(n * 37 + 11) * Math.PI * 2;
			const r = 0.25 + hash01(n * 91 + 7) * 0.7;
			ox = Math.cos(a) * r * (g.extent * 0.35);
			oy = Math.sin(a) * r * (g.extent * 0.28);
		};
		place(0);

		return {
			reset() {
				clock = 0;
				seq = 0;
				place(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);

				const every = Math.max(2, p.every);
				clock += f.dt * motion;
				while (clock >= every) {
					clock -= every;
					seq++;
					place(seq);
				}

				const front = clock * SPEED;
				if (front <= 0) return;
				// Dies out as it spreads, and never quite reaches the far corner of a big room.
				const reach = span * (0.45 + clamp(p.reach) * 0.7);
				const fade = clamp(1 - front / reach);
				if (fade <= 0) return;

				const gain = (0.7 + p.intensity * 1.2) * fade * fade;
				const width = 0.34 + front * 0.09;
				const twoSigmaSq = 2 * width * width;

				for (let i = 0; i < g.count; i++) {
					const d = Math.hypot(g.x[i] - ox, g.y[i] - oy) - front;
					// Only behind the front: a wave has water in front of it, not light.
					if (d > width * 2 || d < -width * (CRESTS * 2 + 1)) continue;
					const env = Math.exp(-(d * d) / (twoSigmaSq * CRESTS * CRESTS));
					// The packet: the leading crest is the brightest and each one behind it is dimmer.
					const crest = 0.5 + 0.5 * Math.cos((d / width) * Math.PI);
					const v = env * crest * crest;
					if (v < 0.004) continue;
					addSample(out, i, palette, lerp(SLOT.glow, SLOT.white, v) + hueShift, v * gain);
				}
			}
		};
	}
};
