import type { EffectDef } from '../contracts/effect.ts';
import type { Palette } from '../contracts/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, frac, lerp, smoothstep } from '../dsl/math.ts';
import { stampGaussian } from '../dsl/buffer.ts';
import { ringsFor, scatter } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/** Build progress at which each generation divides; the gaps close toward the drop. */
const SPLITS = [0.3, 0.54, 0.71, 0.83, 0.91, 0.96];
/** The beam stops dividing at sixteen cells, about seven pixels apart. */
const BEAM_GENERATIONS = 4;
/** Middle of the front wall in the counter-clockwise frame, where the first cell sits. */
const FRONT_THETA = 0.75;
/** Pixels: early cells stay bodies on one wall rather than washing the room. */
const MAX_SIGMA = 40;

function sigmaOf(n: number, gen: number): number {
	return Math.min(MAX_SIGMA, (0.2 + 0.03 * gen) * (n / (1 << gen)));
}

/** One generation of cells on a run; s between 0 and 1 is a division in progress. */
function cells(
	buf: Float32Array,
	n: number,
	wrap: boolean,
	origin: number,
	gen: number,
	s: number,
	palette: Palette,
	membrane: number,
	nucleus: number,
	level: number,
	rgb: [number, number, number]
): void {
	const count = 1 << gen;
	const spacing = n / count;
	// The membranes pinch on an eased curve; the nuclei part first, on a faster one.
	const sm = s * s * (3 - 2 * s);
	const sn = 1 - (1 - clamp(s * 1.4)) ** 2;
	const sigma = lerp(sigmaOf(n, gen), sigmaOf(n, gen + 1), sm);
	// Coincident halves sum to one parent, so a division moves light instead of adding it.
	const amp = s > 0 ? 0.5 + 0.5 * sm : 1;
	const apart = spacing / 4;
	const nucleusShare = 1 - smoothstep(3, 6, gen);
	const halves = s > 0 ? 2 : 1;
	for (let k = 0; k < count; k++) {
		const at = origin + (k + 0.5) * spacing - n / 2;
		for (let h = 0; h < halves; h++) {
			const dir = halves === 1 ? 0 : h === 0 ? -1 : 1;
			sample(palette, membrane, level * amp * 0.62, rgb);
			stampGaussian(buf, n, at + dir * apart * sm, sigma, rgb[0], rgb[1], rgb[2], wrap);
			if (nucleusShare < 0.01) continue;
			sample(palette, nucleus, level * amp * 0.5 * nucleusShare, rgb);
			stampGaussian(buf, n, at + dir * apart * sn, sigma * 0.35, rgb[0], rgb[1], rgb[2], wrap);
		}
	}
}

/**
 * One cell divides on the beat each time the build crosses a split, until the ring is a
 * necklace of light on the drop. Daughters shrink as they separate.
 */
export const mitosis: EffectDef = {
	id: 'mitosis',
	name: 'Mitosis',
	role: 'rhythm',
	blurb: 'One cell of light divides on the beat, then again and faster, until the room is a necklace of light on the drop.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3
	},
	params: [INTENSITY, param('bleach', 'Bleach toward the drop', 0.6)],
	create(g) {
		const rings = ringsFor(g);
		const ring = rings.perimeter;
		const beam = rings.beam;
		const ringBuf = new Float32Array(ring.length * 3);
		const beamBuf = new Float32Array(beam.length * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		let front = 0;
		let best = Infinity;
		for (let k = 0; k < ring.length; k++) {
			const d = Math.abs(frac(g.theta[ring.map[k]] - FRONT_THETA + 0.5) - 0.5);
			if (d < best) {
				best = d;
				front = k;
			}
		}

		let generation = 0;
		let splitAt = -Infinity;
		let started = false;

		return {
			reset() {
				generation = 0;
				splitAt = -Infinity;
				started = false;
				ringBuf.fill(0);
				beamBuf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				const progress = clamp(f.buildProgress);
				let due = 0;
				while (due < SPLITS.length && progress >= SPLITS[due]) due++;
				// Arriving mid-build shows the generation already reached, without replaying it.
				if (!started) {
					started = true;
					generation = due;
				}
				// The first division crosses a quarter of the room over two beats; each later one
				// travels half as far, in half the time, down to half a beat.
				const duration = Math.max(0.15, f.beatPeriod * Math.max(0.5, 2 / (1 << generation)));
				let s = splitAt > -Infinity ? clamp((f.t - splitAt) / duration) : 0;
				if (s >= 1) {
					generation++;
					splitAt = -Infinity;
					s = 0;
				}
				if (f.beat && splitAt === -Infinity && due > generation) {
					generation = due - 1;
					splitAt = f.t;
				}
				if (splitAt === -Infinity && due < generation) generation = due;

				const level = (0.5 + p.intensity * 0.75) * (0.55 + 0.45 * progress);
				const membrane = lerp(SLOT.base, SLOT.glow, 0.2 + 0.5 * progress) + hueShift;
				const bleach = clamp(0.3 + 0.7 * progress * p.bleach);
				const nucleus = lerp(SLOT.glow, SLOT.white, bleach) + hueShift;

				ringBuf.fill(0);
				beamBuf.fill(0);
				cells(ringBuf, ring.length, true, front, generation, s, palette, membrane, nucleus, level, rgb);
				const beamGen = Math.min(generation, BEAM_GENERATIONS);
				const beamSplit = generation < BEAM_GENERATIONS ? s : 0;
				cells(
					beamBuf, beam.length, false, beam.length / 2, beamGen, beamSplit,
					palette, membrane, nucleus, level * 0.85, rgb
				);
				out.fill(0);
				scatter(ring, ringBuf, out);
				scatter(beam, beamBuf, out);
			}
		};
	}
};
