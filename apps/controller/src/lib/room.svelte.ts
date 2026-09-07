/**
 * Every light the app has found, and which one is on screen.
 *
 * The board is the authority: an edit is applied locally so the control moves under the finger,
 * and then overwritten by whatever the board answers. A poll does the same for changes made
 * somewhere else - another phone, a show starting, a wall switch.
 */

import { DeviceClient, type Link } from './client.ts';
import { discover, type Found } from './discover.ts';
import { browserNet, type Net } from './net.ts';
import { displayName, type DeviceInfo, type LightState, type Patch } from './protocol.ts';

/** Slow enough to stay out of the way of a board serving one connection at a time. */
const POLL_MS = 4000;
const REMEMBERED_KEY = 'lightningstrike.controller.hosts';

export type Phase = 'searching' | 'ready' | 'empty';

export class Device {
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

	/**
	 * Applied locally first so the control answers the finger, then corrected by the board.
	 * Every field here is one the board echoes back, so a rejected value cannot stick.
	 */
	apply(patch: Patch): void {
		if (this.state) this.state = { ...this.state, ...patch };
		this.client.send(patch);
	}

	async poll(): Promise<void> {
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

	/**
	 * Files a board under its name rather than the address it answered on.
	 *
	 * A rescan reaches the same light at a name it resolved under last time and at the address it
	 * holds now, so address alone would list it twice; and a light that moved on DHCP has to
	 * replace its old entry rather than sit beside a dead one.
	 */
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

	/**
	 * Only the light on screen is polled, and only while the page is being looked at. A phone in
	 * a pocket has no business waking a board once a second.
	 */
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
