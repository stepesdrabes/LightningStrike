import {
	DEFAULT_ROOM,
	GAMMA,
	MASTER,
	planeOf,
	readLayout,
	type Light,
	type RoomLayout,
	type Vec3,
	type Wall
} from '@mv/core';
import {
	CONTRAST_MAX,
	CONTRAST_MIN,
	DEFAULT_OUTPUT_FPS,
	OFFSET_MAX_MS,
	OFFSET_MIN_MS,
	OUTPUT_BRIGHTNESS_MIN,
	isOutputFps
} from './hardware.ts';
import { ceilingHeight, onSurface, STANDOFF } from './plan.ts';

export type ControllerKind = 'wled' | 'lightningstrike' | 'ddp' | 'sacn' | 'artnet';

export const CONTROLLER_KINDS: Record<ControllerKind, { name: string; blurb: string }> = {
	wled: { name: 'WLED', blurb: 'An ESP32 or ESP8266 running WLED, sent pixels over DDP.' },
	lightningstrike: { name: 'LightningStrike board', blurb: 'A board running this project’s firmware.' },
	ddp: { name: 'DDP', blurb: 'Any controller that takes DDP, such as ESPixelStick or Falcon Player.' },
	sacn: { name: 'sACN', blurb: 'E1.31, 170 pixels to a universe from the first one you set.' },
	artnet: { name: 'Art-Net', blurb: 'Art-Net 4, 170 pixels to a universe from the first one you set.' }
};

/** Something on the network that takes pixels. */
export interface Controller {
	id: string;
	name: string;
	kind: ControllerKind;
	/** An address, or a name the network resolves. Empty until it is found or typed. */
	host: string;
	/** sACN and Art-Net: the universe the first pixel goes out on. */
	universe?: number;
	/** How a found controller is recognised again after its address changes. */
	mac?: string;
}

export interface RoomOutput {
	/** Frames a second on the wire. */
	fps: number;
	/** Milliseconds the lights run ahead of the audio, to cover the network and controllers. */
	leadMs: number;
	/** Delivered brightness of the room's pixels. */
	level: number;
	/** The output exponent: higher sinks the mids so a flash has something to stand out from. */
	punch: number;
	/** Light up as soon as the app opens. */
	autoStart: boolean;
}

export interface Room {
	id: string;
	name: string;
	layout: RoomLayout;
	controllers: Controller[];
	output: RoomOutput;
}

export interface RoomsState {
	/** The room that plays. */
	active: string;
	rooms: Room[];
}

const DEFAULT_OUTPUT: RoomOutput = {
	fps: DEFAULT_OUTPUT_FPS,
	leadMs: 0,
	level: MASTER,
	punch: GAMMA,
	autoStart: true
};

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const HOST = /^[A-Za-z0-9._-]{0,253}$/;
const NAME_MAX = 60;

/** Read a room from a file or a request: the room, or every problem with it in words. */
export function readRoom(value: unknown): { room: Room } | { problems: string[] } {
	const o = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
	if (!o) return { problems: ['A room has to be an object.'] };
	const problems: string[] = [];
	const name = typeof o.name === 'string' ? o.name.trim().slice(0, NAME_MAX) : '';
	if (typeof o.id !== 'string' || !ID.test(o.id)) problems.push('The room needs a short id.');
	if (!name) problems.push('The room needs a name.');

	const read = readLayout(o.layout);
	if ('problems' in read) problems.push(...read.problems);

	const listed = Array.isArray(o.controllers) ? o.controllers : [];
	const controllers: Controller[] = [];
	for (const [i, raw] of listed.entries()) {
		const c = readController(raw, i, problems);
		if (!c) continue;
		if (controllers.some((d) => d.id === c.id)) problems.push(`Two controllers share the id "${c.id}".`);
		controllers.push(c);
	}
	// A controller that did not read has said so already; only one that is missing needs saying.
	const named = new Set(listed.map((c) => (typeof c === 'object' && c !== null ? (c as { id?: unknown }).id : null)));
	if ('layout' in read) {
		for (const light of read.layout.lights) {
			const wired = light.wiring?.controller;
			if (wired && !named.has(wired)) {
				problems.push(`"${light.name}" is wired to a controller this room does not have.`);
			}
		}
	}
	const output = readOutput(o.output, problems);
	if (problems.length > 0 || !('layout' in read)) return { problems };
	return { room: { id: o.id as string, name, layout: read.layout, controllers, output } };
}

function readController(value: unknown, i: number, problems: string[]): Controller | null {
	const o = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
	const label = `Controller ${i + 1}`;
	if (!o) {
		problems.push(`${label} has to be an object.`);
		return null;
	}
	const before = problems.length;
	const name = typeof o.name === 'string' ? o.name.trim().slice(0, NAME_MAX) : '';
	const kind = o.kind as ControllerKind;
	if (typeof o.id !== 'string' || !ID.test(o.id)) problems.push(`${label} needs a short id.`);
	if (!name) problems.push(`${label} needs a name.`);
	if (!(kind in CONTROLLER_KINDS)) problems.push(`"${name || label}" is not a kind of controller this app speaks to.`);
	const host = typeof o.host === 'string' ? o.host.trim() : '';
	if (!HOST.test(host)) problems.push(`"${name || label}" needs an address or a network name.`);
	const universe = o.universe;
	const universal = kind === 'sacn' || kind === 'artnet';
	const range = kind === 'sacn' ? [1, 63999] : [0, 32767];
	if (universal && !(Number.isInteger(universe) && (universe as number) >= range[0] && (universe as number) <= range[1])) {
		problems.push(`"${name || label}" needs its first universe, from ${range[0]} to ${range[1]}.`);
	}
	if (problems.length > before) return null;
	return {
		id: o.id as string,
		name,
		kind,
		host,
		...(universal ? { universe: universe as number } : {}),
		...(typeof o.mac === 'string' && /^[0-9a-f]{12}$/.test(o.mac) ? { mac: o.mac } : {})
	};
}

