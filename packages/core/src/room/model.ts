import type {
	Geometry,
	LampLight,
	Light,
	LightPart,
	LightPixels,
	RoomLayout,
	RoomModel,
	StripSpec,
	Vec3,
	Wall
} from '../contracts/room.ts';
import { ledCount, mountNormal, place, type Placed } from './lights.ts';

const TAU = Math.PI * 2;
const WALLS = ['N', 'E', 'S', 'W'] as const;
/** `Geometry.strip` holds a byte; lights past the last id share it. */
const LAST_STRIP = 255;
/** The spacing assumed where a light names none, as for a lone lamp. */
const FALLBACK_PITCH = 1 / 60;


/** Room coordinates turned so the front wall is south. Quarter turns keep every value exact. */
export function toShowFrame(front: Wall, x: number, y: number): [number, number] {
	switch (front) {
		case 'south':
			return [x, y];
		case 'north':
			return [-x, -y];
		case 'east':
			return [y, -x];
		case 'west':
			return [-y, x];
	}
}

function turn(front: Wall, v: Vec3): Vec3 {
	const [x, y] = toShowFrame(front, v[0], v[1]);
	return [x, y, v[2]];
}

interface Box {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	maxZ: number;
}

function boxOf(points: Iterable<Vec3>): Box {
	const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: -Infinity };
	for (const [x, y, z] of points) {
		if (x < box.minX) box.minX = x;
		if (x > box.maxX) box.maxX = x;
		if (y < box.minY) box.minY = y;
		if (y > box.maxY) box.maxY = y;
		if (z > box.maxZ) box.maxZ = z;
	}
	return box;
}

/** One light, placed and turned into the show frame. */
interface Lit {
	light: Light;
	placed: Placed;
	/** Show-frame position per LED. */
	at: Vec3[];
	/** What bounds its shape: the drawn points of a path, the LEDs of anything else. */
	outline: Vec3[];
	normal: Vec3;
	part: LightPart;
}

/** A ring member's LEDs in ring order, with how far round the room each one is. */
interface Member {
	lit: Lit;
	pixels: number[];
	along: number[];
	length: number;
	closed: boolean;
	start: Vec3;
	end: Vec3;
}

/**
 * Derive the show's geometry and the lights' pixel maps from a layout. A room with no LEDs of its
 * own borrows `stand`'s geometry so its summary lamps still have something to reduce.
 */
export function buildRoomModel(layout: RoomLayout, stand: RoomLayout): RoomModel {
	const lamps = layout.lights.filter(
		(l): l is LampLight => l.kind === 'lamp' && l.mode === 'summary'
	);
	const own = derive(layout);
	if (own) return { layout, ...own, lamps, borrowed: false };
	const borrowed = derive(stand);
	if (!borrowed) throw new Error('the stand-in room has no LEDs');
	return { layout, geometry: borrowed.geometry, pixels: [], lamps, borrowed: true };
}

