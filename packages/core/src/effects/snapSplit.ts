import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp, smoothstep } from '../dsl/math.ts';
import { Presence, PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The room clenches on the kick. At rest the ring's light sits at the middle of each wall;
 * every kick snaps it into the four corners, which flare toward white, and it slides back to
 * the centres over the beat. The total light barely moves, so the gesture is contrast and
 * position rather than a flash, and the hundredth kick lands as hard as the first. The beam
 * answers the snare from its middle, so the backbeat has a home of its own.
 */
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
		kit: 'kick'
	},
	params: [INTENSITY, param('hold', 'Beats to slide back', 0.5, 0.2, 1.2, 0.05)],
	create(g) {
		// Corner-ness per LED: 1 at a corner, 0 at the middle of its wall, in each wall's own
		// length so the long and short runs read the same at their ends. The two fields have
		// about the same total, which is what keeps the snap a move rather than a dip.
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

		return {
			reset() {
				snap.reset();
				answer.reset();
				kit.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);
				if (f.kick) snap.fire(clamp(0.5 + 0.5 * f.kickEnv) * playing);
				if (f.snare) answer.fire(clamp(0.4 + 0.6 * f.snareEnv));
				const s = snap.decay(f.dt, f.beatPeriod, (p.hold * 2) / Math.max(0.05, motion));
				const a = answer.decay(f.dt, f.beatPeriod, 0.5 / Math.max(0.05, motion));

				const gain = 0.31 + p.intensity * 0.45;
				for (let i = 0; i < g.count; i++) {
					if (g.perim[i] < 0) {
						const b = middle[i] * a;
						setSample(out, i, palette, lerp(SLOT.base, SLOT.white, b) + hueShift, (0.1 + 0.9 * b) * gain);
						continue;
					}
					// Where the light is: the middles at rest, the corners on the snap. The rest
					// state sits well under full, so the corners flaring is the bright thing.
					const c = corner[i];
					const field = lerp(1 - c, c, s);
					const slot = lerp(SLOT.base, SLOT.white, clamp(c * s * 1.2));
					setSample(out, i, palette, slot + hueShift, (0.1 + 0.62 * field * field + 0.35 * c * s) * gain);
				}
			}
		};
	}
};
