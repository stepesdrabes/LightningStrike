import { error, json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	RoomDirector,
	buildGeometry,
	compileGenerated,
	roomRegions,
	type LedSink,
	type RoomRegion,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { analysisPath, isValidId, showPath } from '@mv/analysis';
import {
	DDP_PORT,
	SACN_PIXELS_PER_UNIVERSE,
	SACN_PORT,
	createDdpSink,
	createSacnSink,
	type DdpTarget
} from '@mv/transport';
import { DEFAULT_OUTPUT_FPS, isWireProtocol, type WireProtocol } from '$lib/hardware.ts';
import { currentItem } from '$lib/queueModel.ts';
import { queue } from '$lib/server/queueStore.ts';
import { hardware } from '$lib/server/hardware.ts';
import { settings, type PublicSettings } from '$lib/server/settings.ts';
import { isLocal } from '$lib/server/access.ts';
import type { RequestHandler } from './$types';

/**
 * How long a sync may be missing before the room stops believing the music is playing.
 *
 * A browser posts one every 500 ms while it has the tab open. Closing the tab therefore looks
 * exactly like a track that never ends, and the room used to hold that last cue for as long as the
 * process lived. Two missed syncs is a tab that has gone, and a room that has gone with it should
 * rest rather than freeze.
 */
const SYNC_STALE_MS = 3000;

/**
 * Hardware output runs its own copy of the show, server-side.
 *
 * The browser cannot open a UDP socket, and streaming 60 frames a second of pixels over a
 * socket to the server would be silly when the show is fully deterministic: given the same
 * analysis, the same show and the same position, this renders bit-identical bytes to the
 * preview. So the browser only reports where the audio actually is, and the room keeps
 * running even if the tab goes away.
 */
class Output {
	private geometry = buildGeometry(DEFAULT_ROOM);
	private registry = new EffectRegistry();
	private director = new RoomDirector(this.geometry, this.registry);
	private sink: LedSink | null = null;
	/** The Bounce Lamp's own stream, one pixel wide. */
	private bounce: LedSink | null = null;
	private timer: NodeJS.Timeout | null = null;

	private position = 0;
	private syncedAt = 0;
	private playing = false;
	private offsetMs = 0;
	private frames = 0;
	private lounge = false;
	/** The current track's own verdict: its grid is lost, so lounge carries it. */
	loungeOnly = false;
	private rest = true;
	private fps = DEFAULT_OUTPUT_FPS;

	targets: DdpTarget[] = [];
	/** Which wire those targets are being addressed on, so the readout names the right port. */
	private protocol: WireProtocol = 'ddp';

	get running(): boolean {
		return this.timer !== null;
	}

	/** What a browser is telling us, or nothing at all if it has stopped telling us anything. */
	private get sounding(): boolean {
		return this.playing && performance.now() - this.syncedAt < SYNC_STALE_MS;
	}

	get status() {
		return {
			running: this.running,
			playing: this.sounding,
			position: this.position,
			frames: this.frames,
			resting: this.director.resting,
			scene: this.director.sceneName,
			targets: this.targets.map(
				(t) => `${t.host}:${t.port ?? (this.protocol === 'sacn' ? SACN_PORT : DDP_PORT)}`
			)
		};
	}

	apply(s: PublicSettings): void {
		this.lounge = s.lounge;
		this.rest = s.rest;
		this.director.ambientSettings = s.ambient;
		// Straight onto the director, which re-reads them every frame, so a slider moves the room
		// under a running show rather than at the next track.
		this.director.brightness = s.outputBrightness;
		this.director.contrast = s.outputContrast;
		this.director.lampBrightness = s.outputLampBrightness;
		// The interval is the clock, so a new rate means a new interval. Only when it has actually
		// changed: re-arming on every settings write would drop a frame each time a slider moved.
		if (s.outputFps !== this.fps) {
			this.fps = s.outputFps;
			if (this.running) this.arm();
		}
	}

	load(analysis: TrackAnalysis, show: Show): void {
		this.registry.clearGenerated();
		for (const gen of show.generatedEffects) {
			const compiled = compileGenerated(gen, this.geometry);
			if (compiled.def) this.registry.add(compiled.def);
		}
		this.director.load(analysis, show);
	}

	/**
	 * Forget the track without stopping the room.
	 *
	 * A board joined with nothing playing has no show to render, and a director with none takes
	 * the ambient scenes immediately rather than waiting out the rest grace.
	 */
	clearShow(): void {
		this.registry.clearGenerated();
		this.director.clearShow();
		this.trackId = null;
	}

	/**
	 * `bounceHost` gets its own sink rather than a target on the first one.
	 *
	 * They are two devices: independent PUSH, independent sequence, and a lamp that keeps working
	 * when the boards driving the frame are unplugged. It is always DDP - one pixel is not worth
	 * a universe - and it is skipped entirely when no lamp is configured.
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
		this.offsetMs = offsetMs;
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
	 * (Re)start the render clock.
	 *
	 * This loop is the only clock, and it sends directly. A separate re-clocking sender on top
	 * would double the per-frame work in one event loop and cost a third of the frame rate; the
	 * keep-alive it exists to provide is already inherent here, because this loop runs whether or
	 * not a browser is attached.
	 */
	private arm(): void {
		if (this.timer) clearInterval(this.timer);
		let last = performance.now();
		this.timer = setInterval(() => {
			const now = performance.now();
			const dt = Math.min((now - last) / 1000, 0.05);
			last = now;
			const sounding = this.sounding;
			const t = sounding
				? this.position + (now - this.syncedAt) / 1000 + this.offsetMs / 1000
				: this.position;
			this.director.update(Math.max(0, t), dt, {
				playing: sounding,
				hasShow: this.director.player.loaded !== null,
				lounge: this.lounge || this.loungeOnly,
				rest: this.rest
			});
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
		}, 1000 / this.fps);
	}

	/**
	 * The trim rides along on the sync rather than needing the stream restarted, so it can be
	 * dialled against the real strips while they are lit. Undefined leaves it alone: a sync that
	 * does not mention it is not asking for zero.
	 */
	sync(position: number, playing: boolean, offsetMs?: number): void {
		this.position = position;
		this.playing = playing;
		this.syncedAt = performance.now();
		if (typeof offsetMs === 'number' && Number.isFinite(offsetMs)) this.offsetMs = offsetMs;
	}

	async stop(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		await this.sink?.close();
		this.sink = null;
		await this.bounce?.close();
		this.bounce = null;
	}

	/** Which track this output is currently rendering, so the queue can tell when to re-point. */
	trackId: string | null = null;
}

const output = new Output();

/**
 * Cut a region up between however many boards are driving it.
 *
 * Two kinds of cut meet here and neither is optional. A region can already be several runs of
 * the frame, because the perimeter is a ring and a corner can straddle its seam; and however
 * many runs that is, several boards split the total between them. So this walks the region's
 * pixels once and hands each board a contiguous stretch of its own buffer, which is why
 * `deviceFirstLed` is tracked per host rather than assumed to be zero.
 *
 * Several boards at all because WS2812 is 30 us per LED, so 1320 on one data line caps at
 * 25 Hz and 60 fps needs roughly one output per strip.
 */
function targetsFor(region: RoomRegion, hosts: string[]): DdpTarget[] {
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
				deviceFirstLed: taken - host * per
			});
			offset += room;
			taken += room;
		}
	}
	return targets;
}

