import { readFile } from 'node:fs/promises';
import {
	EffectRegistry,
	LightTest,
	RemoteClock,
	RoomDirector,
	RowClock,
	compileGenerated,
	roomKey,
	roomModel,
	type LedSink,
	type LightTestKind,
	type RoomModel,
	type RoomSync,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { analysisPath, preparedNarration, showPath } from '@mv/analysis';
import { createArtnetSink, createDdpSink, createSacnSink, type DdpTarget } from '@mv/transport';
import { rowBundle } from '$lib/evening/bundle.ts';
import { currentItem, type QueueItem } from '$lib/queueModel.ts';
import type { Controller, Room } from '$lib/rooms.ts';
import { fillController, planWiring, type ControllerPlan, type WiringPlan } from '$lib/wiring.ts';
import { controllers, resolve } from './controllers.ts';
import { evening } from './evening/store.ts';
import { queue } from './queueStore.ts';
import { rooms } from './rooms.ts';
import { settings, type PublicSettings } from './settings.ts';

/**
 * Browser syncs arrive every 500 ms; expire missing syncs so a closed tab eventually rests the
 * room.
 */
const SYNC_STALE_MS = 3000;

/**
 * A browser whose director has not rendered for this long is hidden or throttled; its room
 * decisions are stale and this room decides for itself until it comes back.
 */
const FOLLOW_MAX_AGE = 1;

/** One controller being fed: its share of the room, assembled into its own frame. */
interface Feed {
	plan: ControllerPlan;
	sink: LedSink;
	frame: Uint8Array;
	/** The DDP target, kept so a board that stops decoding packed frames can be sent plain ones. */
	target: DdpTarget | null;
}

/**
 * Render the room that plays on the server for its controllers. The browser supplies the audio
 * position and the decisions its own director made, so both rooms agree.
 */
class Output {
	private room: Room | null = null;
	private model: RoomModel = roomModel();
	private registry = new EffectRegistry();
	private director = new RoomDirector(this.model.geometry, this.registry, this.model.lamps.length);
	private test = new LightTest(this.model);
	private readonly clock = new RemoteClock(SYNC_STALE_MS);
	private readonly rows = new RowClock(this.clock);
	private feeds: Feed[] = [];
	/** What the feeds were opened for, so an edit that leaves it alone keeps them open. */
	private fedFor = '';
	/** Bumped by every start and stop, so feeds opened for an earlier one are closed, not kept. */
	private session = 0;
	private joining = false;
	private timer: NodeJS.Timeout | null = null;
	/** Bumped by every arm so a frame left over from the last one stops rather than doubling up. */
	private generation = 0;

	private frames = 0;
	private failed = false;
	private lounge = false;
	/** The current track's own verdict: its grid is lost, so lounge carries it. */
	loungeOnly = false;
	/** An evening row lit calmly. */
	rowLounge = false;
	private rest = true;
	private fps = 60;
	private settingsSeen: PublicSettings | null = null;
	/** The show the director holds, so the same file is not restarted under a playing track. */
	private loadedShow = '';
	private loaded: { analysis: TrackAnalysis; show: Show; dissolve?: number } | null = null;

	/** The track or evening row this output renders, so the queue can tell when to re-point. */
	trackId: string | null = null;

	private readonly listeners = new Set<() => void>();

	get running(): boolean {
		return this.timer !== null;
	}

	/** Hears when the room starts or stops playing, or another room takes over. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private changed(): void {
		for (const listener of this.listeners) listener();
	}

	get status() {
		return {
			running: this.running,
			room: this.room?.id ?? null,
			playing: this.clock.sounding(performance.now()),
			position: this.clock.position,
			frames: this.frames,
			resting: this.director.resting,
			scene: this.director.sceneName,
			/** What this room decided, for a browser that starts leading to adopt first. */
			decisions: this.director.sync()
		};
	}

	apply(s: PublicSettings): void {
		this.settingsSeen = s;
		this.lounge = s.lounge;
		this.rest = s.rest;
		this.director.ambientSettings = s.ambient;
	}

	/**
	 * Play this room. Other lights get a director of their own, which takes over the show and
	 * the moment; a controller sent a different amount, or at another address, gets a new feed.
	 * Everything else, levels and the lead included, applies to the running room at once.
	 */
	async useRoom(room: Room): Promise<void> {
		const model = roomModel(room.layout);
		const reshaped = roomKey(model.geometry) !== roomKey(this.model.geometry) || model.lamps.length !== this.model.lamps.length;
		this.room = room;
		this.model = model;

		if (reshaped) {
			const was = this.director.sync();
			this.registry = new EffectRegistry();
			this.director = new RoomDirector(model.geometry, this.registry, model.lamps.length);
			if (this.settingsSeen) this.apply(this.settingsSeen);
			this.loadedShow = '';
			if (this.loaded) this.load(this.loaded.analysis, this.loaded.show, this.loaded.dissolve);
			this.director.succeed(was);
		}
		this.test.use(model);

		this.director.brightness = room.output.level;
		this.director.contrast = room.output.punch;
		model.lamps.forEach((lamp, i) => (this.director.lampLevels[i] = room.output.level * (lamp.level ?? 1)));
		this.clock.trim(room.output.leadMs / 1000);
		const fps = room.output.fps;

		const plan = planWiring(room, model);
		controllers.use(room.controllers, new Map(plan.controllers.map((c) => [c.controller.id, c.pixels])));

		if (!this.running) {
			this.fps = fps;
		} else if (feedKey(plan) !== this.fedFor) {
			await this.start();
		} else {
			for (const feed of this.feeds) {
				feed.plan = plan.controllers.find((p) => p.controller.id === feed.plan.controller.id) ?? feed.plan;
			}
			if (fps !== this.fps) {
				this.fps = fps;
				this.arm();
			}
		}
		this.changed();
	}

	load(analysis: TrackAnalysis, show: Show, dissolve?: number): void {
		this.loaded = { analysis, show, dissolve };
		// The queue and a stream start both load the current track; only a changed show counts.
		const key = JSON.stringify(show);
		if (key === this.loadedShow) return;
		this.loadedShow = key;
		this.registry.clearGenerated();
		for (const gen of show.generatedEffects) {
			const compiled = compileGenerated(gen, this.model.geometry);
			if (compiled.def) this.registry.add(compiled.def);
		}
		this.director.load(analysis, show, dissolve);
	}

	/** Clear the track while retaining the loop; a showless director enters ambient immediately. */
	clearShow(): void {
		this.registry.clearGenerated();
		this.director.clearShow();
		this.loadedShow = '';
		this.loaded = null;
		this.trackId = null;
	}

	/** Light these lights with a test pattern over whatever plays, until stopped or forgotten. */
	testLights(kind: LightTestKind, lightIds: readonly string[]): void {
		this.test.start(kind, lightIds);
	}

	stopTest(): void {
		this.test.stop();
	}

	/** Feed every controller of the room that has an address and answers to it. */
	async start(): Promise<void> {
		if (!this.room) await this.useRoom(await rooms.active());
		const room = this.room!;
		// Ask after the last stream has stopped: a probe competing with 60 fps of its own output can
		// lose, and a lost probe drops the board to plain pixels for the whole of the next show.
		await this.stop();
		const session = this.session;
		const plan = planWiring(room, this.model);
		const feeds: Feed[] = [];
		for (const p of plan.controllers.filter(fed)) {
			const feed = await open(p);
			if (feed) feeds.push(feed);
		}
		if (session !== this.session) {
			await Promise.all(feeds.map((f) => f.sink.close()));
			return;
		}
		// Edited while the boards were asked: other controllers start over, the rest take the edit.
		const latest = planWiring(this.room!, this.model);
		if (feedKey(latest) !== feedKey(plan)) {
			await Promise.all(feeds.map((f) => f.sink.close()));
			return this.start();
		}
		for (const feed of feeds) {
			feed.plan = latest.controllers.find((p) => p.controller.id === feed.plan.controller.id) ?? feed.plan;
		}
		this.feeds = feeds;
		this.fedFor = feedKey(latest);
		this.frames = 0;
		controllers.setStreaming(true);
		this.fps = room.output.fps;
		this.arm();
		this.changed();
	}

	/** A controller that did not answer when the room was lit is fed as soon as it does. */
	async join(): Promise<void> {
		if (!this.running || !this.room || this.joining) return;
		this.joining = true;
		const session = this.session;
		try {
			for (const p of planWiring(this.room, this.model).controllers.filter(fed)) {
				if (this.feeds.some((f) => f.plan.controller.id === p.controller.id)) continue;
				if (!controllers.link(p.controller.id)?.address) continue;
				const feed = await open(p);
				if (!feed) continue;
				if (session !== this.session) {
					await feed.sink.close();
					return;
				}
				this.feeds = [...this.feeds, feed];
			}
		} finally {
			this.joining = false;
		}
	}

	/**
	 * Send directly from the render clock. Each frame is scheduled against an absolute deadline
	 * rather than on a fixed interval: setInterval accumulates its own rounding and delivers
	 * 58.7 fps where the same loop against deadlines delivers 60.0, measured on loopback with
	 * `tools/ddp-probe.ts`.
	 */
	private arm(): void {
		if (this.timer) clearTimeout(this.timer);
		const period = 1000 / this.fps;
		const mine = ++this.generation;
		let last = performance.now();
		let deadline = last + period;
		const tick = (): void => {
			if (mine !== this.generation) return;
			const now = performance.now();
			const dt = Math.min((now - last) / 1000, 0.05);
			last = now;
			const reading = this.clock.read(now);
			if (reading.seek) this.director.seek();
			try {
				this.director.update(reading.t, dt, {
					playing: reading.playing,
					hasShow: this.director.player.loaded !== null,
					lounge: this.lounge || this.loungeOnly,
					rest: this.rest
				});
			} catch (e) {
				// A frame that failed to compose keeps the last bytes; the server and the stream stay up.
				if (!this.failed) console.error('hardware frame failed', e);
				this.failed = true;
			}
			this.test.apply(this.director.bytes, this.director.lamps, dt);
			for (const feed of this.feeds) {
				fillController(feed.plan, this.director.bytes, this.director.lamps, feed.frame);
				feed.sink.send({ rgb: feed.frame, dt, frameId: this.frames, presentAtMs: now });
			}
			this.frames++;
			deadline += period;
			// Measured against when the frame finished, not when it started: a frame that
			// overran leaves its successor already due, and the loop would send the missed
			// ones back to back rather than resuming from here.
			const done = performance.now();
			if (deadline <= done) deadline = done + period;
			this.timer = setTimeout(tick, deadline - done);
		};
		this.timer = setTimeout(tick, period);
	}

	/** The browser's room decisions come along so the scenes and dissolves agree. */
	sync(position: number, playing: boolean, decisions?: RoomSync, age = 0, key?: string, currentKey?: string): void {
		if (decisions && age <= FOLLOW_MAX_AGE) this.director.follow(decisions);
		this.rows.sync(position, playing, performance.now(), key, currentKey);
	}

	/** The same show under another queue row: nothing reloads, the positions just carry its key. */
	renameRow(key: string | null): void {
		this.rows.rename(key);
	}

	/** A row has loaded: it starts where the browser already has it, or at its own beginning. */
	arrive(key: string | null): void {
		this.rows.arrive(key, performance.now());
	}

	/**
	 * Back to plain pixels for a board that reverted to firmware older than the packed payload
	 * while the show was running: it rejects the whole datagram, which is what `bad` counts.
	 */
	unpack(controllerId: string): void {
		for (const feed of this.feeds) if (feed.plan.controller.id === controllerId && feed.target) feed.target.packed = false;
	}

	async stop(): Promise<void> {
		this.session++;
		this.generation++;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const feeds = this.feeds;
		this.feeds = [];
		await Promise.all(feeds.map((f) => f.sink.close()));
		controllers.setStreaming(false);
		this.changed();
	}

	/** A bail untagged the evening row this output renders; the same song carries on. */
	carriesOn(item: QueueItem): boolean {
		return !item.evening && this.trackId === `row:${item.key}` && this.director.player.loaded?.show.trackId === item.trackId;
	}
}

