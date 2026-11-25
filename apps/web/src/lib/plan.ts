import {
	matrixOrder,
	planeOf,
	type Light,
	type MatrixLight,
	type Mount,
	type RingLight,
	type RoomLayout,
	type Vec3,
	type Wall
} from '@mv/core';

/** The floor plan from above, or one wall seen from inside the room. */
export type PlanView = 'top' | Wall;

export interface Axes {
	right: Vec3;
	up: Vec3;
}

/** A point on the plan: metres along the view's right and up. */
export type Uv = readonly [number, number];

/** The room as a view frames it. */
export interface Frame {
	u0: number;
	u1: number;
	v0: number;
	v1: number;
}

const DEG = Math.PI / 180;
/** Where a light fixed to a surface sits off it, metres. */
export const STANDOFF = 0.02;

export function axesOf(view: PlanView): Axes {
	return view === 'top' ? { right: [1, 0, 0], up: [0, 1, 0] } : planeOf(view);
}

export function project(p: Vec3, axes: Axes): Uv {
	return [dot(p, axes.right), dot(p, axes.up)];
}

/** The room move that shifts a point by (du, dv) on the plan. */
export function lift(du: number, dv: number, axes: Axes): Vec3 {
	const { right: r, up: u } = axes;
	return [r[0] * du + u[0] * dv, r[1] * du + u[1] * dv, r[2] * du + u[2] * dv];
}

/** A point of the plan placed in the room, keeping the depth `from` already has. */
export function place(uv: Uv, from: Vec3, axes: Axes): Vec3 {
	const [u0, v0] = project(from, axes);
	const d = lift(uv[0] - u0, uv[1] - v0, axes);
	return [from[0] + d[0], from[1] + d[1], from[2] + d[2]];
}

export function frameOf(view: PlanView, layout: RoomLayout): Frame {
	const hw = layout.width / 2;
	const hd = layout.depth / 2;
	if (view === 'top') return { u0: -hw, u1: hw, v0: -hd, v1: hd };
	const half = view === 'north' || view === 'south' ? hw : hd;
	return { u0: -half, u1: half, v0: 0, v1: layout.height };
}

/** Where a new light drawn in this view goes: under the ceiling, or on the wall. */
export function surfaceOf(view: PlanView, layout: RoomLayout): { mount: Mount; anchor: Vec3 } {
	const hw = layout.width / 2 - STANDOFF;
	const hd = layout.depth / 2 - STANDOFF;
	switch (view) {
		case 'top':
			return { mount: 'ceiling', anchor: [0, 0, ceilingHeight(layout)] };
		case 'north':
			return { mount: 'north', anchor: [0, hd, 0] };
		case 'south':
			return { mount: 'south', anchor: [0, -hd, 0] };
		case 'east':
			return { mount: 'east', anchor: [hw, 0, 0] };
		case 'west':
			return { mount: 'west', anchor: [-hw, 0, 0] };
	}
}

/** Where ceiling lights hang: a little below it, as the Frame does. */
export function ceilingHeight(layout: RoomLayout): number {
	return Math.max(0.3, Math.round((layout.height - 0.2) * 100) / 100);
}

/** A ring or panel moved onto the surface it is now mounted on. */
export function onSurface(centre: Vec3, mount: Mount, layout: RoomLayout): Vec3 {
	const [x, y, z] = centre;
	const hw = layout.width / 2 - STANDOFF;
	const hd = layout.depth / 2 - STANDOFF;
	switch (mount) {
		case 'ceiling':
			return [x, y, layout.height - STANDOFF];
		case 'floor':
			return [x, y, STANDOFF];
		case 'north':
			return [x, hd, z];
		case 'south':
			return [x, -hd, z];
		case 'east':
			return [hw, y, z];
		case 'west':
			return [-hw, y, z];
	}
}

/** Whether a view looks straight at a mount, so shapes on it show their true size. */
export function faces(view: PlanView, mount: Mount): boolean {
	return view === 'top' ? mount === 'ceiling' || mount === 'floor' : view === mount;
}

/** In a wall view only what is on that wall, the ceiling or the floor can be picked up. */
export function reachable(view: PlanView, light: Light): boolean {
	if (view === 'top') return true;
	const mount = light.kind === 'lamp' ? 'floor' : light.mount;
	return mount === view || mount === 'ceiling' || mount === 'floor';
}

