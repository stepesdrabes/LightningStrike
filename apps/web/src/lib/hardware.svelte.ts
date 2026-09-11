import { DEVICE_ROLES, type DeviceRole, type HardwareStatus } from './hardware.ts';

function idle(role: DeviceRole): HardwareStatus {
	return {
		role,
		host: '',
		region: 'all',
		state: 'unconfigured',
		streaming: false,
		identity: null,
		telemetry: null,
		latencyMs: null,
		message: ''
	};
}

/** Reflect board reports from server-owned sockets without optimistic updates. */
export class HardwareClient {
	statuses = $state<HardwareStatus[]>(DEVICE_ROLES.map(idle));

	private source: EventSource | null = null;

	/** The Frame, which is what the top-bar chip is about: it is the room. */
	get status(): HardwareStatus {
		return this.of('frame');
	}

	of(role: DeviceRole): HardwareStatus {
		return this.statuses.find((s) => s.role === role) ?? idle(role);
	}

	connect(): void {
		if (this.source) return;
		const es = new EventSource('/api/hardware/stream');
		es.addEventListener('hardware', (ev) => {
			this.statuses = JSON.parse((ev as MessageEvent).data) as HardwareStatus[];
		});
		this.source = es;
	}

	dispose(): void {
		this.source?.close();
		this.source = null;
	}

	private post(body: Record<string, unknown>): Promise<Response> {
		return fetch('/api/hardware', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	setHost(role: DeviceRole, host: string): Promise<Response> {
		return this.post({ action: 'set', role, host });
	}

	/** Which part of the room The Frame is fed. Read by output the next time it starts. */
	setRegion(region: string): Promise<Response> {
		return this.post({ action: 'set', role: 'frame', host: this.of('frame').host, region });
	}
}

/** What the status chip says, short enough for a top bar. */
export function linkLabel(status: HardwareStatus): string {
	switch (status.state) {
		case 'unconfigured':
			return 'No device';
		case 'searching':
			return 'Looking';
		case 'offline':
			return 'Offline';
		case 'online':
			return 'Ready';
		case 'degraded':
			return 'Dropping';
		case 'streaming':
			return `${(status.telemetry?.fps ?? 0).toFixed(0)} fps`;
	}
}

export function uptime(seconds: number): string {
	if (seconds < 60) return `${Math.floor(seconds)}s`;
	const m = Math.floor(seconds / 60);
	if (m < 60) return `${m}m ${Math.floor(seconds % 60)}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}
