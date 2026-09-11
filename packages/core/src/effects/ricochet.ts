import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_SHOTS = 6;

interface Shot {
	alive: boolean;
	/** Position and velocity in perimeter units (0..1 around the ring). */
	pos: number;
	vel: number;
	power: number;
	bounces: number;
}

/** Corner impacts reflect with loss and flash the architecture, keeping the gesture directional. */
export const ricochet: EffectDef = {
	id: 'ricochet',
	name: 'Ricochet',
	role: 'transient',
	blurb: 'Kicks fire packets from the corners that ricochet down the walls and die in two bounces.',
	taste: {
		energy: 4,
		sections: ['groove', 'verse', 'breakdown', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.5,
		kit: 'kick'
	},
	params: [INTENSITY, param('speed', 'Shot speed', 0.5), param('loss', 'Bounce loss', 0.45)],
	create(g) {
		// Corner positions in perimeter space, found where the strip id changes.
		const perim: number[] = [];
		for (let i = 0; i < g.count; i++) if (g.perim[i] >= 0) perim.push(i);
		perim.sort((a, b) => g.perim[a] - g.perim[b]);
		const corners: number[] = [];
		for (let k = 0; k < perim.length; k++) {
			const here = perim[k];
			const before = perim[(k - 1 + perim.length) % perim.length];
			if (g.strip[here] !== g.strip[before]) corners.push(here);
		}
		const cornerU = corners.map((i) => g.perim[i]);
		if (cornerU.length === 0) cornerU.push(0);

		const shots: Shot[] = [];
		for (let i = 0; i < MAX_SHOTS; i++) {
			shots.push({ alive: false, pos: 0, vel: 0, power: 0, bounces: 0 });
		}
		let next = 0;
		let launches = 0;
		const presence = new Presence();

		/** The corner ahead of `pos` in the direction of travel. */
		const nextCorner = (pos: number, dir: number): number => {
			let best = -1;
			let bestDist = 2;
			for (const c of cornerU) {
				const d = dir > 0 ? (c - pos + 1) % 1 : (pos - c + 1) % 1;
				if (d > 1e-4 && d < bestDist) {
					bestDist = d;
					best = c;
				}
			}
			return best < 0 ? pos : best;
		};

		return {
			reset() {
				for (const s of shots) s.alive = false;
				next = 0;
				launches = 0;
				presence.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);
				const permission = presence.update(f.kickEnv, f.dt, f.beatPeriod);

				if (f.kick && permission > 0.15) {
					const s = shots[next];
					next = (next + 1) % MAX_SHOTS;
					s.alive = true;
					s.bounces = 0;
					s.power = clamp(0.35 + f.kickEnv * 0.65) * permission;
					// Rotate launch corner and direction deterministically to spread hits
					// around the room.
					s.pos = cornerU[launches % cornerU.length];
					s.vel = (launches % 2 === 0 ? 1 : -1) * (0.55 + p.speed * 0.9);
					launches++;
				}

				// Cross one wall in roughly a third of a beat so the shot stays trackable.
				const dt = f.dt * Math.max(0.05, motion);
				for (const s of shots) {
					if (!s.alive) continue;
					const target = nextCorner(s.pos, s.vel);
					const before = s.pos;
					s.pos = (s.pos + s.vel * dt * 0.28 + 1) % 1;
					const crossed =
						s.vel > 0
							? (target - before + 1) % 1 <= ((s.pos - before + 1) % 1) + 1e-6
							: (before - target + 1) % 1 <= ((before - s.pos + 1) % 1) + 1e-6;
					if (crossed) {
						s.pos = target;
						s.vel = -s.vel;
						s.power *= 1 - (0.35 + p.loss * 0.4);
						s.bounces++;
						if (s.bounces > 2 || s.power < 0.06) {
							s.alive = false;
							continue;
						}
					}
				}

				const gain = 0.45 + p.intensity * 0.9;
				for (let i = 0; i < g.count; i++) {
					const u = g.perim[i];
					if (u < 0) continue;
					for (const s of shots) {
						if (!s.alive) continue;
						const d = Math.min(Math.abs(u - s.pos), 1 - Math.abs(u - s.pos));
						// Use a soft eight-pixel head and trailing tail for visibility without
						// a tracer-like hot point.
						// Reserve white for full-power shots.
						const behind = s.vel > 0 ? (s.pos - u + 1) % 1 : (u - s.pos + 1) % 1;
						if (d < 0.013) {
							const head = 1 - d / 0.013;
							addSample(out, i, palette, lerp(SLOT.glow, SLOT.white, s.power) + hueShift, head * head * s.power * gain);
						} else if (behind < 0.05 && behind > 0) {
							const v = 1 - behind / 0.05;
							addSample(out, i, palette, lerp(SLOT.glow, SLOT.base, v) + hueShift, v * v * s.power * gain * 0.7);
						}
					}
				}
			}
		};
	}
};