/** Controllers the room sends something to, at an address. */
function fed(plan: ControllerPlan): boolean {
	return plan.pixels > 0 && plan.controller.host !== '';
}

function feedKey(plan: WiringPlan): string {
	return JSON.stringify(
		plan.controllers.filter(fed).map((p) => [p.controller.id, p.controller.kind, p.controller.host, p.controller.universe ?? null, p.pixels])
	);
}

/** A feed for one controller, or null while its address does not resolve. */
async function open(plan: ControllerPlan): Promise<Feed | null> {
	const link = controllers.link(plan.controller.id);
	const address = link?.address || (await resolve(plan.controller.host));
	if (!address) return null;
	const packed = (await link?.packs()) ?? false;
	return feedFor(plan, address, packed);
}

async function feedFor(plan: ControllerPlan, address: string, packed: boolean): Promise<Feed> {
	const c: Controller = plan.controller;
	const ledCount = plan.pixels;
	let target: DdpTarget | null = null;
	let sink: LedSink;
	if (c.kind === 'sacn') {
		sink = createSacnSink({ targets: [{ host: address, firstLed: 0, ledCount, universe: c.universe ?? 1 }] });
	} else if (c.kind === 'artnet') {
		sink = createArtnetSink({ targets: [{ host: address, universe: c.universe ?? 0, ledCount }] });
	} else {
		target = { host: address, firstLed: 0, ledCount, deviceFirstLed: 0, packed };
		sink = createDdpSink({ targets: [target] });
	}
	await sink.open();
	return { plan, sink, frame: new Uint8Array(ledCount * 3), target };
}

