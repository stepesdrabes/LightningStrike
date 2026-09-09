import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_RINGS = 8;

interface Ripple {
	alive: boolean;
	t0: number;
	power: number;
	slot: number;
}

/**
 * The inverse shockwave: rings converge from the walls into the centre and brighten as
 * they focus. Alternating this with an outward wave keeps the kick vocabulary fresh for
 * a whole track.
 */
export const kickTunnel: EffectDef = {
	id: 'kickTunnel',
	name: 'Kick Tunnel',
	role: 'transient',
	blurb: 'Converging rings pulled into the room centre on every kick - the inhale.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		// Nearly a whole-room striker: a ring converging on the centre crosses every strip at
		// the same depth at the same moment, so each kick lights the whole frame at once,
		// softened only by the ring's width. Rated a partial strike it paired with a rotation
		// and a popping accent into the busiest cue of the corpus.
		activity: 0.85,
		kit: 'kick'
	},
	params: [INTENSITY, param('speed', 'Converge speed', 0.5), param('width', 'Ring width', 0.3)],
	create(g) {
		// The nearest LED to the room centre is a third of the way out, because every strip sits
		// at the wall/ceiling junction. A ring converging through raw `g.dist` therefore leaves
		// the room at four fifths of its life and the focus this effect exists for never lands.
		const depth = new Float32Array(g.count);
		let near = Infinity;
		let far = 0;
		for (let i = 0; i < g.count; i++) {
			if (g.dist[i] < near) near = g.dist[i];
			if (g.dist[i] > far) far = g.dist[i];
		}
		const span = Math.max(1e-3, far - near);
		for (let i = 0; i < g.count; i++) depth[i] = (g.dist[i] - near) / span;

		const rings: Ripple[] = [];
		for (let i = 0; i < MAX_RINGS; i++) {
			rings.push({ alive: false, t0: 0, power: 1, slot: SLOT.base });
		}
		const core = new PulseEnv();
		let next = 0;
		let lastSpawn = -1;

		return {
			reset() {
				for (const r of rings) r.alive = false;
				core.reset();
				next = 0;
				lastSpawn = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// Short on purpose: the rings are added into this buffer every frame, so a longer
				// trail integrates into a brighter, busier room rather than a softer one.
				fadeToBlack(out, f.dt, 0.045);

				if (f.kick && f.t - lastSpawn > Math.max(0.05, f.beatPeriod * 0.3)) {
					lastSpawn = f.t;
					const r = rings[next];
					next = (next + 1) % MAX_RINGS;
					r.alive = true;
					r.t0 = f.t;
					r.power = clamp(0.4 + f.kickEnv * 0.7 + f.bands[Band.Sub] * 0.3);
					// One hue family, alternating saturation rather than hue: where two rings of
					// different hues meet they sum into a colour the show never declared.
					r.slot = f.barIndex % 2 === 0 ? SLOT.base : SLOT.glow;
				}

				// Floor the divisor: at motion near zero the rings should converge SLOWLY, not
				// freeze immortal at the walls.
				const life =
					Math.max(0.15, f.beatPeriod * (0.9 - p.speed * 0.5)) / Math.max(0.2, motion);
				const width = (0.06 + p.width * 0.2) * 1.5;
				const gain = 0.2 + p.intensity * 0.58;

				for (const r of rings) {
					if (!r.alive) continue;
					const u = (f.t - r.t0) / life;
					if (u >= 1) {
						r.alive = false;
						core.fire(r.power);
						continue;
					}
					// Radius shrinks 1 -> 0 across the room's own depth, brightening and heating
					// toward white as it focuses.
					const radius = 1 - u;
					const amp = r.power * gain * (0.4 + 0.6 * u);
					const slot = lerp(r.slot, SLOT.white, u * 0.6) + hueShift;
					for (let i = 0; i < g.count; i++) {
						const d = Math.abs(depth[i] - radius);
						if (d > width) continue;
						const v = 1 - d / width;
						addSample(out, i, palette, slot, v * v * amp);
					}
				}

				const cv = core.decay(f.dt, f.beatPeriod, 1.05);
				if (cv > 0.02) {
					for (let i = 0; i < g.count; i++) {
						if (depth[i] > 0.22) continue;
						const v = (1 - depth[i] / 0.22) * cv;
						addSample(out, i, palette, SLOT.white + hueShift, v * gain * 0.5);
					}
				}
			}
		};
	}
};