/** A ring's point `degrees` round from its first LED, the way `placeRing` in core walks it. */
export function ringAt(light: RingLight, degrees: number): Vec3 {
	const { right, up } = planeOf(light.mount);
	const a = light.startAngle * DEG + (light.clockwise ? 1 : -1) * degrees * DEG;
	const u = light.radius * Math.sin(a);
	const v = light.radius * Math.cos(a);
	const c = light.centre;
	return [c[0] + right[0] * u + up[0] * v, c[1] + right[1] * u + up[1] * v, c[2] + right[2] * u + up[2] * v];
}

export function ringOutline(light: RingLight, segments = 72): Vec3[] {
	return Array.from({ length: segments }, (_, i) => ringAt(light, (360 * i) / segments));
}

/** A panel's outer LED centres, clockwise from its top left as seen facing it. */
export function panelCorners(light: MatrixLight): [Vec3, Vec3, Vec3, Vec3] {
	const { right, up } = planeOf(light.mount);
	const at = (su: number, sv: number): Vec3 => {
		const u = (su * light.width) / 2;
		const v = (sv * light.height) / 2;
		const c = light.centre;
		return [c[0] + right[0] * u + up[0] * v, c[1] + right[1] * u + up[1] * v, c[2] + right[2] * u + up[2] * v];
	};
	return [at(-1, 1), at(1, 1), at(1, -1), at(-1, -1)];
}

/** One LED of a panel, by column and row from its top left. */
export function panelCell(light: MatrixLight, column: number, row: number): Vec3 {
	const { right, up } = planeOf(light.mount);
	const u = light.columns > 1 ? (column / (light.columns - 1) - 0.5) * light.width : 0;
	const v = light.rows > 1 ? (0.5 - row / (light.rows - 1)) * light.height : 0;
	const c = light.centre;
	return [c[0] + right[0] * u + up[0] * v, c[1] + right[1] * u + up[1] * v, c[2] + right[2] * u + up[2] * v];
}

/**
 * Where the data enters a light and which way it heads from there, as two room points. A light
 * wired `reversed` is entered at its far end and walked back.
 */
export function dataEntry(light: Light): [Vec3, Vec3] | null {
	const reversed = light.wiring?.reversed === true;
	switch (light.kind) {
		case 'path': {
			const { points, counts } = light;
			if (!reversed) return [ledOnRun(points, 0, counts[0], 0), ledOnRun(points, 0, counts[0], 1)];
			const last = counts.length - 1;
			const n = counts[last];
			return [ledOnRun(points, last, n, n - 1), n > 1 ? ledOnRun(points, last, n, n - 2) : points[last]];
		}
		case 'ring': {
			const step = 360 / Math.max(1, light.count);
			return reversed
				? [ringAt(light, -step), ringAt(light, -2 * step)]
				: [ringAt(light, 0), ringAt(light, step)];
		}
		case 'matrix': {
			const order = matrixOrder(light);
			if (order.length < 2) return null;
			const [a, b] = reversed ? [order[order.length - 1], order[order.length - 2]] : [order[0], order[1]];
			return [panelCell(light, a[0], a[1]), panelCell(light, b[0], b[1])];
		}
		case 'lamp':
			return null;
	}
}

/** LED k of n on a run of a path, as `placePath` in core puts it. */
function ledOnRun(points: readonly Vec3[], run: number, n: number, k: number): Vec3 {
	const a = points[run];
	const b = points[(run + 1) % points.length];
	const t = (k + 0.5) / Math.max(1, n);
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface Snap {
	value: number;
	/** The line it snapped to, drawn as a guide; null when it only met the grid. */
	guide: number | null;
}

/** Onto the nearest guide within `tolerance`, or else onto the grid. */
export function snap(value: number, guides: readonly number[], tolerance: number, grid: number): Snap {
	let best: number | null = null;
	for (const g of guides) {
		if (Math.abs(g - value) <= tolerance && (best === null || Math.abs(g - value) < Math.abs(best - value))) best = g;
	}
	if (best !== null) return { value: best, guide: best };
	return { value: grid > 0 ? Math.round(value / grid) * grid : value, guide: null };
}

/** Grid spacing, metres, that keeps lines at least `minPx` apart at this scale. */
export function gridStep(pxPerMetre: number, minPx = 18): number {
	for (const step of [0.1, 0.25, 0.5, 1, 2, 5]) if (step * pxPerMetre >= minPx) return step;
	return 10;
}

/** Distance from a plan point to a segment, and how far along it the nearest point lies. */
export function nearestOnSegment(p: Uv, a: Uv, b: Uv): { distance: number; t: number } {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const length2 = dx * dx + dy * dy;
	const t = length2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
	return { distance: Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)), t };
}

function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
