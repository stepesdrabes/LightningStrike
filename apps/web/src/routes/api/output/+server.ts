import { error, json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	RemoteClock,
	RoomDirector,
	RowClock,
	buildGeometry,
	compileGenerated,
	roomRegions,
	type LedSink,
	type RoomRegion,
	type RoomSync,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { analysisPath, isValidId, preparedNarration, showPath } from '@mv/analysis';
import {
	DDP_PORT,
	SACN_PIXELS_PER_UNIVERSE,
	SACN_PORT,
	createDdpSink,
	createSacnSink,
	type DdpTarget
} from '@mv/transport';
import { DEFAULT_OUTPUT_FPS, isWireProtocol, type WireProtocol } from '$lib/hardware.ts';
import { rowBundle } from '$lib/evening/bundle.ts';
import { currentItem, type QueueItem } from '$lib/queueModel.ts';
import { evening } from '$lib/server/evening/store.ts';
import { queue } from '$lib/server/queueStore.ts';
import { hardware, packedHosts } from '$lib/server/hardware.ts';
import { settings, type PublicSettings } from '$lib/server/settings.ts';
import { isLocal } from '$lib/server/access.ts';
import type { RequestHandler } from './$types';

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

/**
 * Render deterministic shows server-side for UDP output; the browser supplies the audio
 * position and the decisions its own director made, so both rooms agree.
 */
class Output {
	private geometry = buildGeometry(DEFAULT_ROOM);
	private registry = new EffectRegistry();
	private director = new RoomDirector(this.geometry, this.registry);
	private readonly clock = new RemoteClock(SYNC_STALE_MS);
	private readonly rows = new RowClock(this.clock);
	private sink: LedSink | null = null;
	/** The Bounce Lamp's own stream, one pixel wide. */
	private bounce: LedSink | null = null;
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
	private fps = DEFAULT_OUTPUT_FPS;
	/** The show the director holds, so the same file is not restarted under a playing track. */
	private loadedShow = '';

	targets: DdpTarget[] = [];
	/** Which wire those targets are being addressed on, so the readout names the right port. */
	private protocol: WireProtocol = 'ddp';

	get running(): boolean {
		return this.timer !== null;
	}

	get status() {
		return {
			running: this.running,
			playing: this.clock.sounding(performance.now()),
			position: this.clock.position,
			frames: this.frames,
			resting: this.director.resting,
			scene: this.director.sceneName,
			/** What this room decided, for a browser that starts leading to adopt first. */
			room: this.director.sync(),
			targets: this.targets.map(
				(t) => `${t.host}:${t.port ?? (this.protocol === 'sacn' ? SACN_PORT : DDP_PORT)}`
			)
		};
	}

	apply(s: PublicSettings): void {
		this.lounge = s.lounge;
		this.rest = s.rest;
		this.director.ambientSettings = s.ambient;
		// Update the director directly so running output follows settings immediately.
		this.director.brightness = s.outputBrightness;
		this.director.contrast = s.outputContrast;
		this.director.lampBrightness = s.outputLampBrightness;
		// Restart the clock only when FPS changes; unrelated settings must not drop a frame.
		if (s.outputFps !== this.fps) {
			this.fps = s.outputFps;
			if (this.running) this.arm();
		}
	}

	load(analysis: TrackAnalysis, show: Show, dissolve?: number): void {
		// The queue and a stream start both load the current track; only a changed show counts.
		const key = JSON.stringify(show);
		if (key === this.loadedShow) return;
		this.loadedShow = key;
		this.registry.clearGenerated();
		for (const gen of show.generatedEffects) {
			const compiled = compileGenerated(gen, this.geometry);
			if (compiled.def) this.registry.add(compiled.def);
		}
		this.director.load(analysis, show, dissolve);
	}

	/** Clear the track while retaining the loop; a showless director enters ambient immediately. */
	clearShow(): void {
		this.registry.clearGenerated();
		this.director.clearShow();
		this.loadedShow = '';
		this.trackId = null;
	}

	/**
	 * Bounce uses a separate one-pixel DDP sink with independent PUSH/sequence and frame-device
	 * availability.
	 */
	async start(
		targets: DdpTarget[],
		offsetMs: number,
		protocol: WireProtocol,
		bounceHost?: string
	): Promise<void> {
		await this.stop();
		this.targets = targets;
		this.protocol = protocol;
		this.clock.trim(offsetMs / 1000);
		this.frames = 0;
		this.sink =
			protocol === 'sacn' ? createSacnSink({ targets: universesFor(targets) }) : createDdpSink({ targets });
		await this.sink.open();

		if (bounceHost) {
			this.bounce = createDdpSink({
				targets: [{ host: bounceHost, firstLed: 0, ledCount: 1, deviceFirstLed: 0 }]
			});
			await this.bounce.open();
		}
		this.arm();
	}

	/**
	 * Send directly from the render clock; a second sender duplicates work and its keepalive is
	 * unnecessary. Each frame is scheduled against an absolute deadline rather than on a fixed
	 * interval: setInterval accumulates its own rounding and delivers 58.7 fps where the same
	 * loop against deadlines delivers 60.0, measured on loopback with `tools/ddp-probe.ts`.
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
			this.sink?.send({
				rgb: this.director.bytes,
				dt,
				frameId: this.frames,
				presentAtMs: now
			});
			this.bounce?.send({
				rgb: this.director.bounce,
				dt,
				frameId: this.frames,
				presentAtMs: now
			});
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

	/**
	 * Apply trim during sync without restarting output; an absent value preserves the current
	 * trim. The browser's room decisions come along so the scenes and dissolves agree.
	 */
	sync(position: number, playing: boolean, offsetMs?: number, room?: RoomSync, roomAge = 0, key?: string, currentKey?: string): void {
		if (typeof offsetMs === 'number' && Number.isFinite(offsetMs)) this.clock.trim(offsetMs / 1000);
		if (room && roomAge <= FOLLOW_MAX_AGE) this.director.follow(room);
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
	 * Back to plain pixels, for the one case a start cannot ask about: a board that reverted to
	 * firmware older than the packed payload while the show was running. That board rejects the
	 * whole datagram, which is what `bad` counts. The next start asks it again.
	 */
	unpack(): void {
		for (const target of this.targets) target.packed = false;
	}

	async stop(): Promise<void> {
		this.generation++;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		await this.sink?.close();
		this.sink = null;
		await this.bounce?.close();
		this.bounce = null;
	}

	/** The track or evening row this output renders, so the queue can tell when to re-point. */
	trackId: string | null = null;

	/** A bail untagged the evening row this output renders; the same song carries on. */
	carriesOn(item: QueueItem): boolean {
		return !item.evening && this.trackId === `row:${item.key}` && this.director.player.loaded?.show.trackId === item.trackId;
	}
}

const output = new Output();

// Telemetry is the only place a board can say it did not understand the datagram at all.
hardware.subscribe((statuses) => {
	const frame = statuses.find((s) => s.role === 'frame');
	if ((frame?.telemetry?.bad ?? 0) > 0) output.unpack();
});

/**
 * Split all region spans across board shares, tracking contiguous device offsets even when a
 * ring region crosses its seam.
 */
function targetsFor(region: RoomRegion, hosts: string[], packed: ReadonlySet<string>): DdpTarget[] {
	const per = Math.ceil(region.count / hosts.length);
	const targets: DdpTarget[] = [];
	let taken = 0;

	for (const span of region.spans) {
		let offset = 0;
		while (offset < span.ledCount) {
			const host = Math.min(Math.floor(taken / per), hosts.length - 1);
			// Whichever runs out first: this span, or this host's share of the region.
			const room = Math.min(span.ledCount - offset, per * (host + 1) - taken);
			targets.push({
				host: hosts[host],
				firstLed: span.firstLed + offset,
				ledCount: room,
				deviceFirstLed: taken - host * per,
				packed: packed.has(hosts[host])
			});
			offset += room;
			taken += room;
		}
	}
	return targets;
}

/**
 * Use 170 pixels per universe so pixels never straddle boundaries. Universe IDs remain global
 * across boards for multicast addressing.
 */
function universesFor(targets: DdpTarget[]) {
	const firstForHost = new Map<string, number>();
	let next = 1;
	for (const t of targets) {
		if (firstForHost.has(t.host)) continue;
		firstForHost.set(t.host, next);
		const pixels = targets
			.filter((o) => o.host === t.host)
			.reduce((max, o) => Math.max(max, (o.deviceFirstLed ?? 0) + o.ledCount), 0);
		next += Math.ceil(pixels / SACN_PIXELS_PER_UNIVERSE);
	}
	return targets.map((t) => ({
		...t,
		port: t.port ?? SACN_PORT,
		universe: firstForHost.get(t.host) ?? 1
	}));
}

/** Load a track's analysis and show, or explain why it cannot be loaded. */
async function loadTrack(id: string): Promise<{ analysis: TrackAnalysis; show: Show } | null> {
	try {
		return {
			analysis: JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis,
			show: JSON.parse(await readFile(showPath(id), 'utf8')) as Show
		};
	} catch {
		return null;
	}
}

/** The browser's room decisions, taken only in the shape the director expects. */
function roomSyncFrom(value: unknown): RoomSync | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const o = value as Record<string, unknown>;
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
	const ambience = num(o.ambience);
	const stopped = num(o.stopped);
	const sceneCounter = num(o.sceneCounter);
	const sceneHeld = num(o.sceneHeld);
	const idleT = num(o.idleT);
	if (
		ambience === null ||
		stopped === null ||
		sceneCounter === null ||
		sceneHeld === null ||
		idleT === null ||
		typeof o.scene !== 'string'
	) {
		return undefined;
	}
	const exposure = num(o.exposure);
	return { ambience, stopped, scene: o.scene, sceneCounter, sceneHeld, idleT, ...(exposure !== null ? { exposure } : {}) };
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

export const GET: RequestHandler = async () => json(output.status);

export const POST: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the hardware belongs to the machine running the show');

	const body = (await event.request.json()) as {
		action: 'start' | 'stop' | 'sync';
		trackId?: string;
		hosts?: string[];
		offsetMs?: number;
		protocol?: string;
		position?: number;
		playing?: boolean;
		room?: unknown;
		roomAge?: number;
		key?: string;
	};

	if (body.action === 'stop') {
		await output.stop();
		hardware.setStreaming(false);
		return json(output.status);
	}

	if (body.action === 'sync') {
		const age = typeof body.roomAge === 'number' && body.roomAge >= 0 ? body.roomAge : Infinity;
		const key = typeof body.key === 'string' ? body.key : undefined;
		output.sync(body.position ?? 0, body.playing ?? false, body.offsetMs, roomSyncFrom(body.room), age, key, queue.snapshot.currentKey ?? undefined);
		return json(output.status);
	}

	if (!body.hosts?.length) error(400, 'at least one host required');

	/*
	 * Allow no track for pre-music ambient output; an explicitly requested missing show remains an
	 * error.
	 */
	const id = body.trackId ?? null;
	if (id !== null && !isValidId(id)) error(400, 'trackId is not a valid id');
	const loaded = id === null ? null : await loadTrack(id);
	if (id !== null && !loaded) error(404, 'no analysis or show cached for this track');

	// Load persisted settings at stream start; subscriptions report only subsequent changes.
	output.apply(await settings.read());
	const current = currentItem(await queue.ready());
	output.loungeOnly = current?.loungeOnly ?? false;
	const row = current?.evening && current.status === 'ready' ? await loadRow(current) : null;
	if (row && current) {
		output.load(row.analysis, row.show, row.dissolve);
		output.rowLounge = row.lounge;
		output.loungeOnly = (current.loungeOnly ?? false) || row.lounge;
		output.trackId = identityOf(current);
		output.arrive(current.key);
	} else if (loaded && id !== null) {
		output.load(loaded.analysis, loaded.show);
		output.rowLounge = false;
		output.trackId = id;
		output.arrive(current?.trackId === id ? current.key : null);
	} else {
		output.clearShow();
	}

	const regions = roomRegions(buildGeometry(DEFAULT_ROOM));
	const region = regions.find((r) => r.id === hardware.region) ?? regions[0];

	// The stored setting is the installation's, and the body may override it for one start.
	const protocol = isWireProtocol(body.protocol)
		? body.protocol
		: (await settings.read()).outputProtocol;
	const bounceHost = hardware.link('bounce').status.host;
	// Ask after the last stream has stopped: a probe competing with 60 fps of its own output can
	// lose, and a lost probe drops the board to plain pixels for the whole of the next show.
	await output.stop();
	// sACN has no packed type; only the boards this firmware speaks to over DDP get it.
	const packed = protocol === 'ddp' ? await packedHosts(body.hosts) : new Set<string>();
	await output.start(targetsFor(region, body.hosts, packed), body.offsetMs ?? 0, protocol, bounceHost);
	// The Frame readout follows the first host in a split fixture.
	hardware.link('frame').setHost(body.hosts[0]);
	hardware.setStreaming(true);
	return json(output.status);
};
