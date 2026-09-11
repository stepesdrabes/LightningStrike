import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_BLADES = 4;

interface Blade {
	alive: boolean;
	strip: number;
	t0: number;
	/** 0 sweeps low-to-high along the strip, 1 the reverse. */
	fromEnd: number;
	power: number;
}

/** Keep a lit wall under the blade so the narrow stroke remains visible from the room. */
export const snareBlade: EffectDef = {
	id: 'snareBlade',
	name: 'Snare Blade',
	role: 'transient',
	blurb: 'Each snare wipes one wall with a bright blade and a fading trail, alternating walls and directions.',
	taste: {
		energy: 4,
		sections: ['groove', 'verse', 'build', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.5,
		kit: 'snare'
	},
	// Cut in a third of a beat so the snare lands before the head reaches mid-wall.
	params: [INTENSITY, param('sweepBeats', 'Sweep length', 0.32, 0.2, 0.8, 0.05)],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const blades: Blade[] = [];
		for (let i = 0; i < MAX_BLADES; i++) {
			blades.push({ alive: false, strip: 0, t0: 0, fromEnd: 0, power: 0 });
		}
		let next = 0;
		let strokes = 0;
		const presence = new Presence();

		return {
			reset() {
				for (const b of blades) b.alive = false;
				next = 0;
				strokes = 0;
				presence.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);
				if (walls.length === 0) return;
				const permission = presence.update(f.snareEnv, f.dt, f.beatPeriod);

				if (f.snare && permission > 0.15) {
					const b = blades[next];
					next = (next + 1) % MAX_BLADES;
					b.alive = true;
					b.strip = strokes % walls.length;
					b.fromEnd = (strokes >> 1) % 2;
					b.t0 = f.t;
					b.power = clamp(0.45 + f.snareEnv * 0.55) * permission;
					strokes++;
				}

				const sweep = Math.max(0.08, (p.sweepBeats * f.beatPeriod) / Math.max(0.2, motion));
				// Keep a beat-and-a-half life for a lamp-like fading trail.
				const life = Math.max(0.15, f.beatPeriod * 1.5) / Math.max(0.2, motion);
				// The wall answers immediately, then settles to the floor the blade crosses.
				const pop = Math.max(0.03, f.beatPeriod * 0.18) / Math.max(0.2, motion);
				const gain = 0.55 + p.intensity * 0.9;

				for (const b of blades) {
					if (!b.alive) continue;
					const age = f.t - b.t0;
					if (age >= life) {
						b.alive = false;
						continue;
					}
					// Ease out so the stroke reads as a drawn line rather than a scanner.
					const u = Math.min(1, age / sweep);
					const head = 1 - Math.pow(1 - u, 2);
					const fade = 1 - age / life;
					const struck = 0.3 * Math.exp(-age / pop);
					// Mirror on the opposite wall so every seat can see the backbeat.
					for (let m = 0; m < 2; m++) {
						const wall = walls[(b.strip + m * (walls.length >> 1)) % walls.length];
						const fromEnd = (b.fromEnd + m) % 2;
						const n = wall.count;
						for (let k = 0; k < n; k++) {
							const x = (k + 0.5) / n;
							// Distance behind the head along the direction of travel, in wall lengths.
							const behind = fromEnd === 0 ? head - x : x - (1 - head);
							const at = Math.abs(behind) * n;
							// Use a soft six-pixel head below hard white, with a fading trail
							// and lit surface underneath.
							const blade = u < 1 ? Math.exp(-(at * at) / 30) : 0;
							const trail = behind > 0 ? Math.exp(-behind * 3) * 0.8 : 0;
							const v = (blade * 1.1 + trail * fade + (0.4 * fade + struck)) * b.power * gain;
							if (v < 0.01) continue;
							addSample(out, wall.offset + k, palette, lerp(SLOT.glow, SLOT.white, clamp(blade)) + hueShift, v);
						}
					}
				}
			}
		};
	}
};
