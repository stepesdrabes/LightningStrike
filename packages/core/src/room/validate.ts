import type {
	Corner,
	LampLight,
	Light,
	LightRole,
	MatrixLight,
	Mount,
	PathLight,
	RingLight,
	RoomLayout,
	Vec3,
	Wall,
	Wiring
} from '../contracts/room.ts';
import { ledCount } from './lights.ts';

/** `ringsFor` maps ring positions through a Uint16Array. */
export const MAX_LEDS = 65535;
export const MAX_RUN = 10000;
const MAX_GRID = 256;
const FAR = 200;
const NAME_MAX = 60;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const WALLS: readonly Wall[] = ['north', 'east', 'south', 'west'];
const MOUNTS: readonly Mount[] = ['ceiling', 'floor', ...WALLS];
const ROLES: readonly LightRole[] = ['auto', 'ring', 'spine', 'field'];
const CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

type Fields = Record<string, unknown>;

/** Read a layout from a file or a request: the layout, or every problem with it in words. */
export function readLayout(value: unknown): { layout: RoomLayout } | { problems: string[] } {
	const problems: string[] = [];
	const o = object(value);
	if (!o) return { problems: ['A room layout has to be an object.'] };

	const width = metres(o.width, 0.5, 100, 'The room width', problems);
	const depth = metres(o.depth, 0.5, 100, 'The room depth', problems);
	const height = metres(o.height, 0.5, 20, 'The room height', problems);
	const front = WALLS.includes(o.front as Wall) ? (o.front as Wall) : null;
	if (!front) problems.push('The front has to be one of the four walls.');

	const lights: Light[] = [];
	const ids = new Set<string>();
	if (!Array.isArray(o.lights)) problems.push('The room needs a list of lights, even an empty one.');
	for (const [i, raw] of (Array.isArray(o.lights) ? o.lights : []).entries()) {
		const light = readLight(raw, `Light ${i + 1}`, problems);
		const id = object(raw)?.id;
		if (typeof id === 'string' && ids.has(id)) problems.push(`Two lights share the id "${id}".`);
		if (typeof id === 'string') ids.add(id);
		if (light) lights.push(light);
	}
	const total = lights.reduce((n, l) => n + ledCount(l), 0);
	if (total > MAX_LEDS) problems.push(`A room can hold ${MAX_LEDS} LEDs; this one has ${total}.`);

	if (problems.length > 0 || width === null || depth === null || height === null || !front) {
		return { problems };
	}
	return { layout: { width, depth, height, front, lights } };
}

