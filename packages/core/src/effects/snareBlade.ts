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

/**
 * Every snare draws one straight stroke: a blade wipes a single wall end to end in about a
 * third of a beat, leaving a trail that fades over most of the beat, the next snare taking
 * the next wall in the other direction. One wall at a time and the room never moves at once,
 * which is what separates a stroke from the burst family's everywhere-at-once.
 *
 * The wall it crosses is lit behind it: a stroke three pixels wide across an unlit run
 * measured as nothing at all from the room's side, and a blade needs a surface to cut.
 */
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
	// A third of a beat for the cut: the bright head is the event, and a slower stroke put it
	// mid-wall a tenth of a second after the snare, which the owner heard as the blade
	// arriving late.
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
				// The stroke lives a beat and a half: a quarter of it cutting, the rest as the
				// trail fading, long enough to leave the way a lamp does rather than a shutter.
				const life = Math.max(0.15, f.beatPeriod * 1.5) / Math.max(0.2, motion);
				// The wall under the stroke pops on the snare itself and settles within a fifth
				// of a beat to the lit floor the stroke runs over: the hit is felt where the
				// snare is, and the blade draws the line out of it.
				const pop = Math.max(0.03, f.beatPeriod * 0.18) / Math.max(0.2, motion);
				const gain = 0.55 + p.intensity * 0.9;

				for (const b of blades) {
					if (!b.alive) continue;
					const age = f.t - b.t0;
					if (age >= life) {
						b.alive = false;
						continue;
					}
					// Ease-out: the stroke lands fast and decelerates, which is how a hand
					// draws a line; constant speed reads as a scanner.
					const u = Math.min(1, age / sweep);
					const head = 1 - Math.pow(1 - u, 2);
					const fade = 1 - age / life;
					const struck = 0.3 * Math.exp(-age / pop);
					// The stroke and its mirror on the opposite wall, drawn the other way: one
					// wall alone is a sixth of the room for a third of a beat, and a backbeat
					// wants to be seen from every seat.
					for (let m = 0; m < 2; m++) {
						const wall = walls[(b.strip + m * (walls.length >> 1)) % walls.length];
						const fromEnd = (b.fromEnd + m) % 2;
						const n = wall.count;
						for (let k = 0; k < n; k++) {
							const x = (k + 0.5) / n;
							// Distance behind the head along the direction of travel, in wall lengths.
							const behind = fromEnd === 0 ? head - x : x - (1 - head);
							const at = Math.abs(behind) * n;
							// A bright blade some six pixels wide, the trail it drew fading behind
							// it, and the wall it cuts lit underneath for the stroke's life. The
							// blade itself stops short of a hard white: a stroke is a line of light
							// drawn across a wall, not a flash on it.
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