/**
 * Lay the same cut out as sACN universes.
 *
 * They run on across the whole fixture rather than restarting at each board, because a universe
 * is a global address once the packets go to a multicast group: two controllers both claiming
 * universe 1 is one room lit twice and the other half dark. 170 pixels each, so a pixel never
 * straddles the boundary.
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

/**
 * The hardware follows the queue on its own.
 *
 * The queue is server state and so is this, so there is no reason for a track change to have
 * to round-trip through a browser. It also means the room keeps up with a skip made from
 * somebody's phone even when no tab is open.
 */
queue.subscribe((state) => {
	if (!output.running) return;
	const item = currentItem(state);
	// Before the track-change early-outs: the flag can change on the row that is already
	// playing, which is exactly what the override button does.
	output.loungeOnly = item?.loungeOnly ?? false;
	const id = item?.trackId ?? null;
	if (!id || id === output.trackId) return;
	void loadTrack(id).then((loaded) => {
		if (!loaded || !output.running) return;
		output.load(loaded.analysis, loaded.show);
		output.trackId = id;
		// A new track starts at its own beginning, not wherever the last one had got to.
		output.sync(0, false);
	});
});

/**
 * Lounge and the resting colour reach the strips without a browser relaying them.
 *
 * They are settings rather than queue state, and settings are fetched once at mount, so a change
 * made in one tab would otherwise never arrive here at all - and with no tab open there would be
 * nothing to relay it.
 */
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
	};

	if (body.action === 'stop') {
		await output.stop();
		hardware.setStreaming(false);
		return json(output.status);
	}

	if (body.action === 'sync') {
		output.sync(body.position ?? 0, body.playing ?? false, body.offsetMs);
		return json(output.status);
	}

	if (!body.hosts?.length) error(400, 'at least one host required');

	/*
	 * A track is optional.
	 *
	 * Connecting a board is about the room, not about a song: somebody arriving before the music
	 * has started should get the resting scenes on their strips rather than a 400 telling them to
	 * queue something first. A named track that has no show cached is still an error, because that
	 * one is a request the server cannot honour rather than a room with nothing playing.
	 */
	const id = body.trackId ?? null;
	if (id !== null && !isValidId(id)) error(400, 'trackId is not a valid id');
	const loaded = id === null ? null : await loadTrack(id);
	if (id !== null && !loaded) error(404, 'no analysis or show cached for this track');

	// The stream may be started long after the settings were last written, and the subscriptions
	// above only ever hear changes. This is where it catches up with what is already stored.
	output.apply(await settings.read());
	output.loungeOnly = currentItem(await queue.ready())?.loungeOnly ?? false;
	if (loaded && id !== null) {
		output.load(loaded.analysis, loaded.show);
		output.trackId = id;
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
	await output.start(targetsFor(region, body.hosts), body.offsetMs ?? 0, protocol, bounceHost);
	// The first host is the one The Frame's readout is about: a board only reports to whoever
	// sends it DDP, so on a split fixture each would need its own listener and its own port.
	hardware.link('frame').setHost(body.hosts[0]);
	hardware.setStreaming(true);
	return json(output.status);
};
