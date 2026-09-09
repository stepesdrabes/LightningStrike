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
 * Three molten drops drifting around the ring. Where two overlap their light adds and
 * the palette slot climbs toward the glow, so touching blobs visibly fuse into something
 * hotter instead of just being brighter.
 *
 * How bright the room is remains the cue's business; what the mix gets to say is where the drops
 * sit and how hot they are, so a bass-heavy passage huddles them together in the room's own
 * colour and one that opens up spreads them out toward the third hue.
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
		// Blobs, by construction: 37% of its light in a tenth of the pixels, and where the
		// blobs are not is unlit room.
		carries: false
	},
	params: [INTENSITY, param('size', 'Blob size', 0.5)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const passage = new BeatHold(0.45);
		// A long glide, because this one moves the drops: a position has to arrive rather than
		// step, and half a beat is short enough that it still arrives on the music.
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

				// The floor is high because the cue's own intensity already says the passage is
				// quiet. A bed that dims itself as well is dimmed twice, and two multiplications
				// of a number under one is how an intro reached byte zero.
				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				level = envelope(level, clamp(0.55 + passageLevel * 0.45), f.dt, 0.2, 1.1);
				const gain = level * (0.42 + p.intensity * 0.8);
				const clock = (f.barIndex + f.barPhase) * 0.03 * motion;
				const sigma = 0.03 + p.size * 0.05;
				const inv = 1 / (2 * sigma * sigma);

				const tilt = lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const spread = (tilt - 0.5) * 0.16;
				// Hotter as the mix opens up, and never past a hue the show declared.
				// A spectral term may only walk the slot inside base..glow. That span is safe because it
				// is a SATURATION move at constant flux (measured x1.03 over 24 hues); crossing to
				// white is x2.66, a spectrum driving BRIGHTNESS through the palette, which is the
				// blinking the mixer already had to be rescued from once.
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
