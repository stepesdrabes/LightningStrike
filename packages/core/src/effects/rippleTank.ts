import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { ringsFor } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/** Advance one pixel per simulation step to prevent dispersion. Wave speed is the step rate. */
const MAX_STEPS = 12;
/** Half-widths in pixels. A kick is a hand slapping the water, a snare a fingertip. */
const KICK_WIDTH = 20;
const SNARE_WIDTH = 12;

/**
 * Kick and snare displace water at corners and wall centres. Hats add no stones so the
 * surface can settle between events.
 */
export const rippleTank: EffectDef = {
	id: 'rippleTank',
	name: 'Ripple Tank',
	role: 'transient',
	blurb: 'Kicks drop stones at the corners; smooth waves carry each hit away along the walls.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.5,
		kit: 'any'
	},
	params: [
		INTENSITY,
		param('viscosity', 'Ripple decay', 0.35),
		param('spread', 'Wave speed', 0.5)
	],
	create(g) {
		const ring = ringsFor(g).perimeter;
		const n = ring.length;
		const cur = new Float32Array(n);
		const prev = new Float32Array(n);
		const next = new Float32Array(n);

		// Find corners from strip-ID changes; rectangular rooms need not put them at quarter
		// marks.
		const corners: number[] = [];
		for (let i = 0; i < n; i++) {
			const here = g.strip[ring.map[i]];
			const before = g.strip[ring.map[(i - 1 + n) % n]];
			if (here !== before) corners.push(i);
		}
		if (corners.length === 0) corners.push(0);
		const centres = corners.map((c, k) => {
			const nextCorner = corners[(k + 1) % corners.length];
			const span = (nextCorner - c + n) % n || n;
			return (c + (span >> 1)) % n;
		});

		const kickHome = new Presence();
		const snareHome = new Presence();
		let debt = 0;
		let kickSeq = 0;
		let snareSeq = 0;
		let lastKick = -Infinity;
		let lastSnare = -Infinity;

		// Write a raised cosine into both frames for a displacement at rest. Changing only the
		// current frame adds velocity and creates a spreading lit plateau.
		const drop = (at: number, amp: number, width: number) => {
			for (let d = -width; d <= width; d++) {
				const i = (at + d + n) % n;
				const h = amp * (0.5 + 0.5 * Math.cos((Math.PI * d) / (width + 1)));
				cur[i] += h;
				prev[i] += h;
			}
		};

		return {
			reset() {
				cur.fill(0);
				prev.fill(0);
				next.fill(0);
				kickHome.reset();
				snareHome.reset();
				debt = 0;
				kickSeq = 0;
				snareSeq = 0;
				lastKick = -Infinity;
				lastSnare = -Infinity;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const kicking = kickHome.update(f.kickEnv, f.dt, f.beatPeriod);
				const snaring = snareHome.update(f.snareEnv, f.dt, f.beatPeriod);
				// Reject repeat stones inside a third of a beat while the previous displacement
				// is still rising.
				const refractory = f.beatPeriod * 0.3;
				// Squared hit strength makes stone height read as weight; each voice has a
				// fixed home.
				if (f.kick && kicking > 0.15 && f.t - lastKick > refractory) {
					lastKick = f.t;
					// A soft kick is a glow on the corner and only an accented one reaches white.
					drop(corners[kickSeq++ % corners.length], (0.7 + 0.9 * f.kickEnv * f.kickEnv) * kicking, KICK_WIDTH);
				}
				if (f.snare && snaring > 0.15 && f.t - lastSnare > refractory) {
					lastSnare = f.t;
					drop(centres[snareSeq++ % centres.length], (0.4 + 0.6 * f.snareEnv * f.snareEnv) * snaring, SNARE_WIDTH);
				}

				// Speed and decay are beat-derived. Motion may scale simulation time because
				// this is integrated
				// state, not an absolute grid phase.
				const pxPerSecond = (n * (0.06 + p.spread * 0.08)) / Math.max(0.05, f.beatPeriod);
				const tau = Math.max(0.1, f.beatPeriod * (1.7 - p.viscosity * 1.5));
				const damp = Math.exp(-1 / Math.max(1, pxPerSecond * tau));
				debt += f.dt * pxPerSecond * Math.max(0.05, motion);
				let steps = 0;
				while (debt >= 1 && steps < MAX_STEPS) {
					debt -= 1;
					steps++;
					for (let i = 0; i < n; i++) {
						next[i] = cur[(i - 1 + n) % n] + cur[(i + 1) % n] - prev[i];
					}
					// Damp both frames together to preserve crest shape and avoid
					// counter-running wakes.
					for (let i = 0; i < n; i++) {
						prev[i] = cur[i] * damp;
						cur[i] = next[i] * damp;
					}
				}
				// More than a frame's worth of queued steps is a stall, not a debt worth paying.
				if (debt > MAX_STEPS) debt = 0;

				const gain = 0.6 + p.intensity * 0.85;
				out.fill(0);
				for (let r = 0; r < n; r++) {
					const h = cur[r];
					if (h < 0.01) continue;
					// Keep crests in one hue family, heating toward white with height.
					addSample(out, ring.map[r], palette, lerp(SLOT.base, SLOT.white, clamp(h * 0.8)) + hueShift, clamp(h) * gain);
				}
			}
		};
	}
};
