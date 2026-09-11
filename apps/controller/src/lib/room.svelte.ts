/** Apply edits optimistically, then reconcile from board replies and polls. */

import { DeviceClient, type Link } from './client.ts';
import { discover, type Found } from './discover.ts';
import { browserNet, type Net } from './net.ts';
import { displayName, type DeviceInfo, type LightState, type Patch } from './protocol.ts';

/** Slow enough to stay out of the way of a board serving one connection at a time. */
const POLL_MS = 4000;
const REMEMBERED_KEY = 'lightningstrike.controller.hosts';

type Phase = 'searching' | 'ready' | 'empty';

class Device {
	info = $state<DeviceInfo | null>(null);
	state = $state<LightState | null>(null);
	link = $state<Link>('idle');
	/** False once a poll has gone unanswered, true again the moment one lands. */
	online = $state(true);

	readonly client: DeviceClient;

	constructor(
		readonly host: string,
		info: DeviceInfo,
		net: Net
	) {
		this.info = info;
		this.client = new DeviceClient(host, net, {
			onState: (s) => {
				this.state = s;
				this.online = true;
			},
			onLink: (l) => {
				this.link = l;
				if (l === 'ok') this.online = true;
				if (l === 'lost') this.online = false;
			}
		});
	}

	get title(): string {
		return displayName(this.info, this.host);
	}

	/** What this fixture actually runs. The lamp has one effect; the frame has three. */
	get effects(): string[] {
		return this.info?.effects ?? [];
	}

	apply(patch: Patch): void {
		if (this.state) this.state = { ...this.state, ...patch };
		this.client.send(patch);
	}

	/**
	 * An edit's reply carries fresher state; do not consume a board listener with a concurrent
	 * poll.
	 */
	async poll(): Promise<void> {
		if (this.client.busy) return;
		const state = await this.client.readState();
		if (!state) this.online = false;
	}
}

function remembered(): string[] {
	try {
		const raw = localStorage.getItem(REMEMBERED_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : [];
	} catch {
		return [];
	}
}

function remember(hosts: readonly string[]): void {
	try {
		localStorage.setItem(REMEMBERED_KEY, JSON.stringify(hosts));
	} catch {
		// Private browsing, a full quota: worth nothing, worth failing over.
	}
}

export class Room {
	devices = $state<Device[]>([]);
	selectedHost = $state('');
	phase = $state<Phase>('searching');
	sweeping = $state(false);

	private timer: ReturnType<typeof setInterval> | null = null;
	private scan: AbortController | null = null;

	constructor(private readonly net: Net = browserNet) {}

	get selected(): Device | null {
		return this.devices.find((d) => d.host === this.selectedHost) ?? null;
	}

	select(host: string): void {
		this.selectedHost = host;
		void this.selected?.poll();
	}

	/** Match firmware names so DHCP changes and name/IP aliases replace the same device. */
	private absorb(found: Found): Device {
		const sameHost = this.devices.find((d) => d.host === found.host);
		if (sameHost) return sameHost;

		const device = new Device(found.host, found.info, this.net);
		const stale = this.devices.findIndex((d) => d.info?.name === found.info.name);
		if (stale === -1) {
			this.devices = [...this.devices, device];
		} else {
			const previous = this.devices[stale] as Device;
			this.devices = this.devices.with(stale, device);
			if (this.selectedHost === previous.host) this.selectedHost = device.host;
		}

		if (this.selectedHost === '') this.selectedHost = device.host;
		void device.poll();
		return device;
	}

	/** Discovery, from scratch. Safe to call again from the interface. */
	async search(): Promise<void> {
		this.scan?.abort();
		const scan = new AbortController();
		this.scan = scan;
		this.phase = 'searching';

		await discover({
			net: this.net,
			origin: location.hostname,
			remembered: remembered(),
			onFound: (found) => void this.absorb(found),
			onSweeping: (s) => (this.sweeping = s),
			signal: scan.signal
		});

		if (scan.signal.aborted) return;
		this.phase = this.devices.length > 0 ? 'ready' : 'empty';
		remember(this.devices.map((d) => d.host));
	}

	/** For a board the scan could not reach - a different subnet, or a guessed name. */
	async addByHost(host: string): Promise<boolean> {
		const trimmed = host.trim();
		if (trimmed === '') return false;

		const info = await new DeviceClient(trimmed, this.net, {
			onState: () => {},
			onLink: () => {}
		}).info();
		if (!info) return false;

		const device = this.absorb({ host: trimmed, info });
		this.phase = 'ready';
		this.select(device.host);
		remember(this.devices.map((d) => d.host));
		return true;
	}

	/** Poll only the selected light while the page is visible. */
	watch(): () => void {
		const tick = (): void => {
			if (document.visibilityState === 'visible') void this.selected?.poll();
		};
		this.timer = setInterval(tick, POLL_MS);
		document.addEventListener('visibilitychange', tick);
		return () => {
			if (this.timer !== null) clearInterval(this.timer);
			document.removeEventListener('visibilitychange', tick);
			this.scan?.abort();
		};
	}
}