export const output = new Output();

// Telemetry is the only place a board can say it did not understand the datagram at all.
controllers.subscribe((statuses) => {
	for (const s of statuses) if ((s.telemetry?.bad ?? 0) > 0) output.unpack(s.id);
	void output.join();
});

/** Load a track's analysis and show, or explain why it cannot be loaded. */
export async function loadTrack(id: string): Promise<{ analysis: TrackAnalysis; show: Show } | null> {
	try {
		return {
			analysis: JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis,
			show: JSON.parse(await readFile(showPath(id), 'utf8')) as Show
		};
	} catch {
		return null;
	}
}

interface LoadedRow {
	analysis: TrackAnalysis;
	show: Show;
	dissolve?: number;
	lounge: boolean;
}

/** What a queue row renders: its track's show, or an evening row built from its plan. */
async function loadRow(item: QueueItem): Promise<LoadedRow | null> {
	if (!item.evening) {
		const loaded = item.trackId ? await loadTrack(item.trackId) : null;
		return loaded ? { ...loaded, lounge: false } : null;
	}
	const lighting = await evening.lightingSoon(item.key);
	if (!lighting) return null;
	const plan = lighting.plan;
	const track = plan.kind === 'song' ? await loadTrack(plan.trackId) : null;
	if (plan.kind === 'song' && !track) return null;
	const audio = plan.kind === 'narration' ? evening.narrationAudio(item.key) : null;
	const measured = audio ? await preparedNarration(audio).catch(() => null) : null;
	const bundle = rowBundle(item.key, plan, track, measured);
	if (!bundle?.show) return null;
	return { analysis: bundle.analysis, show: bundle.show, dissolve: lighting.light, lounge: bundle.lounge };
}

