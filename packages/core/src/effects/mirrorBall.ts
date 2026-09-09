import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, envelope, frac } from '../dsl/math.ts';
import { stampGaussian } from '../dsl/buffer.ts';
import { ringsFor, scatterAdd } from '../dsl/space.ts';
import { hash01 } from '../dsl/rng.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_GLINTS = 24;

/**
 * Disco glitter without the ball: discrete white glints around the ring and along the
 * beam, the constellation turning once per eight bars while each glint flares and dies on
 * its own phase. Between glints, nothing - the bed underneath carries the room, this is
 * only the glitter on it.
 */
export const mirrorBall: EffectDef = {
	id: 'mirrorBall',
	name: 'Mirror Ball',
	role: 'accent',
	blurb: 'A slow-turning constellation of white glints around the ring and along the beam.',
	taste: {
		energy: 2,
		sections: ['groove', 'verse', 'chorus', 'drop', 'breakdown', 'intro', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0.3,
		quiet: 2.82,
		// Isolated glints over black.
		carries: false
	},
	params: [INTENSITY, param('density', 'Glints', 1, 0.25, 1, 0.05)],
	create(g) {
		const rings = ringsFor(g);
		const ring = rings.perimeter;
		const beamRing = rings.beam;
		const ringScratch = new Float32Array(ring.length * 3);
		const beamScratch = new Float32Array(beamRing.length * 3);
		const rgb: [number, number, number] = [0, 0, 0];

		const pos = new Float32Array(MAX_GLINTS);
		const phase = new Float32Array(MAX_GLINTS);
		const rate = new Float32Array(MAX_GLINTS);
		const onBeam = new Uint8Array(MAX_GLINTS);
		for (let k = 0; k < MAX_GLINTS; k++) {
			pos[k] = hash01(k * 127 + 13);
			phase[k] = hash01(k * 53 + 29);
			// Flare cycles of 6 to 16 beats, mutually incommensurate, so a few glints are
			// always bright and the set never breathes in unison.
			rate[k] = 1 / (6 + hash01(k * 91 + 7) * 10);
			onBeam[k] = hash01(k * 31 + 3) < 0.22 ? 1 : 0;
		}

		let rot = 0;
		let tw = 0;
		let level = 0;

		return {
			reset() {
				rot = 0;
				tw = 0;
				level = 0;
				ringScratch.fill(0);
				beamScratch.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// One lap per 8 bars. Accumulated rather than read off the bar clock, because
				// motion scales this speed and a scaled absolute clock jumps on a motion change.
				rot = frac(rot + (f.dt / Math.max(0.1, f.beatPeriod * 32)) * motion);
				tw += (f.dt / Math.max(0.1, f.beatPeriod)) * motion;
				// The passage's loudness sets the glitter's level, slowly: glints answer the
				// room's state, never individual hits.
				level = envelope(level, clamp(0.3 + f.energy * 0.8), f.dt, 0.1, 0.8);

				ringScratch.fill(0);
				beamScratch.fill(0);

				const count = Math.max(4, Math.round(MAX_GLINTS * p.density));
				const gain = (0.6 + p.intensity) * level;
				sample(palette, SLOT.white + hueShift, 1, rgb);

				for (let k = 0; k < count; k++) {
					// Fourth power of the raised cosine: sharp flare, long dark. A glint is a
					// specular event, not a pulse; at the fifth power on a pixel and a half it
					// was a hot point winking, which sat among the busiest accents in the corpus.
					const c = 0.5 + 0.5 * Math.cos(frac(tw * rate[k] + phase[k]) * Math.PI * 2);
					const flare = c * c * c * c;
					if (flare < 0.01) continue;
					const v = flare * gain * 0.8;
					const u = frac(pos[k] + rot);
					if (onBeam[k] === 1) {
						// Windowed to die at the beam's ends, so the wrap never pops mid-flare.
						const w = Math.sin(Math.PI * u) * v;
						const at = u * beamRing.length;
						stampGaussian(beamScratch, beamRing.length, at, 2, rgb[0] * w, rgb[1] * w, rgb[2] * w, false);
					} else {
						const at = u * ring.length;
						stampGaussian(ringScratch, ring.length, at, 2, rgb[0] * v, rgb[1] * v, rgb[2] * v, true);
					}
				}

				out.fill(0);
				scatterAdd(ring, ringScratch, out);
				scatterAdd(beamRing, beamScratch, out);
			}
		};
	}
};
