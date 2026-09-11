import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { setPixel } from '../dsl/buffer.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/** Continuous sub-driven reach complements kick shells and collapses when the bass leaves. */
export const subSwell: EffectDef = {
	id: 'subSwell',
	name: 'Sub Swell',
	role: 'transient',
	blurb: 'Radial bloom from the room centre riding the sub-bass envelope.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1
	},
	params: [INTENSITY, param('reach', 'Max reach', 0.6)],
	create(g) {
		// Normalize actual fixture distances so the bloom reaches LEDs instead of empty centre
		// space.
		const depth = new Float32Array(g.count);
		let near = Infinity;
		let far = 0;
		for (let i = 0; i < g.count; i++) {
			if (g.dist[i] < near) near = g.dist[i];
			if (g.dist[i] > far) far = g.dist[i];
		}
		const span = Math.max(1e-3, far - near);
		for (let i = 0; i < g.count; i++) depth[i] = (g.dist[i] - near) / span;

		const level = new BeatHold(0.25);
		let env = 0;
		return {
			reset() {
				env = 0;
				level.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// Spectrum supports the fast reach attack; gain 2.1 compensates for its lower
				// scale
				// than the former band-envelope input.
				env = envelope(
					env,
					clamp(bandBetween(f, 0, 0.12) * 2.1),
					f.dt,
					0.012,
					beatRelease(f.beatPeriod, 0.7)
				);
				const reach = env * (0.35 + p.reach * 0.65);
				// Latch band level for passage loudness; spectrum owns reach articulation.
				const level01 = level.update(
					clamp(0.45 + 0.55 * f.bands[Band.Sub]),
					f.beat,
					f.dt,
					f.beatPeriod
				);
				const gain = (0.3 + p.intensity * 0.8) * level01;

				for (let i = 0; i < g.count; i++) {
					const d = depth[i];
					if (d > reach || reach < 0.02) {
						setPixel(out, i, 0, 0, 0);
						continue;
					}
					const v = 1 - d / reach;
					// Deep shade at the rim, base at the core: a pool of colour, not a spot.
					const slot = lerp(SLOT.deep, SLOT.base, v);
					setSample(out, i, palette, slot + hueShift, v * v * gain);
				}
			}
		};
	}
};