function readLight(value: unknown, label: string, problems: string[]): Light | null {
	const o = object(value);
	if (!o) {
		problems.push(`${label} has to be an object.`);
		return null;
	}
	const before = problems.length;
	const name = typeof o.name === 'string' ? o.name.trim().slice(0, NAME_MAX) : '';
	const called = name ? `"${name}"` : label;
	if (typeof o.id !== 'string' || !ID.test(o.id)) problems.push(`${called} needs a short id of letters, digits, - or _.`);
	if (!name) problems.push(`${label} needs a name.`);
	const wiring = o.wiring === undefined ? undefined : readWiring(o.wiring, called, problems);
	const level = o.level === undefined ? undefined : fraction(o.level, `${called}'s level`, problems);
	const base = {
		id: o.id as string,
		name,
		...(wiring ? { wiring } : {}),
		...(level !== undefined && level !== null ? { level } : {})
	};

	let light: Light | null = null;
	switch (o.kind) {
		case 'path': {
			const points = Array.isArray(o.points) ? o.points.map((p) => point(p)) : [];
			const closed = o.closed === true;
			if (points.length < 2 || points.some((p) => p === null)) {
				problems.push(`${called} needs at least two points in metres.`);
			}
			const runs = closed ? points.length : points.length - 1;
			const counts = Array.isArray(o.counts) ? o.counts : [];
			if (counts.length !== runs || !counts.every((c) => isCount(c, MAX_RUN))) {
				problems.push(`${called} needs an LED count for each of its ${runs} runs, from 1 to ${MAX_RUN}.`);
			}
			const density = typeof o.density === 'number' && o.density >= 1 && o.density <= 1000 ? o.density : null;
			if (density === null) problems.push(`${called} needs its LEDs per metre, from 1 to 1000.`);
			light = {
				...base,
				kind: 'path',
				points: points as Vec3[],
				counts: counts as number[],
				closed,
				density: density ?? 60,
				mount: mount(o.mount, called, problems),
				role: role(o.role, called, problems)
			} satisfies PathLight;
			break;
		}
		case 'ring': {
			const centre = point(o.centre);
			if (!centre) problems.push(`${called} needs a centre in metres.`);
			const radius = metres(o.radius, 0.01, 50, `${called}'s radius`, problems);
			if (!isCount(o.count, MAX_RUN)) problems.push(`${called} needs from 1 to ${MAX_RUN} LEDs.`);
			const startAngle = typeof o.startAngle === 'number' && Number.isFinite(o.startAngle) ? o.startAngle % 360 : 0;
			light = {
				...base,
				kind: 'ring',
				centre: centre ?? [0, 0, 0],
				radius: radius ?? 1,
				count: o.count as number,
				startAngle,
				clockwise: o.clockwise !== false,
				mount: mount(o.mount, called, problems),
				role: role(o.role, called, problems)
			} satisfies RingLight;
			break;
		}
		case 'matrix': {
			const centre = point(o.centre);
			if (!centre) problems.push(`${called} needs a centre in metres.`);
			if (!isCount(o.columns, MAX_GRID) || !isCount(o.rows, MAX_GRID)) {
				problems.push(`${called} needs from 1 to ${MAX_GRID} columns and rows.`);
			}
			const width = metres(o.width, 0, 50, `${called}'s width`, problems);
			const height = metres(o.height, 0, 50, `${called}'s height`, problems);
			const first = CORNERS.includes(o.first as Corner) ? (o.first as Corner) : null;
			if (!first) problems.push(`${called} needs the corner its data enters at.`);
			light = {
				...base,
				kind: 'matrix',
				centre: centre ?? [0, 0, 0],
				width: width ?? 0,
				height: height ?? 0,
				columns: o.columns as number,
				rows: o.rows as number,
				mount: mount(o.mount, called, problems),
				first: first ?? 'top-left',
				horizontal: o.horizontal !== false,
				serpentine: o.serpentine === true,
				role: role(o.role, called, problems)
			} satisfies MatrixLight;
			break;
		}
		case 'lamp': {
			const at = point(o.at);
			if (!at) problems.push(`${called} needs a position in metres.`);
			const height = metres(o.height, 0, 10, `${called}'s height`, problems);
			const diameter = metres(o.diameter, 0.01, 5, `${called}'s size`, problems);
			const mode = o.mode === 'pixel' || o.mode === 'summary' ? o.mode : null;
			if (!mode) problems.push(`${called} has to glow with the whole room or be painted as a pixel.`);
			light = {
				...base,
				kind: 'lamp',
				at: at ?? [0, 0, 0],
				height: height ?? 0,
				diameter: diameter ?? 0.1,
				mode: mode ?? 'summary'
			} satisfies LampLight;
			break;
		}
		default:
			problems.push(`${called} has to be a path, a ring, a matrix or a lamp.`);
	}
	return problems.length === before ? light : null;
}

function readWiring(value: unknown, called: string, problems: string[]): Wiring | undefined {
	const o = object(value);
	if (!o || typeof o.controller !== 'string' || !ID.test(o.controller) || !isIndex(o.start)) {
		problems.push(`${called} is wired to a controller by its id and a first pixel from 0.`);
		return undefined;
	}
	return { controller: o.controller, start: o.start, ...(o.reversed === true ? { reversed: true } : {}) };
}

function object(value: unknown): Fields | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

function point(value: unknown): Vec3 | null {
	if (!Array.isArray(value) || value.length !== 3) return null;
	return value.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= FAR)
		? (value as unknown as Vec3)
		: null;
}

function metres(value: unknown, min: number, max: number, what: string, problems: string[]): number | null {
	if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) return value;
	problems.push(`${what} has to be from ${min} to ${max} metres.`);
	return null;
}

function fraction(value: unknown, what: string, problems: string[]): number | null {
	if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) return value;
	problems.push(`${what} has to be from 0 to 1.`);
	return null;
}

function isCount(value: unknown, max: number): value is number {
	return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max;
}

function isIndex(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_LEDS;
}

function mount(value: unknown, called: string, problems: string[]): Mount {
	if (MOUNTS.includes(value as Mount)) return value as Mount;
	problems.push(`${called} has to be on the ceiling, the floor or a wall.`);
	return 'ceiling';
}

function role(value: unknown, called: string, problems: string[]): LightRole {
	if (ROLES.includes(value as LightRole)) return value as LightRole;
	problems.push(`${called} has to be part of the ring, a spine, a field, or left to the room.`);
	return 'auto';
}
