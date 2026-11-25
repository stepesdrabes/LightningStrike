import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR } from '@mv/analysis';
import { frameRoom, previewRoom, readRoom, type Room, type RoomsState } from '$lib/rooms.ts';
import { settings, type LegacyOutput } from './settings.ts';

const ROOMS_FILE = join(CACHE_DIR, 'rooms.json');

type Listener = (state: RoomsState) => void;

/** Every saved room and which one plays. The file is the user's, so it is never dropped unread. */
class RoomStore {
	private state: RoomsState | null = null;
	private loading: Promise<RoomsState> | null = null;
	private writing: Promise<unknown> = Promise.resolve();
	private readonly listeners = new Set<Listener>();

	ready(): Promise<RoomsState> {
		if (this.state) return Promise.resolve(this.state);
		this.loading ??= this.load().then((state) => (this.state = state));
		return this.loading;
	}

	get snapshot(): RoomsState | null {
		return this.state;
	}

	async active(): Promise<Room> {
		const state = await this.ready();
		return state.rooms.find((r) => r.id === state.active) ?? state.rooms[0];
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** A room with a new id is added, a known one replaced. */
	async save(room: Room): Promise<RoomsState> {
		const state = await this.ready();
		const known = state.rooms.some((r) => r.id === room.id);
		const rooms = known ? state.rooms.map((r) => (r.id === room.id ? room : r)) : [...state.rooms, room];
		return this.commit({ ...state, rooms });
	}

	/** The last room stays: a room with no lights still plays its lamps and the preview. */
	async remove(id: string): Promise<RoomsState> {
		const state = await this.ready();
		const rooms = state.rooms.filter((r) => r.id !== id);
		if (rooms.length === 0 || rooms.length === state.rooms.length) return state;
		return this.commit({ active: state.active === id ? rooms[0].id : state.active, rooms });
	}

	async activate(id: string): Promise<RoomsState> {
		const state = await this.ready();
		if (state.active === id || !state.rooms.some((r) => r.id === id)) return state;
		return this.commit({ ...state, active: id });
	}

	private async commit(next: RoomsState): Promise<RoomsState> {
		this.state = next;
		await this.persist(next);
		for (const listener of this.listeners) listener(next);
		return next;
	}

	private persist(state: RoomsState): Promise<void> {
		const done = this.writing.then(async () => {
			await mkdir(CACHE_DIR, { recursive: true });
			const tmp = `${ROOMS_FILE}.${process.pid}.tmp`;
			await writeFile(tmp, JSON.stringify(state, null, '\t'));
			await rename(tmp, ROOMS_FILE);
		});
		this.writing = done.catch(() => {});
		return done;
	}

	private async load(): Promise<RoomsState> {
		let raw: string | null = null;
		try {
			raw = await readFile(ROOMS_FILE, 'utf8');
		} catch {
			// No rooms yet.
		}
		if (raw !== null) {
			const state = readState(raw);
			if (state) return state;
			await rename(ROOMS_FILE, `${ROOMS_FILE}.unreadable-${Date.now()}`).catch(() => {});
		}
		const first = firstRoom(await settings.takeLegacyOutput());
		const state = { active: first.id, rooms: [first] };
		await this.persist(state);
		return state;
	}
}

/** Rooms that no longer read are dropped one by one; a file with none left is not a file of rooms. */
function readState(raw: string): RoomsState | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	const o = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
	const rooms: Room[] = [];
	for (const candidate of Array.isArray(o.rooms) ? o.rooms : []) {
		const read = readRoom(candidate);
		if ('room' in read && !rooms.some((r) => r.id === read.room.id)) rooms.push(read.room);
		else if ('problems' in read) console.warn('a saved room no longer reads:', read.problems.join(' '));
	}
	if (rooms.length === 0) return null;
	const active = typeof o.active === 'string' && rooms.some((r) => r.id === o.active) ? o.active : rooms[0].id;
	return { active, rooms };
}

/**
 * An installation that ran before rooms had one, the Frame, with its output as it was set. A new
 * one starts with a room that plays in the preview until its lights are set up.
 */
export function firstRoom(legacy: LegacyOutput | null): Room {
	if (!legacy) return previewRoom('preview');
	const room = frameRoom('the-frame');
	room.output = {
		fps: legacy.fps ?? room.output.fps,
		leadMs: legacy.offsetMs ?? room.output.leadMs,
		level: legacy.brightness ?? room.output.level,
		punch: legacy.contrast ?? room.output.punch,
		// It never lit up on its own before, so it does not start to now.
		autoStart: false
	};
	// The lamp's own brightness was absolute; a light's level is now a share of the room's.
	const lamp = legacy.lampBrightness === undefined ? 1 : Math.min(1, legacy.lampBrightness / room.output.level);
	if (lamp < 1) {
		room.layout = {
			...room.layout,
			lights: room.layout.lights.map((l) => (l.id === 'bounce' ? { ...l, level: Math.round(lamp * 100) / 100 } : l))
		};
	}
	if (legacy.protocol === 'sacn') {
		room.controllers = room.controllers.map((c) => (c.id === 'frame' ? { ...c, kind: 'sacn', universe: 1 } : c));
	}
	return room;
}

export const rooms = new RoomStore();
