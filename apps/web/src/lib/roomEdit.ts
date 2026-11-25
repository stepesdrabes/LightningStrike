import { MAX_RUN, type Light, type Mount, type PathLight, type RoomLayout, type Vec3 } from '@mv/core';
import { freshId, type Controller, type Room } from './rooms.ts';
import type { Found } from './controllers.ts';
import { ceilingHeight, onSurface, STANDOFF } from './plan.ts';
import { extentOf, spansOf } from './wiring.ts';

/** Where a light sits on the floor plan, for snapping and for keeping it inside the room. */
export function plan(light: Light): Vec3[] {
	switch (light.kind) {
		case 'path':
			return [...light.points];
		case 'ring':
		case 'matrix':
			return [light.centre];
		case 'lamp':
			return [light.at];
	}
}

/** The same light, every point of it shifted. */
export function translate(light: Light, dx: number, dy: number, dz = 0): Light {
	const move = (p: Vec3): Vec3 => [round(p[0] + dx), round(p[1] + dy), round(p[2] + dz)];
	switch (light.kind) {
		case 'path':
			return { ...light, points: light.points.map(move) };
		case 'ring':
		case 'matrix':
			return { ...light, centre: move(light.centre) };
		case 'lamp':
			return { ...light, at: move(light.at) };
	}
}

/** Keep a light's points inside the room, shifting it as a whole so its shape holds. */
export function keepInside(light: Light, width: number, depth: number, height: number): Light {
	const points = plan(light);
	const hw = width / 2;
	const hd = depth / 2;
	const push = (lo: number, hi: number, min: number, max: number) =>
		lo < min ? min - lo : hi > max ? max - hi : 0;
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	const zs = points.map((p) => p[2]);
	const dx = push(Math.min(...xs), Math.max(...xs), -hw, hw);
	const dy = push(Math.min(...ys), Math.max(...ys), -hd, hd);
	const dz = push(Math.min(...zs), Math.max(...zs), 0, height);
	return dx || dy || dz ? translate(light, dx, dy, dz) : light;
}

/**
 * Move one point of a path. The runs either side of it keep their LED density, which is what a
 * strip cut to a new length does.
 */
export function movePoint(light: PathLight, index: number, to: Vec3): PathLight {
	const points = light.points.map((p, i) => (i === index ? to.map(round) : p) as Vec3);
	const counts = [...light.counts];
	const runs = light.closed ? points.length : points.length - 1;
	for (const run of [index - 1, index]) {
		const r = light.closed ? (run + runs) % runs : run;
		if (r < 0 || r >= runs) continue;
		counts[r] = ledsAlong(points[r], points[(r + 1) % points.length], light.density);
	}
	return { ...light, points, counts };
}

/** LEDs that fit along a run at a density, at least one. */
export function ledsAlong(a: Vec3, b: Vec3, density: number): number {
	const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
	return Math.min(MAX_RUN, Math.max(1, Math.round(length * density)));
}

export function runLength(light: PathLight, run: number): number {
	const a = light.points[run];
	const b = light.points[(run + 1) % light.points.length];
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

/** Every run given the LEDs its length holds at the strip's density. */
export function refit(light: PathLight): PathLight {
	const runs = light.closed ? light.points.length : light.points.length - 1;
	const counts = Array.from({ length: runs }, (_, r) =>
		ledsAlong(light.points[r], light.points[(r + 1) % light.points.length], light.density)
	);
	return { ...light, counts };
}

/** A point added `t` of the way along a run, splitting its LEDs between the two halves. */
export function splitRun(light: PathLight, run: number, t = 0.5): PathLight {
	const a = light.points[run];
	const b = light.points[(run + 1) % light.points.length];
	const at: Vec3 = [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t), round(a[2] + (b[2] - a[2]) * t)];
	const leds = light.counts[run];
	const first = Math.min(Math.max(1, leds - 1), Math.max(1, Math.round(leds * t)));
	return {
		...light,
		points: [...light.points.slice(0, run + 1), at, ...light.points.slice(run + 1)],
		counts: [...light.counts.slice(0, run), first, Math.max(1, leds - first), ...light.counts.slice(run + 1)]
	};
}