/** An evening row is its own identity; a plain row is its track, so metadata edits do not reload. */
function identityOf(item: QueueItem | null): string | null {
	if (!item) return null;
	return item.evening ? `row:${item.key}` : item.trackId;
}

/** Load whatever the queue has playing, reading its show from disk again. */
export async function loadCurrent(): Promise<void> {
	const current = currentItem(await queue.ready());
	output.loungeOnly = current?.loungeOnly ?? false;
	const row = current && current.status === 'ready' ? await loadRow(current) : null;
	if (!row || !current) {
		output.clearShow();
		return;
	}
	output.load(row.analysis, row.show, row.dissolve);
	output.rowLounge = row.lounge;
	output.loungeOnly = (current.loungeOnly ?? false) || row.lounge;
	output.trackId = identityOf(current);
	output.arrive(current.key);
}

/** Follow the server queue directly so track changes need no browser relay. */
queue.subscribe((state) => {
	if (!output.running) return;
	const item = currentItem(state);
	// Refresh trust before same-track early returns so the host override applies immediately.
	const identity = identityOf(item);
	if (item && output.carriesOn(item)) output.trackId = identity;
	if (identity === output.trackId) {
		output.loungeOnly = (item?.loungeOnly ?? false) || output.rowLounge;
		output.renameRow(item?.key ?? null);
		return;
	}
	output.loungeOnly = item?.loungeOnly ?? false;
	if (!item || !identity || item.status !== 'ready') return;
	void loadRow(item).then((loaded) => {
		if (!loaded || !output.running || identityOf(currentItem(queue.snapshot)) !== identity) return;
		output.load(loaded.analysis, loaded.show, loaded.dissolve);
		output.rowLounge = loaded.lounge;
		output.loungeOnly = (item.loungeOnly ?? false) || loaded.lounge;
		output.trackId = identity;
		output.arrive(item.key);
	});
});

/** Subscribe to settings directly so lounge and ambient changes reach output without a browser. */
settings.subscribe((s) => output.apply(s));

/** The room that plays is whatever the store says, including while it is being edited. */
rooms.subscribe((state) => {
	const room = state.rooms.find((r) => r.id === state.active) ?? state.rooms[0];
	output.useRoom(room).catch((e) => console.error('the room that plays could not be lit', e));
});

/** At launch: take the room that plays, and light it if it asks to be lit straight away. */
export async function boot(): Promise<void> {
	output.apply(await settings.read());
	const room = await rooms.active();
	try {
		await output.useRoom(room);
		if (room.output.autoStart && room.controllers.some((c) => c.host)) {
			await loadCurrent();
			await output.start();
		}
	} catch (e) {
		// The app still opens; the room can be lit from it once whatever failed is fixed.
		console.error('the room that plays could not be lit at launch', e);
	}
}
