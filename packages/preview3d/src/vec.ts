import type { Vec3 } from '@mv/core';

export function add(a: Vec3, b: Vec3): Vec3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
	return [a[0] * k, a[1] * k, a[2] * k];
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a: Vec3): number {
	return Math.hypot(a[0], a[1], a[2]);
}

/** Zero stays zero rather than becoming NaN. */
export function normalize(a: Vec3): Vec3 {
	const l = length(a);
	return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
}

/** A unit vector square to `a`, from the axis it leans on least. */
export function perpendicular(a: Vec3): Vec3 {
	const axis: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	return normalize(sub(axis, scale(a, dot(axis, a))));
}
