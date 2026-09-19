import { createSocket, type Socket } from 'node:dgram';
import {
	DEVICE_ROLES,
	faultsIn,
	parseIdentity,
	parseTelemetry,
	type DeviceIdentity,
	type DeviceRole,
	type DeviceTelemetry,
	type HardwareStatus,
	type LinkState
} from '$lib/hardware.ts';
import { PACK_VERSION } from '@mv/transport';

const DDP_PORT = 4048;
const STATS_PORT = 4049;
const QUERY = Buffer.from('?room-node');

/** How often to ask a configured board whether it is there. */
const PROBE_INTERVAL_MS = 4000;
const PROBE_TIMEOUT_MS = 900;
/** A stats line arrives every second, so two missed ones is a stream that has stopped. */
const TELEMETRY_STALE_MS = 2600;

type Listener = (statuses: HardwareStatus[]) => void;

/**
 * Discovery reports reachability; DDP telemetry reports delivery health. Neither replaces the
 * other.
 */
class DeviceLink {
	private host = '';
	private regionId = 'all';
	private streaming = false;
	private identity: DeviceIdentity | null = null;
	private telemetry: DeviceTelemetry | null = null;
	private latencyMs: number | null = null;
	private message = '';
	private probing = false;
	/**
	 * Attribute shared-port telemetry by the board's reply IP, which may differ from its
	 * configured hostname.
	 */
	private address = '';

	constructor(
		private readonly role: DeviceRole,
		private readonly onChange: () => void
	) {}

	get region(): string {
		return this.regionId;
	}

	get configured(): boolean {
		return this.host !== '';
	}

	answersFrom(address: string): boolean {
		return this.host !== '' && (address === this.address || address === this.host);
	}

	get status(): HardwareStatus {
		return {
			role: this.role,
			host: this.host,
			region: this.regionId,
			state: this.state,
			streaming: this.streaming,
			identity: this.identity,
			telemetry: this.fresh,
			latencyMs: this.latencyMs,
			message: this.message
		};
	}

	/** Telemetry only counts as current while it keeps arriving. */
	private get fresh(): DeviceTelemetry | null {
		if (!this.telemetry) return null;
		return Date.now() - this.telemetry.at < TELEMETRY_STALE_MS ? this.telemetry : null;
	}

	private get state(): LinkState {
		if (!this.host) return 'unconfigured';
		const telemetry = this.fresh;
		if (telemetry) return faultsIn(telemetry).length > 0 ? 'degraded' : 'streaming';
		if (this.identity) return 'online';
		return this.probing ? 'searching' : 'offline';
	}

	private publish(): void {
		this.onChange();
	}

	/** Clearing a host also clears stale board identity. */
	setHost(host: string): void {
		const next = host.trim();
		if (next === this.host) return;
		this.host = next;
		this.identity = null;
		this.telemetry = null;
		this.latencyMs = null;
		this.address = '';
		this.message = '';
		this.publish();
		if (next) void this.probe();
	}

	/** Region changes apply when output restarts, avoiding mid-track jumps. */
	setRegion(id: string): void {
		if (id === this.regionId) return;
		this.regionId = id;
		this.publish();
	}

	setStreaming(on: boolean): void {
		if (on === this.streaming) return;
		this.streaming = on;
		if (!on) this.telemetry = null;
		this.publish();
	}

	takeTelemetry(telemetry: DeviceTelemetry): void {
		this.telemetry = telemetry;
		this.publish();
	}

	/** Ask this board who it is. Leaves the link alone if the address changed while it answered. */
	async probe(): Promise<void> {
		const host = this.host;
		if (!host) return;
		this.probing = true;
		this.publish();

		const started = Date.now();
		const answer = await ask(host, PROBE_TIMEOUT_MS);
		if (host !== this.host) return;

		this.probing = false;
		this.identity = answer?.identity ?? null;
		this.address = answer?.address ?? '';
		this.latencyMs = this.identity ? Date.now() - started : null;
		// Report silence only after a board has previously answered.
		this.message = this.identity ? '' : 'No answer from that address.';
		this.publish();
	}
}