function derive(layout: RoomLayout): { geometry: Geometry; pixels: LightPixels[] } | null {
	const lit: Lit[] = [];
	for (const light of layout.lights) {
		if (ledCount(light) === 0) continue;
		const placed = place(light);
		const at: Vec3[] = [];
		for (let i = 0; i < placed.position.length; i += 3) {
			at.push(turn(layout.front, [placed.position[i], placed.position[i + 1], placed.position[i + 2]]));
		}
		const outline = light.kind === 'path' ? light.points.map((p) => turn(layout.front, p)) : at;
		const mount = light.kind === 'lamp' ? 'floor' : light.mount;
		lit.push({ light, placed, at, outline, normal: turn(layout.front, mountNormal(mount)), part: 'field' });
	}
	if (lit.length === 0) return null;

	assignParts(lit, layout.front);
	const ringLit = lit.filter((l) => l.part === 'ring');
	const ringBox = boxOf(ringLit.flatMap((l) => ringOutline(l, layout.front)));
	const members = ringMembers(ringLit, ringBox, layout.front);

	const effectIndex = lit.map((l) => new Int32Array(l.at.length).fill(-1));
	const strips: StripSpec[] = [];
	const order: { lit: number; pixel: number; perim: number }[] = [];
	const litIndex = new Map(lit.map((l, i) => [l, i]));

	// The ring, as four walls.
	let perimeterLength = 0;
	if (members.length > 0) {
		const ring: { lit: number; pixel: number; arc: number }[] = [];
		let base = 0;
		members.forEach((m, k) => {
			for (let j = 0; j < m.pixels.length; j++) {
				ring.push({ lit: litIndex.get(m.lit)!, pixel: m.pixels[j], arc: base + m.along[j] });
			}
			base += m.length;
			perimeterLength += m.length;
			const next = members[k + 1];
			if (next) {
				const gap = distance(m.end, next.start);
				base += gap;
				perimeterLength += gap;
			}
		});
		if (members.length > 1) perimeterLength += distance(members[members.length - 1].end, members[0].start);

		const splits = wallSplits(ring.map((p) => lit[p.lit].at[p.pixel]), ringBox);
		const top = ringBox.maxZ;
		const { minX, maxX, minY, maxY } = ringBox;
		const chords: [Vec3, Vec3][] = [
			[[minX, maxY, top], [maxX, maxY, top]],
			[[maxX, maxY, top], [maxX, minY, top]],
			[[maxX, minY, top], [minX, minY, top]],
			[[minX, minY, top], [minX, maxY, top]]
		];
		const name = members.length === 1 ? members[0].lit.light.name : 'Ring';
		for (let w = 0; w < 4; w++) {
			const from = splits[w];
			const to = splits[w + 1];
			strips.push({
				id: w,
				name: `${name} ${WALLS[w]}`,
				offset: order.length + from,
				count: to - from,
				start: chords[w][0],
				end: chords[w][1],
				normal: members[0].lit.normal,
				inPerimeter: true
			});
		}
		// A ring of one point has no length to measure round, so it is walked by count.
		ring.forEach((p, k) => {
			const around = perimeterLength > 0 ? p.arc / perimeterLength : k / ring.length;
			order.push({ lit: p.lit, pixel: p.pixel, perim: around });
		});
	}

	// Then spines and fields, each light in its own data order.
	for (const part of ['spine', 'field'] as const) {
		lit.forEach((l, li) => {
			if (l.part === 'ring' && part === 'field') {
				const walked = new Set(ringPixels(l));
				const rest = l.at.map((_, i) => i).filter((i) => !walked.has(i));
				if (rest.length > 0) addStrip(strips, order, l, li, rest, l.light.name);
				return;
			}
			if (l.part !== part) return;
			addStrip(strips, order, l, li, l.at.map((_, i) => i), l.light.name);
		});
	}
	capStrips(strips, order.length);

	const count = order.length;
	const x = new Float32Array(count);
	const y = new Float32Array(count);
	const z = new Float32Array(count);
	const nx = new Float32Array(count);
	const ny = new Float32Array(count);
	const nz = new Float32Array(count);
	const r = new Float32Array(count);
	const theta = new Float32Array(count);
	const dist = new Float32Array(count);
	const strip = new Uint8Array(count);
	const local = new Float32Array(count);
	const perim = new Float32Array(count).fill(-1);
	const normal = new Float32Array(count * 3);

	const box = boxOf(lit.flatMap((l) => l.outline));
	const width = box.maxX - box.minX;
	const depth = box.maxY - box.minY;
	const cx = (box.minX + box.maxX) / 2;
	const cy = (box.minY + box.maxY) / 2;
	const extent = Math.max(width, depth) || Math.max(box.maxZ, 1);
	const halfDiag = Math.hypot(width / 2, depth / 2) || extent / 2;
	// Head height, so dist differs from radial distance on a flat ceiling.
	const centreZ = box.maxZ / 2;
	const maxDist3 = Math.hypot(halfDiag, centreZ) || 1;

	for (const s of strips) {
		for (let k = 0; k < s.count; k++) {
			const i = s.offset + k;
			const { lit: li, pixel } = order[i];
			const [px, py, pz] = lit[li].at[pixel];
			x[i] = px;
			y[i] = py;
			z[i] = pz;
			nx[i] = (px - box.minX) / extent;
			ny[i] = (py - box.minY) / extent;
			nz[i] = pz / extent;
			const rad = Math.hypot(px - cx, py - cy);
			r[i] = Math.min(rad / halfDiag, 1);
			let th = Math.atan2(py - cy, px - cx) / TAU;
			if (th < 0) th += 1;
			theta[i] = th;
			dist[i] = Math.min(Math.hypot(rad, pz - centreZ) / maxDist3, 1);
			strip[i] = s.id;
			local[i] = (k + 0.5) / s.count;
			if (s.inPerimeter) perim[i] = order[i].perim;
			const n = lit[li].normal;
			normal[i * 3] = n[0];
			normal[i * 3 + 1] = n[1];
			normal[i * 3 + 2] = n[2];
			effectIndex[li][pixel] = i;
		}
	}

	const geometry: Geometry = {
		count,
		strips,
		x,
		y,
		z,
		nx,
		ny,
		nz,
		r,
		theta,
		dist,
		strip,
		local,
		perim,
		normal,
		pitch: pitchOf(members[0]?.lit ?? lit[0]),
		extent,
		perimeterLength,
		spine: lit.some((l) => l.part === 'spine')
	};
	const pixels = lit.map((l, li) => ({
		light: l.light,
		part: l.part,
		index: effectIndex[li],
		position: Float32Array.from(l.placed.position)
	}));
	return { geometry, pixels };
}

