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
 * Browser syncs arrive every 500 ms; expire missing syncs so a closed tab eventually rests the
 * room.
 */
const SYNC_STALE_MS = 3000;

/**
 * Render deterministic shows server-side for UDP output; the browser supplies only audio
 * position.
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

	load(analysis: TrackAnalysis, show: Show): void {
		this.registry.clearGenerated();
		for (const gen of show.generatedEffects) {
			const compiled = compileGenerated(gen, this.geometry);
			if (compiled.def) this.registry.add(compiled.def);
		}
		this.director.load(analysis, show);
	}

	/** Clear the track while retaining the loop; a showless director enters ambient immediately. */
	clearShow(): void {
		this.registry.clearGenerated();
		this.director.clearShow();
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
	 * Send directly from the render clock; a second sender duplicates work and its keepalive is
	 * unnecessary.
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
	 * Apply trim during sync without restarting output; an absent value preserves the current
	 * trim.
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
 * Split all region spans across board shares, tracking contiguous device offsets even when a
 * ring region crosses its seam.
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

/** Follow the server queue directly so track changes need no browser relay. */
queue.subscribe((state) => {
	if (!output.running) return;
	const item = currentItem(state);
	// Refresh trust before same-track early returns so the host override applies immediately.
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
	 * Allow no track for pre-music ambient output; an explicitly requested missing show remains an
	 * error.
	 */
	const id = body.trackId ?? null;
	if (id !== null && !isValidId(id)) error(400, 'trackId is not a valid id');
	const loaded = id === null ? null : await loadTrack(id);
	if (id !== null && !loaded) error(404, 'no analysis or show cached for this track');

	// Load persisted settings at stream start; subscriptions report only subsequent changes.
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
	// The Frame readout follows the first host in a split fixture.
	hardware.link('frame').setHost(body.hosts[0]);
	hardware.setStreaming(true);
	return json(output.status);
};
