import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** Move light from beam centre to ends on a kick; keep walls untouched so the sag stays legible. */
export const counterweight: EffectDef = {
	id: 'counterweight',
	name: 'Counterweight',
	role: 'transient',
	blurb: 'Kicks land ON the beam: it sags dark at the impact and tips light out to its ends.',
	taste: {
		energy: 3,
		sections: ['groove', 'verse', 'breakdown', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		kit: 'kick'
	},
	params: [INTENSITY, param('weight', 'Weight', 0.5)],
	create(g) {
		const beam: number[] = [];
		for (let i = 0; i < g.count; i++) if (g.perim[i] < 0) beam.push(i);
		const home = beam.length > 0 ? beam : Array.from({ length: g.count }, (_, i) => i);

		let sag = 0;
		let vel = 0;
		const presence = new Presence();

		return {
			reset() {
				sag = 0;
				vel = 0;
				presence.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);
				const permission = presence.update(f.kickEnv, f.dt, f.beatPeriod);

				if (f.kick) vel += (0.5 + p.weight * 0.7) * (0.4 + 0.6 * f.kickEnv) * permission * 10;
				// Damp the spring to settle inside a beat after one slight overshoot.
				const omega = (2 * Math.PI) / Math.max(0.08, f.beatPeriod * 0.55);
				const dt = f.dt * Math.max(0.05, motion);
				vel += (-2 * 0.5 * omega * vel - omega * omega * sag) * dt;
				sag += vel * dt;
				const depth = clamp(sag);

				const gain = 0.5 + p.intensity * 0.9;
				const n = home.length;
				for (let k = 0; k < n; k++) {
					// 0 at the centre, 1 at either end.
					const x = Math.abs(k / (n - 1) - 0.5) * 2;
					// Displace centre light toward the ends to make the sag read physically.
					const dip = depth * Math.pow(1 - x, 1.6);
					const tip = depth * Math.pow(x, 2.2) * 2;
					const level = clamp(0.3 - dip * 0.28 + tip);
					const slot = lerp(SLOT.base, SLOT.glow, clamp(tip * 1.2));
					setSample(out, home[k], palette, slot + hueShift, level * gain * (0.4 + 0.6 * permission));
				}
			}
		};
	}
};
