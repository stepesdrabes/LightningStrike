import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_SHELLS = 6;

export const shockwave: EffectDef = {
	id: 'shockwave',
	name: 'Shockwave',
	role: 'transient',
	blurb: 'Expanding 3-D shells from the room centre and wall midpoints, one per kick.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 1,
		maxBars: 32,
		peakReserved: false,
		activity: 0.5,
		kit: 'kick'
	},
	params: [
		INTENSITY,
		param('speed', 'Metres/sec', 6, 1, 20, 0.5),
		param('thickness', 'Shell thickness', 0.4, 0.05, 1.2)
	],
	create(g) {
		const originX = new Float32Array(MAX_SHELLS);
		const originY = new Float32Array(MAX_SHELLS);
		const originZ = new Float32Array(MAX_SHELLS);
		const born = new Float32Array(MAX_SHELLS).fill(-1);
		const power = new Float32Array(MAX_SHELLS);
		let next = 0;
		let spawnCount = 0;

		const centreZ = g.z[0] * 0.5;
		const spots: [number, number, number][] = [[0, 0, centreZ]];
		for (const s of g.strips) {
			if (!s.inPerimeter) continue;
			spots.push([
				(s.start[0] + s.end[0]) / 2,
				(s.start[1] + s.end[1]) / 2,
				(s.start[2] + s.end[2]) / 2
			]);
		}

		return {
			reset() {
				born.fill(-1);
				power.fill(0);
				next = 0;
				spawnCount = 0;
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				fadeToBlack(out, f.dt, 0.05);

				if (f.kick) {
					// Round-robin rather than random, so the room reads as a place with fixed
					// sources instead of noise.
					const spot = spots[spawnCount % spots.length];
					spawnCount++;
					originX[next] = spot[0];
					originY[next] = spot[1];
					originZ[next] = spot[2];
					born[next] = f.t;
					power[next] = clamp(0.45 + 0.55 * f.bands[Band.Sub]);
					next = (next + 1) % MAX_SHELLS;
				}

				const speed = p.speed * ctx.motion;
				const inv = 1 / (2 * p.thickness * p.thickness);

				for (let s = 0; s < MAX_SHELLS; s++) {
					if (born[s] < 0) continue;
					const age = f.t - born[s];
					const radius = age * speed;
					const fade = Math.exp(-age * 3.0);
					if (fade < 0.01 || radius > g.extent * 1.6) {
						born[s] = -1;
						continue;
					}
					const amp = power[s] * fade * (0.07 + p.intensity * 0.2);
					const ox = originX[s];
					const oy = originY[s];
					const oz = originZ[s];

					for (let i = 0; i < g.count; i++) {
						const dx = g.x[i] - ox;
						const dy = g.y[i] - oy;
						const dz = g.z[i] - oz;
						const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
						const w = Math.exp(-d * d * inv);
						if (w < 0.01) continue;
						addSample(out, i, palette, lerp(SLOT.base, SLOT.white, w) + ctx.hueShift, w * amp);
					}
				}
			}
		};
	}
};
