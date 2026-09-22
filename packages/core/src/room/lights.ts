import type { Light, MatrixLight, Mount, RingLight, Vec3, Wall } from '../contracts/room.ts';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** The LEDs of a light that can join the ring, in the order they are walked. */
export interface Walk {
	/** Indices into the light's LEDs. */
	pixels: readonly number[];
	/** Metres from the start of the walk to each of those LEDs. */
	along: readonly number[];
	/** Metres of the whole walk: around the loop when closed. */
	length: number;
	closed: boolean;
	/** Where the walk turns; a loop starts its ring on one. */
	corners: readonly { along: number; at: Vec3 }[];
}

/** A light's LEDs in the order its data runs, in room coordinates. */
export interface Placed {
	/** 3 per LED. Plain numbers, so derived values keep full precision until they are stored. */
	position: Float64Array;
	walk: Walk;
}

/** How many LEDs of a light the show paints. A summary lamp has none. */
export function ledCount(light: Light): number {
	switch (light.kind) {
		case 'path':
			return light.counts.reduce((n, c) => n + c, 0);
		case 'ring':
			return light.count;
		case 'matrix':
			return light.columns * light.rows;
		case 'lamp':
			return light.mode === 'pixel' ? 1 : 0;
	}
}

/** Unit vector a mounted light faces, into the room. */
export function mountNormal(mount: Mount): Vec3 {
	switch (mount) {
		case 'ceiling':
			return [0, 0, -1];
		case 'floor':
			return [0, 0, 1];
		case 'north':
			return [0, -1, 0];
		case 'east':
			return [-1, 0, 0];
		case 'south':
			return [0, 1, 0];
		case 'west':
			return [1, 0, 0];
	}
}

/**
 * The plane a ring or panel lies in: right and up as seen on the floor plan for the ceiling and
 * floor, and from inside the room for a wall.
 */
export function planeOf(mount: Mount): { right: Vec3; up: Vec3 } {
	if (mount === 'ceiling' || mount === 'floor') return { right: [1, 0, 0], up: [0, 1, 0] };
	const right: Record<Wall, Vec3> = {
		north: [1, 0, 0],
		east: [0, -1, 0],
		south: [-1, 0, 0],
		west: [0, 1, 0]
	};
	return { right: right[mount], up: [0, 0, 1] };
}

export function place(light: Light): Placed {
	switch (light.kind) {
		case 'path':
			return placePath(light.points, light.counts, light.closed);
		case 'ring':
			return placeRing(light);
		case 'matrix':
			return placeMatrix(light);
		case 'lamp': {
			const top: Vec3 = [light.at[0], light.at[1], light.at[2] + light.height];
			const lit = light.mode === 'pixel';
			return {
				position: Float64Array.from(lit ? top : []),
				walk: { pixels: lit ? [0] : [], along: lit ? [0] : [], length: 0, closed: false, corners: [{ along: 0, at: top }] }
			};
		}
	}
}

/** LED k of n sits at (k + 0.5) / n along its run, so two runs meeting at a corner never double up. */
function placePath(points: readonly Vec3[], counts: readonly number[], closed: boolean): Placed {
	const total = counts.reduce((n, c) => n + c, 0);
	const position = new Float64Array(total * 3);
	const along: number[] = [];
	const corners: { along: number; at: Vec3 }[] = [];
	let walked = 0;
	let i = 0;
	for (let run = 0; run < counts.length; run++) {
		const [sx, sy, sz] = points[run];
		const [ex, ey, ez] = points[(run + 1) % points.length];
		const len = Math.hypot(ex - sx, ey - sy, ez - sz);
		corners.push({ along: walked, at: points[run] });
		const n = counts[run];
		for (let k = 0; k < n; k++, i++) {
			const u = (k + 0.5) / n;
			position[i * 3] = sx + (ex - sx) * u;
			position[i * 3 + 1] = sy + (ey - sy) * u;
			position[i * 3 + 2] = sz + (ez - sz) * u;
			along.push(walked + u * len);
		}
		walked += len;
	}
	if (!closed) corners.push({ along: walked, at: points[points.length - 1] });
	return {
		position,
		walk: { pixels: along.map((_, k) => k), along, length: walked, closed, corners }
	};
}

