import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { stripAxis } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

interface Splash {
	wall: number;
	born: number;
	power: number;
	snare: boolean;
}

export const splash: EffectDef = {
	id: 'splash',
	name: 'Splash',
	role: 'transient',
	blurb: 'Broad coloured kick splashes on the front and back, with the snares answering on the sides.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 1,
		maxBars: 32,
		peakReserved: false,
		activity: 0.45,
		carries: false,
		kit: 'any'
	},
	params: [INTENSITY, param('size', 'Size', 0.35, 0.1, 1), param('decay', 'Decay beats', 0.55, 0.1, 2)],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const kickWalls = walls.flatMap((s, i) => stripAxis(s) === 'x' ? [i] : []);
		const snareWalls = walls.flatMap((s, i) => stripAxis(s) === 'y' ? [i] : []);
		const shots: Splash[] = Array.from({ length: 12 }, () => ({
			wall: 0, born: -Infinity, power: 0, snare: false
		}));
		const rgb: [number, number, number] = [0, 0, 0];
		let next = 0;
		let kickCount = 0;
		let snareCount = 0;
		return {
			reset() {
				for (const shot of shots) shot.born = -Infinity;
				next = 0;
				kickCount = 0;
				snareCount = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);
				for (let voice = 0; voice < 2; voice++) {
					const fired = voice === 0 ? f.kick : f.snare;
					const level = voice === 0 ? f.kickEnv : f.snareEnv;
					const axis = voice === 0 ? kickWalls : snareWalls;
					if (!fired || level <= 0.05 || axis.length === 0) continue;
					const count = voice === 0 ? kickCount++ : snareCount++;
					for (let k = 0; k < axis.length; k++) {
						const shot = shots[next];
						next = (next + 1) % shots.length;
						shot.wall = axis[k];
						shot.born = f.t;
						shot.power = Math.pow(clamp(level), 0.85) * (k === count % axis.length ? 1 : 0.55);
						shot.snare = voice === 1;
					}
				}
				const release = Math.max(0.04, p.decay * f.beatPeriod * 0.65 / Math.max(0.35, motion));
				const gain = 0.35 + p.intensity * 0.64;
				for (const shot of shots) {
					const age = f.t - shot.born;
					if (age > 0.04 + release * 5) continue;
					const amp = shot.power * gain * Math.exp(-Math.max(0, age - 0.04) / release);
					const wall = walls[shot.wall];
					const width = (0.1 + p.size * 0.2) * (shot.snare ? 0.8 : 1);
					const slot = shot.snare ? SLOT.accent : SLOT.base;
					for (let k = 0; k < wall.count; k++) {
						const distance = ((k + 0.5) / wall.count - 0.5) / width;
						const v = amp * Math.exp(-0.5 * distance * distance);
						sample(palette, slot + hueShift, v, rgb);
						const at = (wall.offset + k) * 3;
						// Retain attack contrast without summing repeated hits into a steady field.
						out[at] = Math.max(out[at], rgb[0]);
						out[at + 1] = Math.max(out[at + 1], rgb[1]);
						out[at + 2] = Math.max(out[at + 2], rgb[2]);
					}
				}
			}
		};
	}
};