/**
 * Decide what each `auto` light is. An explicit ring wins. Otherwise the ring is every closed
 * loop, or failing that every open run and lamp, or failing that every panel's border. A
 * straight run across the middle of a loop is its spine; anything left is a field.
 */
function assignParts(lit: Lit[], front: Wall): void {
	const roleOf = (l: Light) => (l.kind === 'lamp' ? 'auto' : l.role);
	for (const l of lit) {
		const role = roleOf(l.light);
		l.part = role === 'auto' ? 'field' : role;
	}
	const auto = lit.filter((l) => roleOf(l.light) === 'auto');
	let loops = lit.some((l) => l.part === 'ring' && isLoop(l.light));
	const tiers: ((light: Light) => boolean)[] = [
		isLoop,
		(light) => (light.kind === 'path' && !light.closed) || light.kind === 'lamp',
		(light) => light.kind === 'matrix'
	];
	// Every room has a ring. With nothing left to decide, a field or at last a spine becomes it.
	const pools = [auto, lit.filter((l) => l.part === 'field'), lit.filter((l) => l.part === 'spine')];
	for (const pool of pools) {
		if (lit.some((l) => l.part === 'ring')) break;
		for (const tier of tiers) {
			const members = pool.filter((l) => tier(l.light));
			if (members.length === 0) continue;
			for (const l of members) l.part = 'ring';
			loops = tier === isLoop;
			break;
		}
	}
	if (!loops) return;
	const box = boxOf(lit.filter((l) => l.part === 'ring').flatMap((l) => ringOutline(l, front)));
	const [cx, cy] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
	const [hw, hd] = [(box.maxX - box.minX) / 4, (box.maxY - box.minY) / 4];
	for (const l of auto) {
		const light = l.light;
		if (l.part !== 'field' || light.kind !== 'path' || light.closed || light.points.length !== 2) continue;
		const [a, b] = l.outline;
		const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
		if (Math.abs(mx - cx) <= hw && Math.abs(my - cy) <= hd) l.part = 'spine';
	}
}

function isLoop(light: Light): boolean {
	return (light.kind === 'path' && light.closed) || light.kind === 'ring';
}

/** The LEDs a ring light contributes: all of them, or a panel's border. */
function ringPixels(l: Lit): readonly number[] {
	return l.placed.walk.pixels;
}

/** What bounds a light's part of the ring: its walk's turns where it has them, else its LEDs. */
function ringOutline(l: Lit, front: Wall): Vec3[] {
	const corners = l.placed.walk.corners;
	if (l.light.kind === 'path' || (l.light.kind === 'matrix' && corners.length > 0)) {
		return corners.map((c) => turn(front, c.at));
	}
	return ringPixels(l).map((p) => l.at[p]);
}

/**
 * Walk every ring light clockwise, a loop from its corner nearest the north-west, and join them
 * in order round the room from there.
 */
function ringMembers(ring: Lit[], box: Box, front: Wall): Member[] {
	const cx = (box.minX + box.maxX) / 2;
	const cy = (box.minY + box.maxY) / 2;
	const reference = Math.atan2(box.maxY - cy, box.minX - cx);
	/** Radians clockwise from the north-west diagonal, 0..2π. */
	const offset = (p: Vec3): number => {
		let d = (reference - Math.atan2(p[1] - cy, p[0] - cx)) % TAU;
		if (d < 0) d += TAU;
		return d;
	};

	const members = ring.map((lit): Member => {
		const walk = lit.placed.walk;
		let pixels = [...walk.pixels];
		let along = [...walk.along];
		let corners = walk.corners.map((c) => ({ along: c.along, at: turn(front, c.at) }));
		const points = pixels.map((p) => lit.at[p]);
		const outline = corners.length >= 3 ? corners.map((c) => c.at) : points;
		const first = corners[0]?.at ?? points[0];
		const last = corners[corners.length - 1]?.at ?? points[points.length - 1];
		const counterClockwise = walk.closed
			? signedArea(outline) > 0
			: pixels.length > 1 && sweep(first, last, cx, cy) > 0;

		let start = first;
		let end = last;
		if (counterClockwise) {
			const back = (a: number) => (walk.closed ? (a === 0 ? 0 : walk.length - a) : walk.length - a);
			pixels = pixels.reverse();
			along = along.reverse().map(back);
			corners = corners.reverse().map((c) => ({ along: back(c.along), at: c.at }));
			[start, end] = [end, start];
		}

		if (walk.closed) {
			const candidates = corners.length > 0 ? corners : pixels.map((p, k) => ({ along: along[k], at: lit.at[p] }));
			let origin = candidates[0];
			for (const c of candidates) if (offset(c.at) < offset(origin.at)) origin = c;
			const o = origin.along;
			along = along.map((a) => (a >= o ? a - o : a - o + walk.length));
			const sorted = pixels.map((_, k) => k).sort((a, b) => along[a] - along[b] || a - b);
			pixels = sorted.map((k) => pixels[k]);
			along = sorted.map((k) => along[k]);
			start = origin.at;
			end = origin.at;
		}
		return { lit, pixels, along, length: walk.length, closed: walk.closed, start, end };
	});

	return members
		.map((m) => ({ m, key: offset(m.start) }))
		.sort((a, b) => a.key - b.key)
		.map(({ m }) => m);
}