function placeRing(light: RingLight): Placed {
	const { right, up } = planeOf(light.mount);
	const n = light.count;
	const position = new Float64Array(n * 3);
	const along: number[] = [];
	const step = light.clockwise ? 1 : -1;
	for (let i = 0; i < n; i++) {
		const a = light.startAngle * DEG + (step * TAU * i) / n;
		const u = light.radius * Math.sin(a);
		const v = light.radius * Math.cos(a);
		for (let d = 0; d < 3; d++) position[i * 3 + d] = light.centre[d] + right[d] * u + up[d] * v;
		along.push((TAU * light.radius * i) / n);
	}
	return {
		position,
		walk: { pixels: along.map((_, k) => k), along, length: TAU * light.radius, closed: true, corners: [] }
	};
}

/** A panel joins a ring by its outer LEDs, walked clockwise as seen from its top left. */
function placeMatrix(light: MatrixLight): Placed {
	const { columns, rows } = light;
	const { right, up } = planeOf(light.mount);
	const cell = (c: number, r: number): Vec3 => {
		const u = columns > 1 ? (c / (columns - 1) - 0.5) * light.width : 0;
		const v = rows > 1 ? (0.5 - r / (rows - 1)) * light.height : 0;
		return [
			light.centre[0] + right[0] * u + up[0] * v,
			light.centre[1] + right[1] * u + up[1] * v,
			light.centre[2] + right[2] * u + up[2] * v
		];
	};

	const order = matrixOrder(light);
	const position = new Float64Array(order.length * 3);
	const indexOf = new Map<number, number>();
	order.forEach(([c, r], i) => {
		position.set(cell(c, r), i * 3);
		indexOf.set(r * columns + c, i);
	});

	const border: [number, number][] = [];
	for (let c = 0; c < columns; c++) border.push([c, 0]);
	for (let r = 1; r < rows; r++) border.push([columns - 1, r]);
	if (rows > 1) for (let c = columns - 2; c >= 0; c--) border.push([c, rows - 1]);
	if (columns > 1) for (let r = rows - 2; r >= 1; r--) border.push([0, r]);

	const closed = rows > 1 && columns > 1;
	const along: number[] = [];
	let walked = 0;
	border.forEach(([c, r], k) => {
		if (k > 0) walked += distance(cell(...border[k - 1]), cell(c, r));
		along.push(walked);
	});
	const length = closed ? walked + distance(cell(...border[border.length - 1]), cell(0, 0)) : walked;
	const turns: [number, number][] = [
		[0, 0],
		[columns - 1, 0],
		[columns - 1, rows - 1],
		[0, rows - 1]
	];
	const corners = closed
		? turns.map(([c, r]) => ({
				along: along[border.findIndex(([bc, br]) => bc === c && br === r)],
				at: cell(c, r)
			}))
		: [];

	return {
		position,
		walk: {
			pixels: border.map(([c, r]) => indexOf.get(r * columns + c)!),
			along,
			length,
			closed,
			corners
		}
	};
}

/** Grid cells as [column, row] in the order the data visits them. */
export function matrixOrder(light: MatrixLight): [number, number][] {
	const { columns, rows, horizontal, serpentine } = light;
	const top = light.first.startsWith('top');
	const left = light.first.endsWith('left');
	const lines = horizontal ? rows : columns;
	const length = horizontal ? columns : rows;
	const out: [number, number][] = [];
	for (let line = 0; line < lines; line++) {
		for (let step = 0; step < length; step++) {
			const pos = serpentine && line % 2 === 1 ? length - 1 - step : step;
			if (horizontal) out.push([left ? pos : columns - 1 - pos, top ? line : rows - 1 - line]);
			else out.push([left ? line : columns - 1 - line, top ? pos : rows - 1 - pos]);
		}
	}
	return out;
}

function distance(a: Vec3, b: Vec3): number {
	return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
