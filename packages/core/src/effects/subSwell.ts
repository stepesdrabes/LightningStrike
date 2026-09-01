import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { setPixel } from '../dsl/buffer.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/**
 * Not an event but a continuous bloom whose REACH follows the sub-bass, so it
 * complements the kick shells without competing with them. When the sub cuts out before
 * a drop the swell collapses and takes the room's warmth with it.
 */
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
		peakReserved: false
	},
	params: [INTENSITY, param('reach', 'Max reach', 0.6)],
	create(g) {
		// `g.dist` is measured from the room centre, and the nearest LED to it is a third of the
		// way out: every strip sits at the wall/ceiling junction. Against the raw figure the
		// bloom spends its first third on empty space and dies before it reaches a wall, which
		// is why it delivered almost no light at all. Re-based on the room's own depth range.
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

				// The spectrum, not the band: `f.bands` steps once a beat and glides between,
				// so a 12 ms attack asked of it is an attack the signal cannot make. The gain
				// is 2.1 where the band read 1.4 because the two are not the same scale - the
				// band's p90 measures 1.46x the spectrum's over the gate's own journey, which
				// is the ratio bassRing paid when it moved (1.5 -> 2.2).
				env = envelope(
					env,
					clamp(bandBetween(f, 0, 0.12) * 2.1),
					f.dt,
					0.012,
					beatRelease(f.beatPeriod, 0.7)
				);
				const reach = env * (0.35 + p.reach * 0.65);
				// Level stays on the envelope, latched to the beat: how loud a passage is, is
				// exactly what the band is good for, and it is the reach that has to articulate.
				const level01 = level.update(
					clamp(0.45 + 0.55 * f.bands[Band.Sub]),
					f.beat,
					f.dt,
					f.beatPeriod
				);
				const gain = (0.4 + p.intensity) * level01;

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
