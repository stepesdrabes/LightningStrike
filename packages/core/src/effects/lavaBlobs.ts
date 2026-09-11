import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, frac, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Overlapping blobs fuse into hotter colour. The spectrum controls position and palette reach;
 * cue intensity owns the level.
 */
export const lavaBlobs: EffectDef = {
	id: 'lavaBlobs',
	name: 'Lava Blobs',
	role: 'bed',
	blurb: 'Molten blobs drifting the ring, fusing where they touch. Slow and heavy.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.05,
		quiet: 1.82,
		// Blob gaps prevent this from carrying a quiet cue alone.
		carries: false
	},
	params: [INTENSITY, param('size', 'Blob size', 0.5)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const passage = new BeatHold(0.45);
		// Glide positions over half a beat to avoid steps.
		const lean = new BeatHold(0.5);
		let level = 0;

		return {
			reset() {
				level = 0;
				passage.reset();
				lean.reset();
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Keep a high floor because cue intensity already dims quiet passages.
				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				level = envelope(level, clamp(0.55 + passageLevel * 0.45), f.dt, 0.2, 1.1);
				const gain = level * (0.42 + p.intensity * 0.8);
				const clock = (f.barIndex + f.barPhase) * 0.03 * motion;
				const sigma = 0.03 + p.size * 0.05;
				const inv = 1 / (2 * sigma * sigma);

				const tilt = lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const spread = (tilt - 0.5) * 0.16;
				// Keep spectral colour modulation in the nearly constant-flux base..glow span.
				const hot = lerp(SLOT.base, SLOT.glow, clamp(tilt * 1.3));

				// Two incommensurate sines per centre: organic drift, still deterministic.
				const c0 = frac(0.1 + 0.3 * Math.sin(clock * 2.3) + 0.1 * Math.sin(clock * 5.1) - spread);
				const c1 = frac(0.45 + 0.28 * Math.sin(clock * 1.7 + 2) + 0.12 * Math.sin(clock * 4.3));
				const c2 = frac(0.78 + 0.26 * Math.sin(clock * 2.9 + 4) + 0.1 * Math.sin(clock * 3.7) + spread);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Unrolled over the three blobs: no array literal inside the pixel loop.
					let d0 = Math.abs(u - c0);
					if (d0 > 0.5) d0 = 1 - d0;
					let d1 = Math.abs(u - c1);
					if (d1 > 0.5) d1 = 1 - d1;
					let d2 = Math.abs(u - c2);
					if (d2 > 0.5) d2 = 1 - d2;
					const m = Math.exp(-d0 * d0 * inv) + Math.exp(-d1 * d1 * inv) + Math.exp(-d2 * d2 * inv);
					if (m < 0.02) {
						setPixel(buf, i, 0, 0, 0);
						continue;
					}
					const slot = lerp(SLOT.deep, hot, clamp(m * 0.7));
					// Capped near one: two blobs fusing should read hotter in colour, not pin to white.
					setSample(buf, i, palette, slot + hueShift, Math.min(m, 1.1) * gain);
				}

				nblend(out, buf, alphaFor(f.dt, 0.12));
			}
		};
	}
};
