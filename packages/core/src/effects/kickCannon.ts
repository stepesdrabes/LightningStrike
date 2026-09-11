import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addPixel, fadeToBlack } from '../dsl/buffer.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { sample } from '../color/palette.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY } from './helpers.ts';

/** Shockwaves in flight at once. Three outlives a bar of four-on-the-floor at any tempo. */
const SHOTS = 3;

/** Rotate corner launches so the kit moves geometry around the room. */
export const kickCannon: EffectDef = {
	id: 'kickCannon',
	name: 'Kick Cannon',
	role: 'accent',
	blurb: 'Kick-launched shockwaves from the corners, expanding around the perimeter.',
	taste: {
		energy: 4,
		sections: ['groove', 'build', 'drop'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false,
		activity: 0.8,
		// Bursts with darkness between them, however loud the burst.
		carries: false,
		character: 'impact',
		kit: 'kick'
	},
	params: [INTENSITY],
	create(g) {
		// Fixed launch coordinates keep the effect's compass identical across geometries.
		const origins = [0.125, 0.375, 0.625, 0.875];
		const radius = new Float32Array(SHOTS).fill(2);
		const life = new Float32Array(SHOTS);
		const from = new Float32Array(SHOTS);
		let next = 0;
		let corner = 0;

		return {
			reset() {
				radius.fill(2);
				life.fill(0);
				from.fill(0);
				next = 0;
				corner = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				if (f.kick) {
					radius[next] = 0;
					life[next] = clamp(0.55 + f.kickEnv * 0.45);
					from[next] = origins[corner];
					corner = (corner + 1) % origins.length;
					next = (next + 1) % SHOTS;
				}

				// Cross the half-ring in about one beat so consecutive kicks stay distinct.
				const speed = (0.5 / Math.max(0.1, f.beatPeriod)) * ctx.motion;

				fadeToBlack(out, f.dt, 0.05);
				for (let s = 0; s < SHOTS; s++) {
					if (radius[s] > 0.55) continue;
					radius[s] += f.dt * speed;
					const power = life[s] * clamp(1 - radius[s] / 0.5);
					if (power <= 0.004) continue;
					const core = sample(
						palette,
						lerp(SLOT.glow, SLOT.white, power) + hueShift,
						power * (0.4 + p.intensity * 0.7)
					);
					for (let i = 0; i < g.count; i++) {
						const u = ringU(g, i);
						const raw = Math.abs(u - from[s]);
						const dist = Math.min(raw, 1 - raw);
						// A half-metre leading edge and short tail read as a blow.
						const band = clamp(1 - Math.abs(dist - radius[s]) / 0.085);
						if (band <= 0) continue;
						const v = band * band;
						addPixel(out, i, core[0] * v, core[1] * v, core[2] * v);
					}
				}
			}
		};
	}
};
