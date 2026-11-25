import type { LightTestKind } from '@mv/core';
import type { Found, OutputStatus } from './controllers.ts';
import { readRoom, type Room, type RoomsState } from './rooms.ts';
import { wiringProblems } from './wiring.ts';

export type Selection =
	| { kind: 'light'; id: string; point?: number }
	| { kind: 'controller'; id: string };

export interface LightTest {
	kind: LightTestKind;
	lights: string[];
}

/** Edits this close together under one gesture undo as one. */
const COALESCE_MS = 1200;
const HISTORY = 100;
/** Saving waits for a pause, so a drag writes the file a few times a second, not every frame. */
const SAVE_DELAY_MS = 250;
/** The server ends a test after a minute; so does this. */
const TEST_LIMIT_MS = 60_000;

/**
 * The rooms as the server keeps them, and the room that plays as the setup edits it. Edits apply
 * here at once and reach the server shortly after, where the room that plays follows them.
 */
export class RoomsClient {
	state = $state.raw<RoomsState | null>(null);
	output = $state.raw<OutputStatus>({ running: false, room: '', controllers: [] });
	/** The room that plays, with any edits the server has not confirmed yet. */
	room = $state.raw<Room | null>(null);
	selection = $state.raw<Selection | null>(null);
	/** A light or controller the pointer is over in a list, shown on the plan and in 3D. */
	hovered = $state<string | null>(null);
	test = $state.raw<LightTest | null>(null);
	discovery = $state.raw<{ running: boolean; searched: boolean; found: Found[] }>({
		running: false,
		searched: false,
		found: []
	});
	/** Why the last change did not reach the server, in words. */
	failure = $state('');
	/** Lighting the room asks every board what it decodes first, which takes a moment. */
	switching = $state<'on' | 'off' | null>(null);

	private past = $state.raw<Room[]>([]);
	private future = $state.raw<Room[]>([]);
	private gesture: string | null = null;
	private gestureAt = 0;
	private version = 0;
	private saved = 0;
	private saving = false;
	private again = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private testTimer: ReturnType<typeof setTimeout> | null = null;
	private sources: EventSource[] = [];

	readonly problems = $derived.by(() => {
		const room = this.room;
		if (!room) return [];
		const read = readRoom(room);
		return 'problems' in read ? read.problems : wiringProblems(room);
	});

