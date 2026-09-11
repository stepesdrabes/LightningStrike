import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp, frac, lerp, paletteArc } from '../dsl/math.ts';
import { fadeToBlack, stampGaussian } from '../dsl/buffer.ts';
import { BeatHold } from '../dsl/env.ts';
import { ringsFor, scatter } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { sinewave } from '../dsl/wave.ts';
import { beatRelease, INTENSITY, param, trailDeposit } from './helpers.ts';

const MAX_EMBERS = 32;

/** Hash each ember's character so the build-driven flock remains reproducible on seeks. */
export const emberStorm: EffectDef = {
	id: 'emberStorm',
	name: 'Ember Storm',
	role: 'accent',
	blurb: 'Drifting embers whose wind rises with the build - a storm by the drop.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.4,
		quiet: 8.93,
		// Sparks. 19% of the room, three quarters of its light in a tenth of the pixels.
		carries: false
	},
	params: [INTENSITY, param('count', 'Ember count', 0.35)],
	create(g) {
		const ring = ringsFor(g).perimeter;
		const scratch = new Float32Array(ring.length * 3);
		const home = new Float32Array(MAX_EMBERS);
		const drift = new Float32Array(MAX_EMBERS);
		const flickPhase = new Float32Array(MAX_EMBERS);
		const hot = new Uint8Array(MAX_EMBERS);
		for (let e = 0; e < MAX_EMBERS; e++) {
			home[e] = hash01(e * 13 + 1);
			drift[e] = 0.6 + hash01(e * 7 + 5) * 0.4;
			flickPhase[e] = hash01(e * 31);
			hot[e] = hash01(e * 3) < 0.7 ? 0 : 1;
		}
		// Latch interpolated beat energy before applying it to gain.
		const passage = new BeatHold(0.45);
		const tint = new BeatHold(0.15);
		let windPos = 0;
		let flickPos = 0;

		return {
			reset() {
				passage.reset();
				tint.reset();
				windPos = 0;
				flickPos = 0;
				scratch.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const release = beatRelease(f.beatPeriod, 0.25);
				fadeToBlack(scratch, f.dt, release);

				const tension = clamp(
					Math.max(f.buildProgress, passage.update(f.energy, f.beat, f.dt, f.beatPeriod) * 0.5)
				);
				// Never wrap windPos: per-ember drift factors would turn a lap subtraction into
				// a teleport.
				const barsPerLap = 16 - tension * 12;
				windPos += (f.dt / Math.max(0.4, barsPerLap * 4 * f.beatPeriod)) * motion;
				// Keep flicker to 1.5-4 cycles/beat; faster rates alias or read as blinking
				// points.
				flickPos += (f.dt / f.beatPeriod) * (1.5 + tension * 2.5) * motion;

				const at = tint.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const count = Math.floor(MAX_EMBERS * (0.4 + p.count * 0.6));
				const gain = (0.16 + p.intensity * 0.34) * clamp(0.3 + tension * 0.7) * trailDeposit(f.dt, release);
				// Use one hue family so overlapping trails cannot mix undeclared colours.
				const coal = paletteArc(at);
				const glowing = lerp(coal, SLOT.white, 0.5);

				for (let e = 0; e < count; e++) {
					const u = frac(home[e] + windPos * drift[e]);
					const flick = 0.7 + 0.3 * sinewave(flickPhase[e] + flickPos);
					const c = sample(palette, (hot[e] === 0 ? coal : glowing) + hueShift, flick * gain);
					stampGaussian(scratch, ring.length, u * ring.length, 2.6, c[0], c[1], c[2], true);
				}

				out.fill(0);
				scatter(ring, scratch, out);
			}
		};
	}
};
