import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp, smoothstep } from '../dsl/math.ts';
import { Presence, PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** Seconds the corners hold their peak before sliding back: past the eye's integration window. */
const HOLD = 0.06;

export const snapSplit: EffectDef = {
	id: 'snapSplit',
	name: 'Snap Split',
	role: 'rhythm',
	blurb: 'The ring snaps its light into the corners on every kick and slides it back; the beam answers the snare.',
	taste: {
		energy: 4,
		sections: ['groove', 'verse', 'build', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.4,
		kickAccent: true,
		kit: 'kick'
	},
	params: [INTENSITY, param('hold', 'Beats to slide back', 0.75, 0.2, 1.2, 0.05)],
	create(g) {
		// Normalize within each strip so long and short walls distribute their light equally.
		const corner = new Float32Array(g.count);
		const middle = new Float32Array(g.count);
		for (const s of g.strips) {
			for (let k = 0; k < s.count; k++) {
				const i = s.offset + k;
				const x = Math.abs((k + 0.5) / s.count - 0.5) * 2;
				if (s.inPerimeter) corner[i] = smoothstep(0.2, 0.85, x);
				else middle[i] = 1 - smoothstep(0, 0.5, x);
			}
		}
		const snap = new PulseEnv();
		const answer = new PulseEnv();
		const kit = new Presence();
		let held = 0;

		return {
			reset() {
				snap.reset();
				answer.reset();
				kit.reset();
				held = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);
				if (f.kick) {
					snap.fire(clamp(0.55 + 0.5 * f.kickEnv) * playing);
					held = HOLD;
				}
				if (f.snare) answer.fire(clamp(0.4 + 0.6 * f.snareEnv));
				if (held > 0) held -= f.dt;
				const s = held > 0 ? snap.value : snap.decay(f.dt, f.beatPeriod, (p.hold * 2) / Math.max(0.05, motion));
				const a = answer.decay(f.dt, f.beatPeriod, 0.5 / Math.max(0.05, motion));

				const gain = 0.32 + p.intensity * 0.46;
				for (let i = 0; i < g.count; i++) {
					if (g.perim[i] < 0) {
						const b = middle[i] * a;
						setSample(out, i, palette, lerp(SLOT.base, SLOT.white, b) + hueShift, (0.1 + 1.14 * b) * gain);
						continue;
					}
					const c = corner[i];
					const field = lerp(1 - c, c, s);
					const slot = lerp(SLOT.base, SLOT.white, clamp(c * s * 1.3));
					setSample(out, i, palette, slot + hueShift, (0.1 + 0.62 * field * field + 0.43 * c * s) * gain);
				}
			}
		};
	}
};
