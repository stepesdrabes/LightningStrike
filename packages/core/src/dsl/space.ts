import type { Geometry, StripSpec } from '../contracts/room.ts';
import { stampGaussian } from './buffer.ts';
import { clamp, frac } from './math.ts';

/** Perimeter coordinate, falling back to the beam's strip coordinate. */
export function ringU(g: Geometry, i: number): number {
	return g.perim[i] >= 0 ? g.perim[i] : g.local[i];
}

/** Axis-aligned runs share a downward normal; their spanned axis distinguishes them. */
export function stripAxis(s: StripSpec): 'x' | 'y' {
	return Math.abs(s.end[0] - s.start[0]) >= Math.abs(s.end[1] - s.start[1]) ? 'x' : 'y';
}

/** Ring topology for seamless perimeter trails and chases. */
export interface Ring {
	name: string;
	/** Ring position -> global LED index. */
	map: Uint16Array;
	length: number;
	metres: number;
	wraps: boolean;
}

export interface Rings {
	perimeter: Ring;
	/** Half the perimeter; `scatter` mirrors it onto the other half. */
	perimeterHalf: Ring;
	beam: Ring;
	all: Ring;
}

function ringFromIndices(
	name: string,
	indices: number[],
	metres: number,
	wraps: boolean
): Ring {
	return { name, map: Uint16Array.from(indices), length: indices.length, metres, wraps };
}

const cache = new WeakMap<Geometry, Rings>();

export function ringsFor(g: Geometry): Rings {
	const cached = cache.get(g);
	if (cached) return cached;

	const perimIdx: number[] = [];
	for (let i = 0; i < g.count; i++) if (g.perim[i] >= 0) perimIdx.push(i);
	perimIdx.sort((a, b) => g.perim[a] - g.perim[b]);

	const beamIdx: number[] = [];
	for (let i = 0; i < g.count; i++) if (g.perim[i] < 0) beamIdx.push(i);

	const allIdx: number[] = [];
	for (let i = 0; i < g.count; i++) allIdx.push(i);

	const half = perimIdx.slice(0, Math.ceil(perimIdx.length / 2));

	const rings: Rings = {
		perimeter: ringFromIndices('perimeter', perimIdx, g.perimeterLength, true),
		perimeterHalf: ringFromIndices('perimeterHalf', half, g.perimeterLength / 2, false),
		beam: ringFromIndices('beam', beamIdx, beamIdx.length * g.pitch, false),
		all: ringFromIndices('all', allIdx, g.count * g.pitch, false)
	};

	cache.set(g, rings);
	return rings;
}

/** Copy a ring-space buffer out to the physical buffer. */
export function scatter(ring: Ring, src: Float32Array, dst: Float32Array): void {
	const m = ring.map;
	for (let i = 0; i < ring.length; i++) {
		const s = i * 3;
		const d = m[i] * 3;
		dst[d] = src[s];
		dst[d + 1] = src[s + 1];
		dst[d + 2] = src[s + 2];
	}
}

export function scatterAdd(ring: Ring, src: Float32Array, dst: Float32Array): void {
	const m = ring.map;
	for (let i = 0; i < ring.length; i++) {
		const s = i * 3;
		const d = m[i] * 3;
		dst[d] += src[s];
		dst[d + 1] += src[s + 1];
		dst[d + 2] += src[s + 2];
	}
}

/** Mirror a half-ring buffer onto both halves of the full perimeter. */
export function scatterMirrored(
	full: Ring,
	half: Ring,
	src: Float32Array,
	dst: Float32Array
): void {
	const n = half.length;
	for (let i = 0; i < n; i++) {
		const s = i * 3;
		const a = half.map[i] * 3;
		dst[a] = src[s];
		dst[a + 1] = src[s + 1];
		dst[a + 2] = src[s + 2];

		const mirrorPos = full.length - 1 - i;
		if (mirrorPos < n) continue;
		const b = full.map[mirrorPos] * 3;
		dst[b] = src[s];
		dst[b + 1] = src[s + 1];
		dst[b + 2] = src[s + 2];
	}
}