/** A path keeps two points, and a loop three. The runs either side of the point become one. */
export function removePoint(light: PathLight, index: number): PathLight {
	const min = light.closed ? 3 : 2;
	if (light.points.length <= min) return light;
	return refit({ ...light, points: light.points.filter((_, i) => i !== index) });
}

/** Open a loop at its last run, or close a path back to its first point. */
export function setClosed(light: PathLight, closed: boolean): PathLight {
	if (closed === light.closed || (closed && light.points.length < 3)) return light;
	const counts = closed
		? [...light.counts, ledsAlong(light.points[light.points.length - 1], light.points[0], light.density)]
		: light.counts.slice(0, -1);
	return { ...light, closed, counts };
}

/** Mount a light elsewhere. A ring or panel moves onto the new surface; a path only turns to face. */
export function remount(light: Light, mount: Mount, layout: RoomLayout): Light {
	if (light.kind === 'lamp') return light;
	if (light.kind === 'path') return { ...light, mount };
	return { ...light, mount, centre: onSurface(light.centre, mount, layout).map(round) as unknown as Vec3 };
}

/** The first controller pixel after every light already wired to it. */
export function nextFreePixel(room: Room, controllerId: string, except?: string): number {
	return extentOf(spansOf(room, controllerId).filter((s) => s.light.id !== except));
}

export function withLight(room: Room, light: Light): Room {
	const known = room.layout.lights.some((l) => l.id === light.id);
	const lights = known ? room.layout.lights.map((l) => (l.id === light.id ? light : l)) : [...room.layout.lights, light];
	return { ...room, layout: { ...room.layout, lights } };
}

export function withoutLight(room: Room, id: string): Room {
	return { ...room, layout: { ...room.layout, lights: room.layout.lights.filter((l) => l.id !== id) } };
}

export function withController(room: Room, controller: Controller): Room {
	const known = room.controllers.some((c) => c.id === controller.id);
	const controllers = known
		? room.controllers.map((c) => (c.id === controller.id ? controller : c))
		: [...room.controllers, controller];
	return { ...room, controllers };
}

/** Its lights stay, unwired, so they still play in the preview. */
export function withoutController(room: Room, id: string): Room {
	const lights = room.layout.lights.map((l) => {
		if (l.wiring?.controller !== id) return l;
		const { wiring: _, ...rest } = l;
		return rest as Light;
	});
	return { ...room, controllers: room.controllers.filter((c) => c.id !== id), layout: { ...room.layout, lights } };
}

/** Wire a light to a controller after whatever it already carries, or unwire it with null. */
export function wire(room: Room, lightId: string, controllerId: string | null): Room {
	const light = room.layout.lights.find((l) => l.id === lightId);
	if (!light) return room;
	if (controllerId === null) {
		const { wiring: _, ...rest } = light;
		return withLight(room, rest as Light);
	}
	if (light.wiring?.controller === controllerId) return room;
	const start = nextFreePixel(room, controllerId, lightId);
	return withLight(room, { ...light, wiring: { controller: controllerId, start } });
}

/**
 * A copy of a light beside the original, unwired, since it cannot share the original's pixels:
 * the room with it, and its id.
 */
export function withCopy(room: Room, lightId: string): { room: Room; id: string } | null {
	const { lights, width, depth, height } = room.layout;
	const light = lights.find((l) => l.id === lightId);
	if (!light) return null;
	const { wiring: _, ...rest } = light;
	const id = freshId(light.id, lights.map((l) => l.id));
	const name = freshName(light.name, lights.map((l) => l.name));
	const copy = keepInside(translate({ ...(rest as Light), id, name }, 0.2, -0.2), width, depth, height);
	return { room: withLight(room, copy), id };
}

