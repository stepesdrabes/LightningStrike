import { mountNormal, planeOf, type LightPixels, type Mount, type Vec3 } from '@mv/core';
import { cross, dot, length, lerp, normalize, perpendicular, scale, sub } from './vec.ts';

export const STRIP_THICKNESS = 0.03;
/** Standoff in metres prevents coplanar z-fighting. */
export const STRIP_STANDOFF = 0.012;

/** Texels in an atlas row; WebGL2 guarantees textures this wide. */
export const ATLAS_WIDTH = 2048;
/** A piece and its two guard texels fill at most one row. */
const MAX_PIECE = ATLAS_WIDTH - 2;
/** Band steps round a whole ring, so a ring of few LEDs still reads round. */
const RING_STEPS = 72;

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export interface LineShape {
	kind: 'line';
	a: Vec3;
	b: Vec3;
}

/** Radians clockwise from `up`, measured as core's `placeRing` measures them. */
export interface ArcShape {
	kind: 'arc';
	centre: Vec3;
	radius: number;
	right: Vec3;
	up: Vec3;
	/** At the piece's start, and signed across it. */
	angle: number;
	sweep: number;
}

export type Shape = LineShape | ArcShape;

/** Consecutive LEDs of one light, drawn as one ribbon and sampled as one atlas strip. */
export interface StripPiece {
	/** Index into `RoomModel.pixels`. */
	light: number;
	/** In the light's own LED order. */
	from: number;
	count: number;
	/** The LEDs its guard texels repeat: neighbours round a ring, the run's own ends on a path. */
	before: number;
	after: number;
	/** Where x = 0..1 lies. LED `from + k` sits at the centre of cell k of `count`. */
	shape: Shape;
	/** Unit vector the LEDs face. */
	normal: Vec3;
}

/** Paths and rings cut into pieces: one per run, and more where a run outgrows an atlas row. */
export function stripPieces(pixels: readonly LightPixels[]): StripPiece[] {
	const pieces: StripPiece[] = [];
	pixels.forEach(({ light }, li) => {
		if (light.kind === 'path') {
			let first = 0;
			light.counts.forEach((n, run) => {
				const a = light.points[run];
				const b = light.points[(run + 1) % light.points.length];
				const normal = faceOf(light.mount, sub(b, a));
				for (let f = 0; f < n; f += MAX_PIECE) {
					const m = Math.min(MAX_PIECE, n - f);
					pieces.push({
						light: li,
						from: first + f,
						count: m,
						before: first + Math.max(f - 1, 0),
						after: first + Math.min(f + m, n - 1),
						shape: { kind: 'line', a: lerp(a, b, f / n), b: lerp(a, b, (f + m) / n) },
						normal
					});
				}
				first += n;
			});
		} else if (light.kind === 'ring') {
			const n = light.count;
			const { right, up } = planeOf(light.mount);
			const dir = light.clockwise ? 1 : -1;
			for (let f = 0; f < n; f += MAX_PIECE) {
				const m = Math.min(MAX_PIECE, n - f);
				pieces.push({
					light: li,
					from: f,
					count: m,
					before: (f - 1 + n) % n,
					after: (f + m) % n,
					shape: {
						kind: 'arc',
						centre: light.centre,
						radius: light.radius,
						right,
						up,
						angle: light.startAngle * DEG + (dir * TAU * (f - 0.5)) / n,
						sweep: (dir * TAU * m) / n
					},
					normal: mountNormal(light.mount)
				});
			}
		}
	});
	return pieces;
}

export function pointAt(shape: Shape, x: number): Vec3 {
	if (shape.kind === 'line') return lerp(shape.a, shape.b, x);
	const { centre, right, up, radius } = shape;
	const a = shape.angle + shape.sweep * x;
	const u = radius * Math.sin(a);
	const v = radius * Math.cos(a);
	return [
		centre[0] + right[0] * u + up[0] * v,
		centre[1] + right[1] * u + up[1] * v,
		centre[2] + right[2] * u + up[2] * v
	];
}

/** Unit vector along the shape, toward larger x. */
export function tangentAt(shape: Shape, x: number): Vec3 {
	if (shape.kind === 'line') return normalize(sub(shape.b, shape.a));
	const a = shape.angle + shape.sweep * x;
	const s = Math.sign(shape.sweep);
	const c = Math.cos(a) * s;
	const n = -Math.sin(a) * s;
	const { right, up } = shape;
	return [right[0] * c + up[0] * n, right[1] * c + up[1] * n, right[2] * c + up[2] * n];
}

/** Unit vector across the ribbon, in the surface it lies on. */
export function acrossAt(shape: Shape, normal: Vec3, x: number): Vec3 {
	if (shape.kind === 'line') return normalize(cross(normal, sub(shape.b, shape.a)));
	const a = shape.angle + shape.sweep * x;
	const s = Math.sin(a);
	const c = Math.cos(a);
	const { right, up } = shape;
	return [right[0] * s + up[0] * c, right[1] * s + up[1] * c, right[2] * s + up[2] * c];
}

export function lengthOf(shape: Shape): number {
	return shape.kind === 'line'
		? length(sub(shape.b, shape.a))
		: shape.radius * Math.abs(shape.sweep);
}

/** Quads along a piece: one for a line, a whole number per LED round an arc. */
export function stepsOf(piece: StripPiece): number {
	const { shape, count } = piece;
	if (shape.kind === 'line') return 1;
	const turns = Math.abs(shape.sweep) / TAU;
	return count * Math.max(1, Math.ceil((RING_STEPS * turns) / count));
}

/**
 * A flat band along a shape, two vertices per step: at x = j / steps, first `-width / 2` across
 * and then `+width / 2`, lifted `offset` along the normal.
 */
export function bandVertices(
	shape: Shape,
	normal: Vec3,
	width: number,
	offset: number,
	steps: number
): Float32Array {
	const out = new Float32Array((steps + 1) * 6);
	const half = width / 2;
	for (let j = 0; j <= steps; j++) {
		const x = j / steps;
		const c = pointAt(shape, x);
		const w = acrossAt(shape, normal, x);
		for (let d = 0; d < 3; d++) {
			const at = c[d] + normal[d] * offset;
			out[j * 6 + d] = at - w[d] * half;
			out[j * 6 + 3 + d] = at + w[d] * half;
		}
	}
	return out;
}

/** The mount's normal squared to the run, so a sloping run still faces the room flat on. */
function faceOf(mount: Mount, run: Vec3): Vec3 {
	const n = mountNormal(mount);
	const l = length(run);
	if (l === 0) return n;
	const d = scale(run, 1 / l);
	const f = sub(n, scale(d, dot(n, d)));
	return length(f) > 1e-3 ? normalize(f) : perpendicular(d);
}