/** Convert a world speed into ring positions per second. */
export function pxPerSecond(ring: Ring, metresPerSecond: number): number {
	return (metresPerSecond / ring.metres) * ring.length;
}

/** Clip sub-pixel blobs to their strip so concatenated buffers cannot leak onto the beam. */
export function stampOnStrip(
	buf: Float32Array,
	count: number,
	strip: StripSpec,
	pos: number,
	sigma: number,
	rgb: readonly [number, number, number]
): void {
	const lo = strip.offset;
	stampGaussian(buf, count, lo + pos, sigma, rgb[0], rgb[1], rgb[2], false, lo, lo + strip.count);
}

/**
 * Stereo bias in 0..1 x-space, limited by reach to avoid lurching across the room.
 * Scale the excursion by panWidth when mono passages should stay centred.
 */
export function panU(pan: number, reach = 0.35): number {
	return 0.5 + clamp(pan, -1, 1) * reach;
}

/** 1-D room projections, reusable across spatial patterns. */
export type Projection =
	| 'perimeter'
	| 'radial'
	| 'height'
	| 'sweep'
	| 'pinwheel'
	| 'local'
	| 'index'
	| 'dist';

/** Fills `out` (length g.count) with each LED's 0..1 coordinate under `projection`. */
export function computeU(
	out: Float32Array,
	g: Geometry,
	projection: Projection,
	angle = 0
): void {
	switch (projection) {
		case 'perimeter':
			for (let i = 0; i < g.count; i++) out[i] = g.perim[i] >= 0 ? g.perim[i] : g.local[i];
			return;
		case 'radial':
			for (let i = 0; i < g.count; i++) out[i] = g.r[i];
			return;
		case 'height':
			for (let i = 0; i < g.count; i++) out[i] = g.nz[i];
			return;
		case 'dist':
			for (let i = 0; i < g.count; i++) out[i] = g.dist[i];
			return;
		case 'local':
			for (let i = 0; i < g.count; i++) out[i] = g.local[i];
			return;
		case 'index':
			for (let i = 0; i < g.count; i++) out[i] = i / (g.count - 1);
			return;
		case 'pinwheel':
			for (let i = 0; i < g.count; i++) out[i] = frac(g.theta[i] + g.r[i] * 0.5);
			return;
		case 'sweep': {
			const cx = Math.cos(angle);
			const cy = Math.sin(angle);
			let min = Infinity;
			let max = -Infinity;
			for (let i = 0; i < g.count; i++) {
				const v = g.nx[i] * cx + g.ny[i] * cy;
				out[i] = v;
				if (v < min) min = v;
				if (v > max) max = v;
			}
			const span = max - min || 1;
			for (let i = 0; i < g.count; i++) out[i] = (out[i] - min) / span;
			return;
		}
	}
}

/** Sample a 1-D pattern at each LED's projected coordinate, linearly interpolated. */
export function paint(
	dst: Float32Array,
	g: Geometry,
	u: Float32Array,
	src: Float32Array,
	srcLen: number,
	add = false
): void {
	const last = srcLen - 1;
	for (let i = 0; i < g.count; i++) {
		const p = clamp(u[i]) * last;
		const a = Math.floor(p);
		const b = a >= last ? last : a + 1;
		const f = p - a;
		const o = i * 3;
		const sa = a * 3;
		const sb = b * 3;
		const r = src[sa] + (src[sb] - src[sa]) * f;
		const gg = src[sa + 1] + (src[sb + 1] - src[sa + 1]) * f;
		const bb = src[sa + 2] + (src[sb + 2] - src[sa + 2]) * f;
		if (add) {
			dst[o] += r;
			dst[o + 1] += gg;
			dst[o + 2] += bb;
		} else {
			dst[o] = r;
			dst[o + 1] = gg;
			dst[o + 2] = bb;
		}
	}
}