function readOutput(value: unknown, problems: string[]): RoomOutput {
	const o = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	const within = (v: unknown, min: number, max: number, what: string, fallback: number) => {
		if (v === undefined) return fallback;
		if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
		problems.push(`${what} has to be from ${min} to ${max}.`);
		return fallback;
	};
	if (o.fps !== undefined && !isOutputFps(o.fps)) problems.push('The frame rate has to be 30, 60 or 120.');
	return {
		fps: isOutputFps(o.fps) ? o.fps : DEFAULT_OUTPUT.fps,
		leadMs: within(o.leadMs, OFFSET_MIN_MS, OFFSET_MAX_MS, 'The lead', DEFAULT_OUTPUT.leadMs),
		level: within(o.level, OUTPUT_BRIGHTNESS_MIN, 1, 'The level', DEFAULT_OUTPUT.level),
		punch: within(o.punch, CONTRAST_MIN, CONTRAST_MAX, 'The punch', DEFAULT_OUTPUT.punch),
		autoStart: o.autoStart !== false
	};
}

/** An id no other item in `taken` has, readable where it can be. */
export function freshId(base: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';
	if (!used.has(stem)) return stem;
	for (let n = 2; ; n++) if (!used.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

/** The room this project's shows were tuned in, with its two boards. */
export function frameRoom(id: string, name = 'The Frame'): Room {
	return {
		id,
		name,
		layout: DEFAULT_ROOM,
		controllers: [
			{ id: 'frame', name: 'The Frame', kind: 'lightningstrike', host: '' },
			{ id: 'bounce', name: 'Bounce Lamp', kind: 'lightningstrike', host: '' }
		],
		output: { ...DEFAULT_OUTPUT }
	};
}

/** A room that plays in the preview straight away: the Frame's lights, nothing wired. */
export function previewRoom(id: string): Room {
	return {
		id,
		name: 'Preview',
		layout: { ...DEFAULT_ROOM, lights: DEFAULT_ROOM.lights.map(({ wiring: _, ...light }) => light) },
		controllers: [],
		output: { ...DEFAULT_OUTPUT }
	};
}

export function emptyRoom(id: string, name: string): Room {
	return {
		id,
		name,
		layout: { width: 5, depth: 4, height: 2.6, front: 'south', lights: [] },
		controllers: [],
		output: { ...DEFAULT_OUTPUT }
	};
}

export type LightShape = 'strip' | 'loop' | 'ring' | 'matrix' | 'lamp';

/**
 * A new light of a shape, sized and placed so it reads in this room before anything is adjusted:
 * on `wall` when one is being looked at, else under the ceiling or on the front wall.
 */
export function newLight(shape: LightShape, layout: RoomLayout, id: string, wall: Wall | null = null): Light {
	const hw = layout.width / 2;
	const hd = layout.depth / 2;
	const top = ceilingHeight(layout);
	const eye = Math.min(1.5, layout.height / 2);
	const onto = wall ?? layout.front;
	/** A point on `onto`, `u` metres to the right of its middle as seen from inside the room. */
	const along = (u: number, z: number): Vec3 => {
		const { right } = planeOf(onto);
		const [x, y] = onSurface([0, 0, z], onto, layout);
		return [round3(x + right[0] * u), round3(y + right[1] * u), z];
	};
	switch (shape) {
		case 'strip': {
			const span = (onto === 'north' || onto === 'south' ? hw : hd) - 0.3;
			const half = Math.max(0.2, Math.min(1.5, span));
			return {
				id,
				name: 'Strip',
				kind: 'path',
				points: [along(-half, top), along(half, top)],
				counts: [Math.round(half * 2 * 60)],
				closed: false,
				density: 60,
				mount: wall ?? 'ceiling',
				role: 'auto'
			};
		}
		case 'loop': {
			const x = Math.max(0.3, hw - 0.3);
			const y = Math.max(0.3, hd - 0.3);
			const points: Vec3[] = [
				[-x, y, top],
				[x, y, top],
				[x, -y, top],
				[-x, -y, top]
			];
			return {
				id,
				name: 'Loop',
				kind: 'path',
				points,
				counts: [x, y, x, y].map((side) => Math.round(side * 2 * 60)),
				closed: true,
				density: 60,
				mount: 'ceiling',
				role: 'auto'
			};
		}
		case 'ring':
			return {
				id,
				name: 'Ring',
				kind: 'ring',
				centre: wall ? along(0, eye) : [0, 0, layout.height - STANDOFF],
				radius: 0.5,
				count: 60,
				startAngle: 0,
				clockwise: true,
				mount: wall ?? 'ceiling',
				role: 'auto'
			};
		case 'matrix':
			return {
				id,
				name: 'Panel',
				kind: 'matrix',
				centre: along(0, eye),
				width: 0.8,
				height: 0.8,
				columns: 16,
				rows: 16,
				mount: onto,
				first: 'top-left',
				horizontal: true,
				serpentine: false,
				role: 'auto'
			};
		case 'lamp':
			return {
				id,
				name: 'Lamp',
				kind: 'lamp',
				at: [-(hw - 0.5), -(hd - 0.5), 0],
				height: 1,
				diameter: 0.18,
				mode: 'summary'
			};
	}
}

function round3(v: number): number {
	return Math.round(v * 1000) / 1000;
}