	get rooms(): Room[] {
		return this.state?.rooms ?? [];
	}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}

	connect(): void {
		if (this.sources.length > 0) return;
		const rooms = new EventSource('/api/rooms/stream');
		rooms.addEventListener('rooms', (ev) => this.adopt(JSON.parse((ev as MessageEvent).data) as RoomsState));
		const output = new EventSource('/api/output/stream');
		output.addEventListener('output', (ev) => {
			this.output = JSON.parse((ev as MessageEvent).data) as OutputStatus;
		});
		this.sources = [rooms, output];
	}

	dispose(): void {
		for (const source of this.sources) source.close();
		this.sources = [];
		this.flush();
	}

	/**
	 * The server's rooms. Another room taking over starts the editing afresh; the same room is
	 * taken as it comes unless there are edits here it has not seen yet.
	 */
	private adopt(state: RoomsState): void {
		this.state = state;
		const active = state.rooms.find((r) => r.id === state.active) ?? state.rooms[0];
		if (!active) return;
		if (this.room?.id !== active.id) {
			// Edits to the room that stopped playing still belong to it.
			if (this.room && this.version !== this.saved) void this.put(this.room);
			if (this.saveTimer) clearTimeout(this.saveTimer);
			this.saveTimer = null;
			this.room = active;
			this.past = [];
			this.future = [];
			this.gesture = null;
			this.selection = null;
			this.version = this.saved = 0;
			this.stopTest();
		} else if (this.version === this.saved && JSON.stringify(active) !== JSON.stringify(this.room)) {
			this.room = active;
		}
	}

	/** Change the room. Edits under the same `gesture` in quick succession undo as one. */
	edit(change: (room: Room) => Room, gesture?: string): void {
		const room = this.room;
		if (!room) return;
		const next = change(room);
		if (next === room) return;
		const now = performance.now();
		const joined = gesture !== undefined && gesture === this.gesture && now - this.gestureAt < COALESCE_MS;
		if (!joined) {
			this.past = [...this.past.slice(-(HISTORY - 1)), room];
			this.future = [];
		}
		this.gesture = gesture ?? null;
		this.gestureAt = now;
		this.commit(next);
	}

	/** A gesture is over: the next edit starts a new undo step, and the room is saved now. */
	settle(): void {
		this.gesture = null;
		this.flush();
	}

	undo(): void {
		const previous = this.past.at(-1);
		if (!previous || !this.room) return;
		this.past = this.past.slice(0, -1);
		this.future = [this.room, ...this.future];
		this.gesture = null;
		this.commit(previous);
	}

	redo(): void {
		const next = this.future[0];
		if (!next || !this.room) return;
		this.future = this.future.slice(1);
		this.past = [...this.past, this.room];
		this.gesture = null;
		this.commit(next);
	}

	select(selection: Selection | null): void {
		this.selection = selection;
	}

	private commit(room: Room): void {
		this.room = room;
		this.version++;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY_MS);
	}

	flush(): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		void this.save();
	}

	/** One save at a time; whatever was edited meanwhile goes in the next one. */
	private async save(): Promise<void> {
		this.saveTimer = null;
		const room = this.room;
		const version = this.version;
		if (!room || version === this.saved) return;
		// Nothing half-valid reaches the server; the setup shows what is wrong instead.
		if ('problems' in readRoom(room)) return;
		if (this.saving) {
			this.again = true;
			return;
		}
		this.saving = true;
		try {
			if (await this.put(room)) this.saved = Math.max(this.saved, version);
		} finally {
			this.saving = false;
			if (this.again) {
				this.again = false;
				void this.save();
			}
		}
	}

	private async put(room: Room): Promise<boolean> {
		try {
			const res = await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(room)
			});
			this.failure = res.ok ? '' : await res.text();
			return res.ok;
		} catch {
			this.failure = 'The app is not answering, so the room is not saved yet.';
			return false;
		}
	}

	private async post(url: string, body: unknown): Promise<Response | null> {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			this.failure = res.ok ? '' : await res.text();
			return res;
		} catch {
			this.failure = 'The app is not answering.';
			return null;
		}
	}

	/** `from` is `'frame'` for the Frame, a room's id for a copy of it, or nothing for an empty room. */
	async create(name: string, from?: string): Promise<void> {
		this.flush();
		const res = await this.post('/api/rooms', { action: 'create', name, from });
		if (res?.ok) this.adopt((await res.json()) as RoomsState);
	}

	async activate(id: string): Promise<void> {
		if (id === this.state?.active) return;
		this.flush();
		const res = await this.post('/api/rooms', { action: 'activate', id });
		if (res?.ok) this.adopt((await res.json()) as RoomsState);
	}

	async remove(id: string): Promise<void> {
		try {
			const res = await fetch(`/api/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' });
			if (res.ok) this.adopt((await res.json()) as RoomsState);
			else this.failure = await res.text();
		} catch {
			this.failure = 'The app is not answering.';
		}
	}

	/** A room exported from this app, here or on another machine. */
	async importFile(file: File): Promise<void> {
		let room: unknown;
		try {
			room = JSON.parse(await file.text());
		} catch {
			this.failure = `${file.name} is not a room file.`;
			return;
		}
		this.flush();
		const res = await this.post('/api/rooms', { action: 'import', room });
		if (res?.ok) this.adopt((await res.json()) as RoomsState);
	}

	export(room: Room | null = this.room): void {
		if (!room) return;
		const blob = new Blob([JSON.stringify(room, null, '\t')], { type: 'application/json' });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = `${room.name.replace(/[^\w -]+/g, '').trim() || 'room'}.room.json`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(link.href), 1000);
	}

	async start(): Promise<void> {
		this.flush();
		this.switching = 'on';
		await this.post('/api/output', { action: 'start' });
		this.switching = null;
	}

	async stop(): Promise<void> {
		this.switching = 'off';
		await this.post('/api/output', { action: 'stop' });
		this.switching = null;
	}

	/** Show a setup pattern on some lights, in the preview and on the room's own. */
	startTest(kind: LightTestKind, lights: string[]): void {
		if (lights.length === 0) return;
		this.test = { kind, lights };
		void this.post('/api/output', { action: 'test', kind, lights });
		if (this.testTimer) clearTimeout(this.testTimer);
		this.testTimer = setTimeout(() => this.stopTest(), TEST_LIMIT_MS);
	}

	stopTest(): void {
		if (this.testTimer) clearTimeout(this.testTimer);
		this.testTimer = null;
		if (!this.test) return;
		this.test = null;
		void this.post('/api/output', { action: 'untest' });
	}

	async discover(): Promise<void> {
		if (this.discovery.running) return;
		this.discovery = { ...this.discovery, running: true };
		const res = await this.post('/api/discovery', {});
		const found = res?.ok ? ((await res.json()) as { found: Found[] }).found : [];
		this.discovery = { running: false, searched: true, found };
	}
}