/** A name no other item in `taken` has: `base`, then `base 2`, `base 3`. */
export function freshName(base: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** The controller of this room a found one already is, by its address or its hardware. */
export function foundIn(room: Room, found: Found): Controller | undefined {
	return room.controllers.find((c) => c.host === found.host || (found.mac !== undefined && c.mac === found.mac));
}

/**
 * Controllers of the found one's kind still waiting for an address, the likeliest first: one sent
 * as many pixels as it drives, then one its name mentions.
 */
export function waitingFor(room: Room, found: Found): Controller[] {
	const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
	const score = (c: Controller) =>
		(found.pixels !== undefined && extentOf(spansOf(room, c.id)) === found.pixels ? 2 : 0) +
		(words(found.name).includes(words(c.name)) || words(found.name).includes(c.id) ? 1 : 0);
	return room.controllers.filter((c) => c.kind === found.kind && !c.host).sort((a, b) => score(b) - score(a));
}

/** LEDs a metre on the strips a found controller most likely drives. */
const FOUND_DENSITY = 60;
/** Metres between LEDs on the matrix panels WLED is usually set up for. */
const FOUND_PITCH = 0.01;

/**
 * A light shaped like what a found controller drives, so it plays as soon as it is added: a
 * panel on the front wall for a 2D setup, a loop under the ceiling for a strip long enough to go
 * round, or else a strip along the front wall.
 */
export function lightFor(found: Found, layout: RoomLayout, id: string, name: string): Light | null {
	const pixels = found.pixels ?? 0;
	if (pixels < 1) return null;
	const front = layout.front;
	if (found.matrix && found.matrix.width * found.matrix.height <= pixels) {
		const { width: columns, height: rows } = found.matrix;
		const centre = onSurface([0, 0, Math.min(1.5, layout.height / 2)], front, layout);
		return {
			id,
			name,
			kind: 'matrix',
			centre: centre.map(round) as unknown as Vec3,
			width: round(Math.max(0.05, (columns - 1) * FOUND_PITCH)),
			height: round(Math.max(0.05, (rows - 1) * FOUND_PITCH)),
			columns,
			rows,
			mount: front,
			first: 'top-left',
			horizontal: true,
			serpentine: false,
			role: 'auto'
		};
	}

	const z = ceilingHeight(layout);
	const length = pixels / FOUND_DENSITY;
	const hw = layout.width / 2 - STANDOFF * 5;
	const hd = layout.depth / 2 - STANDOFF * 5;
	if (length >= 4 * (hw + hd) * 0.8) {
		const points: Vec3[] = [
			[-hw, hd, z],
			[hw, hd, z],
			[hw, -hd, z],
			[-hw, -hd, z]
		].map((p) => p.map(round) as unknown as Vec3);
		const sides = [2 * hw, 2 * hd, 2 * hw, 2 * hd];
		const counts = shares(pixels, sides);
		return { id, name, kind: 'path', points, counts, closed: true, density: FOUND_DENSITY, mount: 'ceiling', role: 'auto' };
	}

	const along = front === 'north' || front === 'south' ? hw : hd;
	const half = Math.min(length / 2, along);
	const ends: [Vec3, Vec3] = {
		north: [[-half, hd, z], [half, hd, z]] as [Vec3, Vec3],
		south: [[half, -hd, z], [-half, -hd, z]] as [Vec3, Vec3],
		east: [[hw, half, z], [hw, -half, z]] as [Vec3, Vec3],
		west: [[-hw, -half, z], [-hw, half, z]] as [Vec3, Vec3]
	}[front];
	return {
		id,
		name,
		kind: 'path',
		points: ends.map((p) => p.map(round) as unknown as Vec3),
		counts: [Math.min(MAX_RUN, pixels)],
		closed: false,
		density: FOUND_DENSITY,
		mount: 'ceiling',
		role: 'auto'
	};
}

/** `total` split in proportion to `weights`, every share at least one, summing exactly. */
function shares(total: number, weights: readonly number[]): number[] {
	const sum = weights.reduce((a, b) => a + b, 0);
	const out = weights.map((w) => Math.max(1, Math.floor((total * w) / sum)));
	let left = total - out.reduce((a, b) => a + b, 0);
	for (let i = 0; left > 0; i = (i + 1) % out.length, left--) out[i]++;
	return out.map((n) => Math.min(MAX_RUN, n));
}

/** Millimetres are as fine as a hand places a light. */
export function round(v: number): number {
	return Math.round(v * 1000) / 1000;
}
