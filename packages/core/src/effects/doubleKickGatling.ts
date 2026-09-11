import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { setPixel } from '../dsl/buffer.ts';
import { INTENSITY } from './helpers.ts';

/** Average the pulse over the interval that the wire holds this frame. */
function framePulse(age: number, dt: number, release: number): number {
	const tailAge = Math.max(0, age - 0.035);
	if (dt <= 0) return Math.exp(-tailAge / release);
	const held = clamp(0.035 - age, 0, dt);
	const tail = Math.exp(-tailAge / release) * release * -Math.expm1(-(dt - held) / release);
	return (held + tail) / dt;
}

/** Alternating half-room flashes keep rapid hits spatially distinct. */
export const doubleKickGatling: EffectDef = {
	id: 'doubleKickGatling',
	name: 'Double-Kick Gatling',
	role: 'transient',
	blurb: 'Kicks strafe hard flashes left/right - a blast beat reads as gunfire.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false,
		activity: 1,
		kit: 'kick'
	},
	params: [INTENSITY],
	create(g) {
		const born = new Float64Array(2).fill(-Infinity);
		const power = new Float32Array(2);
		let side = 1;
		let lastHit = -1;
		let exposure = 0;

		return {
			reset() {
				side = 1;
				born.fill(-Infinity);
				power.fill(0);
				lastHit = -1;
				exposure = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				if (f.dt > 0) exposure = f.dt;

				if (f.kick && f.t - lastHit > 0.05) {
					lastHit = f.t;
					side = -side;
					const index = side > 0 ? 1 : 0;
					born[index] = f.t;
					power[index] = clamp(0.5 + f.kickEnv * 0.6);
				}
				// A six-tenths-beat decay separates rounds while avoiding shutter-like endings.
				const release = Math.max(f.beatPeriod * 0.6, 0.02) / 3;
				const vl = power[0] * framePulse(f.t - born[0], exposure, release);
				const vr = power[1] * framePulse(f.t - born[1], exposure, release);
				if (vl < 0.004 && vr < 0.004) {
					out.fill(0);
					return;
				}

				const gain = 0.45 + p.intensity * 0.8;
				for (let i = 0; i < g.count; i++) {
					const v = g.x[i] < 0 ? vl : vr;
					if (v < 0.004) {
						setPixel(out, i, 0, 0, 0);
						continue;
					}
					// Hot core out at the side walls, falling toward the centre line.
					const reach = clamp(Math.abs(g.x[i]) * 0.55 + 0.45);
					// Cool within one hue family; a thresholded white-to-base change would
					// flash again during decay.
					const slot = lerp(SLOT.glow, SLOT.white, clamp((v - 0.15) / 0.6));
					setSample(out, i, palette, slot + hueShift, v * reach * gain);
				}
			}
		};
	}
};
