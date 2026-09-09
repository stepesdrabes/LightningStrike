import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { alphaFor, clamp, envelope, frac, lerp, paletteArc } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The stretch of the palette a curtain walks as it thins, dense edge to faint tail.
 *
 * An aurora is two neighbouring colours shading into each other rather than a spectrum, so a
 * short arc is the honest translation: the show supplies which two.
 */
const CURTAIN_LO = 0.05;
const CURTAIN_HI = 0.42;

/**
 * The northern lights are the one natural licence for green light in a dark room. Two
 * curtains drift around the ring at bar-locked rates and the colour slides toward violet
 * where they thin out.
 */
export const auroraBorealis: EffectDef = {
	id: 'auroraBorealis',
	name: 'Aurora Borealis',
	role: 'bed',
	blurb: 'Green-to-violet curtains drifting around the room. Breakdown material.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 2.10,
		// Curtains over black. Between them the room is unlit by construction.
		carries: false
	},
	params: [INTENSITY, param('drift', 'Drift speed', 0.4)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const shimmerPhase = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) shimmerPhase[i] = hash01(i) * 6.28;
		// `f.energy` is beat-resolution data the player interpolates per frame, so a brightness
		// multiplied by it slides continuously between the beats.
		const passage = new BeatHold(0.45);
		const lean = new BeatHold(0.4);
		const spread = new BeatHold(0.4);
		let level = 0;

		return {
			reset() {
				level = 0;
				buf.fill(0);
				passage.reset();
				lean.reset();
				spread.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// The floor is high because the cue's own intensity already says the passage is
				// quiet. A bed that dims itself as well is dimmed twice, and two multiplications
				// of a number under one is how an intro reached byte zero.
				const heard = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				level = envelope(level, clamp(0.55 + heard * 0.45), f.dt, 0.2, 1.2);
				const gain = level * (0.55 + p.intensity * 1.1);
				const clock = (f.barIndex + f.barPhase) * (0.02 + p.drift * 0.03) * motion;

				// Where the music sits draws the two curtains together or apart, and a spectrum
				// narrowing onto one voice blooms them wider. Position and width, never level.
				const tilt = lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const focus = spread.update(spectrumFocus(f), f.beat, f.dt, f.beatPeriod);
				const bloom = 1 - focus * 0.35;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const d1 = frac(u - clock - tilt * 0.2 + 0.5) - 0.5;
					const d2 = frac(u + clock * 0.6 + 0.23 + tilt * 0.2 + 0.5) - 0.5;
					const curtain = Math.min(
						1,
						Math.exp(-d1 * d1 * 55 * bloom) + Math.exp(-d2 * d2 * 90 * bloom) * 0.7
					);
					if (curtain < 0.02) {
						// The gap between the curtains sits in the show's own near-black rather than
						// in a colour this effect invented for itself.
						setSample(buf, i, palette, SLOT.deep + hueShift, 0.05);
						continue;
					}
					// Solar-wind shimmer: a fixed spatial texture scanned, never re-rolled -
					// flicker with structure rather than noise.
					const shimmer = 0.75 + 0.25 * sinewave(shimmerPhase[i] + clock * 30);
					const arc = lerp(CURTAIN_LO, CURTAIN_HI, 1 - curtain);
					setSample(buf, i, palette, paletteArc(arc + hueShift), curtain * shimmer * gain);
				}

				nblend(out, buf, alphaFor(f.dt, 0.11));
			}
		};
	}
};