/** Positive when the points run counter-clockwise, seen from above. */
function signedArea(points: readonly Vec3[]): number {
	let sum = 0;
	for (let i = 0; i < points.length; i++) {
		const [x1, y1] = points[i];
		const [x2, y2] = points[(i + 1) % points.length];
		sum += x1 * y2 - x2 * y1;
	}
	return sum / 2;
}

/** Signed angle from `a` to `b` about the centre: positive counter-clockwise. */
function sweep(a: Vec3, b: Vec3, cx: number, cy: number): number {
	let d = Math.atan2(b[1] - cy, b[0] - cx) - Math.atan2(a[1] - cy, a[0] - cx);
	if (d > Math.PI) d -= TAU;
	if (d <= -Math.PI) d += TAU;
	return d;
}

/**
 * Where the ring turns from one wall to the next: at the diagonals through the corners of its
 * box. A ring that never reaches some wall, like a single strip, is cut into even quarters.
 */
function wallSplits(points: readonly Vec3[], box: Box): number[] {
	const n = points.length;
	const cx = (box.minX + box.maxX) / 2;
	const cy = (box.minY + box.maxY) / 2;
	const reference = Math.atan2(box.maxY - cy, box.minX - cx);
	const offset = (px: number, py: number): number => {
		let d = (reference - Math.atan2(py - cy, px - cx)) % TAU;
		if (d < 0) d += TAU;
		return d;
	};
	const turns = [offset(box.maxX, box.maxY), offset(box.maxX, box.minY), offset(box.minX, box.minY)];
	const splits = [0];
	let i = 0;
	for (const t of turns) {
		while (i < n && offset(points[i][0], points[i][1]) < t) i++;
		splits.push(i);
	}
	splits.push(n);
	const even = splits.every((s, k) => k === 0 || s > splits[k - 1]);
	return even ? splits : [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n];
}

function addStrip(
	strips: StripSpec[],
	order: { lit: number; pixel: number; perim: number }[],
	l: Lit,
	li: number,
	pixels: readonly number[],
	name: string
): void {
	const light = l.light;
	const ends =
		light.kind === 'path' && pixels.length === l.at.length
			? [l.outline[0], l.outline[l.outline.length - 1]]
			: [l.at[pixels[0]], l.at[pixels[pixels.length - 1]]];
	strips.push({
		id: strips.length,
		name,
		offset: order.length,
		count: pixels.length,
		start: ends[0],
		end: ends[1],
		normal: l.normal,
		inPerimeter: false
	});
	for (const pixel of pixels) order.push({ lit: li, pixel, perim: -1 });
}

/** Past the last strip id, every remaining light shares one strip. */
function capStrips(strips: StripSpec[], count: number): void {
	if (strips.length <= LAST_STRIP + 1) return;
	const last = strips[LAST_STRIP];
	strips.length = LAST_STRIP + 1;
	strips[LAST_STRIP] = { ...last, name: 'Other lights', count: count - last.offset };
}

function pitchOf(l: Lit): number {
	const light = l.light;
	switch (light.kind) {
		case 'path':
			return 1 / light.density;
		case 'ring':
			return (TAU * light.radius) / light.count;
		case 'matrix':
			return light.columns > 1 ? light.width / (light.columns - 1) : FALLBACK_PITCH;
		case 'lamp':
			return FALLBACK_PITCH;
	}
}

function distance(a: Vec3, b: Vec3): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
