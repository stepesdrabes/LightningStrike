import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp } from '../dsl/math.ts';
import { PulseEnv } from '../dsl/env.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY } from './helpers.ts';

/**
 * One gesture per backbeat and nothing else: no kick response, no filler. The darkness
 * around it is what makes the constellation read as expensive rather than busy.
 */
export const flexStrobe: EffectDef = {
	id: 'flexStrobe',
	name: 'Flex Strobe',
	role: 'accent',
	blurb: 'A gold constellation shimmering once per snare. Darkness is the flex.',
	taste: {
		energy: 2,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.4,
		quiet: 1.85,
		// A flash is an event, not a level: it is dark most of the time.
		carries: false,
		character: 'flash'
	},
	params: [INTENSITY],
	create(g) {
		const spots: number[] = [];
		for (let i = 0; i < g.count; i++) if (hash01(i * 13 + 5) < 0.11) spots.push(i);
		const spotIdx = Uint16Array.from(spots);
		const stripOf = new Uint8Array(spotIdx.length);
		const twPhase = new Float32Array(spotIdx.length);
		const twRate = new Float32Array(spotIdx.length);
		for (let k = 0; k < spotIdx.length; k++) {
			stripOf[k] = g.strip[spotIdx[k]];
			// Turns, not radians: `sinewave` takes a 0..1 cycle.
			twPhase[k] = hash01(spotIdx[k]);
			twRate[k] = 0.7 + hash01(spotIdx[k] * 3) * 0.6;
		}
		const env = new PulseEnv();
		let shimmer = 0;

		return {
			reset() {
				env.reset();
				shimmer = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// The constellation never moves, so it is a field and every pixel is written
				// every frame. Decaying the buffer and adding the spots on top made the
				// displayed level roughly four times what the effect asked for, and the
				// shimmer this exists for was clipped away above white.
				out.fill(0);
				if (spotIdx.length === 0) return;

				if (f.snare) env.fire(clamp(0.5 + f.snareEnv * 0.6));
				const v = env.decay(f.dt, f.beatPeriod, 1.65);
				if (v < 0.01) return;

				// Under two cycles per beat. At a fixed 22 turns per second it ran past 25 Hz,
				// which at 60 fps is aliasing rather than a shimmer.
				shimmer += (f.dt / f.beatPeriod) * 1.5 * motion;
				const gain = (0.85 + p.intensity * 1.25) * v;
				for (let k = 0; k < spotIdx.length; k++) {
					const tw = 0.45 + 0.55 * sinewave(twPhase[k] + shimmer * twRate[k]);
					// In the royal and velvet palette families the accent slot IS the gold.
					const c = sample(palette, SLOT.accent + hueShift, tw * gain);
					const strip = g.strips[stripOf[k]];
					stampOnStrip(out, g.count, strip, spotIdx[k] - strip.offset, 1.6, c);
				}
			}
		};
	}
};