/** Share fixed stats port 4049 across boards, attributing replies by source address. */
class Hardware {
	private readonly links: Record<DeviceRole, DeviceLink>;
	private listeners = new Set<Listener>();
	private stats: Socket | null = null;
	private probeTimer: NodeJS.Timeout | null = null;
	private watchers = 0;

	constructor() {
		const publish = () => this.publish();
		this.links = {
			frame: new DeviceLink('frame', publish),
			bounce: new DeviceLink('bounce', publish)
		};
	}

	link(role: DeviceRole): DeviceLink {
		return this.links[role];
	}

	get statuses(): HardwareStatus[] {
		return DEVICE_ROLES.map((role) => this.links[role].status);
	}

	/** Which part of the room The Frame is fed. The lamp has no region; it is fed a colour. */
	get region(): string {
		return this.links.frame.region;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private publish(): void {
		const statuses = this.statuses;
		for (const listener of this.listeners) listener(statuses);
	}

	setStreaming(on: boolean): void {
		for (const role of DEVICE_ROLES) this.links[role].setStreaming(on);
		if (on) this.openStats();
		else this.closeStats();
	}

	/** Count viewers so one tab closing cannot stop another tab's polling. */
	watch(): () => void {
		this.watchers++;
		if (this.probeTimer === null) {
			this.probeTimer = setInterval(() => this.probeAll(), PROBE_INTERVAL_MS);
			this.probeAll();
		}
		return () => {
			this.watchers = Math.max(0, this.watchers - 1);
			if (this.watchers > 0 || this.probeTimer === null) return;
			clearInterval(this.probeTimer);
			this.probeTimer = null;
		};
	}

	private probeAll(): void {
		for (const role of DEVICE_ROLES) void this.links[role].probe();
	}

	/** Hold the stats port only while streaming so standalone probes can use it when idle. */
	private openStats(): void {
		if (this.stats) return;
		const socket = createSocket({ type: 'udp4', reuseAddr: true });
		this.stats = socket;

		socket.on('message', (buf, rinfo) => {
			const telemetry = parseTelemetry(buf.toString(), Date.now());
			if (!telemetry) return;
			const link = DEVICE_ROLES.map((r) => this.links[r]).find((l) => l.answersFrom(rinfo.address));
			// With one configured board, accept otherwise unattributable replies from its resolved IP.
			const only = DEVICE_ROLES.map((r) => this.links[r]).filter((l) => l.configured);
			(link ?? (only.length === 1 ? only[0] : null))?.takeTelemetry(telemetry);
		});
		// Losing the port is not worth taking output down for; it only costs the readout.
		socket.on('error', () => this.closeStats());
		socket.bind(STATS_PORT);

		// Publish freshness expiry even when no packets arrive to trigger an update.
		const tick = setInterval(() => this.publish(), 1000);
		socket.once('close', () => clearInterval(tick));
	}

	private closeStats(): void {
		this.stats?.close();
		this.stats = null;
	}
}

interface Answer {
	identity: DeviceIdentity;
	/** Where the reply came from, which is how its stats lines are told from the other board's. */
	address: string;
}

/** Discovery replies to its query's source port and needs no persistent stats listener. */
function ask(host: string, timeoutMs: number): Promise<Answer | null> {
	return new Promise((resolve) => {
		let socket: Socket;
		try {
			socket = createSocket('udp4');
		} catch {
			resolve(null);
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
			resolve(value);
		};

		const timer = setTimeout(() => finish(null), timeoutMs);
		socket.on('message', (buf, rinfo) => {
			const identity = parseIdentity(buf.toString(), host);
			finish(identity && { identity, address: rinfo.address });
		});
		socket.on('error', () => finish(null));
		socket.send(QUERY, DDP_PORT, host, (err) => {
			if (err) finish(null);
		});
	});
}

export const hardware = new Hardware();

/**
 * Which of these boards can be sent packed frames, asked now rather than read from the last
 * probe: a board that reverted to older firmware must not be sent a payload it cannot decode.
 */
export async function packedHosts(hosts: readonly string[]): Promise<Set<string>> {
	const answers = await Promise.all(hosts.map((host) => ask(host, PROBE_TIMEOUT_MS)));
	return new Set(hosts.filter((_, i) => answers[i]?.identity.packVersion === PACK_VERSION));
}
