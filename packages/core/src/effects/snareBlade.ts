import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_BLADES = 4;

interface Blade {
	alive: boolean;
	strip: number;
	t0: number;
	fromEnd: number;
	power: number;
}

export const snareBlade: EffectDef = {
	id: 'snareBlade',
	name: 'Snare Blade',
	role: 'transient',
	blurb: 'A feathered coloured stroke crosses one wall on the snare, with a softer opposing reply.',
	taste: {
		energy: 4,
		sections: ['groove', 'verse', 'build', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.45,
		carries: false,
		kit: 'snare'
	},
	params: [INTENSITY, param('sweepBeats', 'Sweep length', 0.5, 0.25, 1.1, 0.05)],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const blades: Blade[] = [];
		for (let i = 0; i < MAX_BLADES; i++) {
			blades.push({ alive: false, strip: 0, t0: 0, fromEnd: 0, power: 0 });
		}
		const rgb: [number, number, number] = [0, 0, 0];
		let next = 0;
		let strokes = 0;
		return {
			reset() {
				for (const b of blades) b.alive = false;
				next = 0;
				strokes = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);
				if (walls.length === 0) return;
				if (f.snare && f.snareEnv > 0.05) {
					const b = blades[next];
					next = (next + 1) % MAX_BLADES;
					b.alive = true;
					b.strip = strokes % walls.length;
					b.fromEnd = (strokes >> 1) % 2;
					b.t0 = f.t;
					b.power = Math.pow(clamp(f.snareEnv), 0.85);
					strokes++;
				}

				const tempo = Math.max(0.15, f.beatPeriod);
				const sweep = Math.max(0.12, p.sweepBeats * tempo / Math.max(0.55, motion));
				const life = Math.max(0.24, tempo * 1.05 / Math.max(0.7, motion));
				const reply = Math.min(0.04, tempo * 0.08);
				const pop = Math.max(0.045, tempo * 0.22);
				const gain = 0.42 + p.intensity * 0.66;

				for (const b of blades) {
					if (!b.alive) continue;
					const elapsed = f.t - b.t0;
					if (elapsed >= life + reply) {
						b.alive = false;
						continue;
					}
					for (let m = 0; m < Math.min(2, walls.length); m++) {
						const age = elapsed - m * reply;
						if (age < 0 || age >= life) continue;
						const wall = walls[(b.strip + m * Math.ceil(walls.length / 2)) % walls.length];
						const fromEnd = (b.fromEnd + m) % 2;
						const u = clamp(age / sweep);
						const head = 0.18 + 0.64 * (1 - (1 - u) ** 2);
						const fade = Math.pow(clamp(1 - Math.max(0, age - 0.04) / (life - 0.04)), 1.15);
						const body = 0.14 + 0.12 * Math.exp(-age / pop);
						const weight = b.power * gain * fade * (m === 0 ? 1 : 0.45);
						for (let k = 0; k < wall.count; k++) {
							const x = (k + 0.5) / wall.count;
							const behind = fromEnd === 0 ? head - x : x - (1 - head);
							const blade = Math.exp(-0.5 * (behind / 0.14) ** 2);
							const trail = behind > 0 ? Math.exp(-behind / 0.23) * 0.32 : 0;
							const v = (blade * 0.92 + trail + body) * weight;
							const slot = lerp(SLOT.base, SLOT.glow, 0.45 + blade * 0.5);
							sample(palette, slot + hueShift, v, rgb);
							const at = (wall.offset + k) * 3;
							// Repeated strokes retain their shape without accumulating a white wall.
							out[at] = Math.max(out[at], rgb[0]);
							out[at + 1] = Math.max(out[at + 1], rgb[1]);
							out[at + 2] = Math.max(out[at + 2], rgb[2]);
						}
					}
				}
			}
		};
	}
};
