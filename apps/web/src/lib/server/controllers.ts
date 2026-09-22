import { createSocket, type Socket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { PACK_VERSION } from '@mv/transport';
import type { ControllerState, ControllerStatus } from '$lib/controllers.ts';
import {
	capacityFault,
	faultsIn,
	parseIdentity,
	parseTelemetry,
	type DeviceIdentity,
	type DeviceTelemetry
} from '$lib/hardware.ts';
import type { Controller } from '$lib/rooms.ts';
import { parseWledInfo, wledNotes, type WledInfo } from '$lib/wled.ts';

const DDP_PORT = 4048;
const STATS_PORT = 4049;
const HELLO = Buffer.from('?room-node');
const PROBE_INTERVAL_MS = 4000;
const PROBE_TIMEOUT_MS = 900;
const WLED_TIMEOUT_MS = 1500;
const RESOLVE_TIMEOUT_MS = 2000;
/** A stats line arrives every second, so two missed ones is a stream that has stopped. */
const TELEMETRY_STALE_MS = 2600;

type Listener = (statuses: ControllerStatus[]) => void;

/**
 * What the app knows about one controller: whether it answers, what it says about itself and,
 * for a LightningStrike board, what actually arrived. A generic receiver never answers, so all
 * that can be said of it is that frames are going out.
 */
class ControllerLink {
	controller: Controller;
	/** Pixels this room sends it, which its own capacity or LED count is checked against. */
	pixels = 0;
	address = '';
	private streaming = false;
	private probing = false;
	/** Whether any probe of this address has finished, so a repeat one does not read as looking. */
	private probed = false;
	private answered = false;
	private identity: DeviceIdentity | null = null;
	private telemetry: DeviceTelemetry | null = null;
	private wled: WledInfo | null = null;
	private latencyMs: number | null = null;

	constructor(
		controller: Controller,
		private readonly onChange: () => void
	) {
		this.controller = controller;
	}

	/** A changed address or kind is a different controller as far as anything learned goes. */
	update(controller: Controller, pixels: number): void {
		const moved = controller.host !== this.controller.host || controller.kind !== this.controller.kind;
		this.controller = controller;
		this.pixels = pixels;
		if (moved) {
			// A probe of the old address still out returns without touching any of this.
			this.probing = false;
			this.address = '';
			this.probed = false;
			this.answered = false;
			this.identity = null;
			this.telemetry = null;
			this.wled = null;
			this.latencyMs = null;
			void this.probe();
		}
	}

	setStreaming(on: boolean): void {
		if (on === this.streaming) return;
		this.streaming = on;
		if (!on) this.telemetry = null;
		this.onChange();
	}

	takeTelemetry(telemetry: DeviceTelemetry): void {
		this.telemetry = telemetry;
		this.onChange();
	}

	get status(): ControllerStatus {
		return {
			id: this.controller.id,
			state: this.state,
			address: this.address,
			identity: this.identity,
			telemetry: this.fresh,
			wled: this.wled,
			latencyMs: this.latencyMs,
			notes: this.notes
		};
	}

	private get fresh(): DeviceTelemetry | null {
		if (!this.telemetry) return null;
		return Date.now() - this.telemetry.at < TELEMETRY_STALE_MS ? this.telemetry : null;
	}

	private get state(): ControllerState {
		if (!this.controller.host) return 'unconfigured';
		const { kind } = this.controller;
		if (kind === 'lightningstrike') {
			const telemetry = this.fresh;
			if (telemetry) return faultsIn(telemetry).length > 0 ? 'degraded' : 'streaming';
		}
		if (kind === 'wled' && this.wled && this.streaming) {
			// Until its next answer shows our frames arriving it reads as sending, not as trouble.
			if (this.wled.live && this.wled.liveFrom && !ourAddresses().includes(this.wled.liveFrom)) return 'degraded';
			return this.wled.live ? 'streaming' : 'sending';
		}
		if (this.answered) return this.streaming ? 'sending' : 'online';
		if (this.probing && !this.probed) return 'searching';
		if (kind !== 'lightningstrike' && kind !== 'wled' && this.address) return this.streaming ? 'sending' : 'online';
		return 'offline';
	}

	private get notes(): string[] {
		const notes: string[] = [];
		const { kind, host } = this.controller;
		if (!host) return notes;
		const settled = this.probed || !this.probing;
		if (settled && !this.address) notes.push(`Nothing on the network answers to "${host}".`);
		else if (settled && !this.answered && (kind === 'lightningstrike' || kind === 'wled')) {
			notes.push(`No answer from ${host}. Check that it is on and on this network.`);
		}
		if (kind === 'lightningstrike') {
			const fault = capacityFault(this.identity, this.pixels);
			if (fault) notes.push(fault);
			const telemetry = this.fresh;
			if (telemetry) notes.push(...faultsIn(telemetry).map((f) => `Arriving with ${f}.`));
		}
		if (kind === 'wled' && this.wled) notes.push(...wledNotes(this.wled, this.pixels, ourAddresses()));
		return notes;
	}

	/** Ask who it is, by the means its kind answers to. Leaves the link alone if it moved meanwhile. */
	async probe(): Promise<void> {
		const { host, kind } = this.controller;
		if (!host || this.probing) return;
		this.probing = true;
		this.onChange();
		const started = Date.now();
		const address = await resolve(host);
		if (host !== this.controller.host) return;
		this.address = address ?? '';

		if (address && kind === 'lightningstrike') {
			const answer = await hello(address, PROBE_TIMEOUT_MS);
			this.identity = answer?.identity ?? null;
			this.answered = answer !== null;
		} else if (address && kind === 'wled') {
			this.wled = await wledInfo(address);
			this.answered = this.wled !== null;
		} else {
			this.answered = false;
		}
		if (host !== this.controller.host) return;
		this.latencyMs = this.answered ? Date.now() - started : null;
		this.probing = false;
		this.probed = true;
		this.onChange();
	}

	/** Packed frames go only to a board that says, now, that it decodes them. */
	async packs(): Promise<boolean> {
		if (this.controller.kind !== 'lightningstrike' || !this.address) return false;
		const answer = await hello(this.address, PROBE_TIMEOUT_MS);
		return answer?.identity.packVersion === PACK_VERSION;
	}
}

/** One link per controller of the room that plays, with the stats port shared between boards. */
class Controllers {
	private links = new Map<string, ControllerLink>();
	private readonly listeners = new Set<Listener>();
	private stats: Socket | null = null;
	private probeTimer: NodeJS.Timeout | null = null;
	private watchers = 0;

	get statuses(): ControllerStatus[] {
		return [...this.links.values()].map((l) => l.status);
	}

	link(id: string): ControllerLink | undefined {
		return this.links.get(id);
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private publish(): void {
		const statuses = this.statuses;
		for (const listener of this.listeners) listener(statuses);
	}

	/** Follow the room that plays: its controllers, and how many pixels each is sent. */
	use(controllers: readonly Controller[], pixels: ReadonlyMap<string, number>): void {
		const next = new Map<string, ControllerLink>();
		for (const c of controllers) {
			const link = this.links.get(c.id) ?? new ControllerLink(c, () => this.publish());
			const fresh = !this.links.has(c.id);
			link.update(c, pixels.get(c.id) ?? 0);
			if (fresh) void link.probe();
			next.set(c.id, link);
		}
		this.links = next;
		this.publish();
	}

	setStreaming(on: boolean): void {
		for (const link of this.links.values()) link.setStreaming(on);
		if (on) this.openStats();
		else this.closeStats();
	}

	/** Probe while someone is looking or the room is playing; count viewers so one tab leaving is not all. */
	watch(): () => void {
		this.watchers++;
		this.arm();
		return () => {
			this.watchers = Math.max(0, this.watchers - 1);
			this.arm();
		};
	}

	private arm(): void {
		const wanted = this.watchers > 0 || this.stats !== null;
		if (wanted && this.probeTimer === null) {
			this.probeTimer = setInterval(() => {
				for (const link of this.links.values()) void link.probe();
			}, PROBE_INTERVAL_MS);
		} else if (!wanted && this.probeTimer !== null) {
			clearInterval(this.probeTimer);
			this.probeTimer = null;
		}
	}

	/** Hold the stats port only while streaming, attributing each line by who sent it. */
	private openStats(): void {
		if (this.stats) return;
		const socket = createSocket({ type: 'udp4', reuseAddr: true });
		this.stats = socket;
		socket.on('message', (buf, rinfo) => {
			const telemetry = parseTelemetry(buf.toString(), Date.now());
			if (!telemetry) return;
			const link = [...this.links.values()].find(
				(l) => l.controller.kind === 'lightningstrike' && l.address === rinfo.address
			);
			link?.takeTelemetry(telemetry);
		});
		// Losing the port is not worth taking output down for; it only costs the readout.
		socket.on('error', () => this.closeStats());
		socket.bind(STATS_PORT);
		const tick = setInterval(() => this.publish(), 1000);
		socket.once('close', () => clearInterval(tick));
		this.arm();
	}

	private closeStats(): void {
		this.stats?.close();
		this.stats = null;
		this.arm();
	}
}

/** The first IPv4 address a name resolves to, or null when it does not in good time. */
export async function resolve(host: string): Promise<string | null> {
	if (isIPv4(host)) return host;
	try {
		const answer = await Promise.race([
			lookup(host, { family: 4 }),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), RESOLVE_TIMEOUT_MS))
		]);
		return answer.address;
	} catch {
		return null;
	}
}

/** This machine's own addresses, which is how a WLED says the app is the one sending to it. */
export function ourAddresses(): string[] {
	return Object.values(networkInterfaces())
		.flat()
		.filter((i) => i && i.family === 'IPv4')
		.map((i) => i!.address);
}

interface Answer {
	identity: DeviceIdentity;
	address: string;
}

/** A board answers `?room-node` to the port the query came from, so no listener is needed. */
export function hello(host: string, timeoutMs: number): Promise<Answer | null> {
	return new Promise((done) => {
		let socket: Socket;
		try {
			socket = createSocket('udp4');
		} catch {
			done(null);
			return;
		}
		let settled = false;
		const finish = (value: Answer | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				socket.close();
			} catch {
				// Already closed by the error path.
			}
			done(value);
		};
		const timer = setTimeout(() => finish(null), timeoutMs);
		socket.on('message', (buf, rinfo) => {
			const identity = parseIdentity(buf.toString(), host);
			if (identity) finish({ identity, address: rinfo.address });
		});
		socket.on('error', () => finish(null));
		socket.send(HELLO, DDP_PORT, host, (err) => {
			if (err) finish(null);
		});
	});
}

export async function wledInfo(address: string): Promise<WledInfo | null> {
	try {
		const res = await fetch(`http://${address}/json/info`, { signal: AbortSignal.timeout(WLED_TIMEOUT_MS) });
		return res.ok ? parseWledInfo(await res.json()) : null;
	} catch {
		return null;
	}
}

export const controllers = new Controllers();
