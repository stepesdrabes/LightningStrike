import type { DeviceIdentity, DeviceTelemetry } from './hardware.ts';
import type { ControllerKind } from './rooms.ts';
import type { WledInfo } from './wled.ts';

/**
 * `sending` is a controller that never reports back, which is as much as the app can know about
 * a generic DDP, sACN or Art-Net receiver while it streams.
 */
export type ControllerState =
	| 'unconfigured'
	| 'searching'
	| 'offline'
	| 'online'
	| 'streaming'
	| 'degraded'
	| 'sending';

export interface ControllerStatus {
	id: string;
	state: ControllerState;
	/** The address it answered from, which its name may not be. */
	address: string;
	/** A LightningStrike board's own account of itself. */
	identity: DeviceIdentity | null;
	/** A LightningStrike board's last second of what arrived. */
	telemetry: DeviceTelemetry | null;
	wled: WledInfo | null;
	/** Round trip of the last answer, ms. */
	latencyMs: number | null;
	/** What needs attention, in words. */
	notes: string[];
}

/** The live side of the room: whether it plays, and how each of its controllers is doing. */
export interface OutputStatus {
	running: boolean;
	room: string;
	controllers: ControllerStatus[];
}

/** A controller heard on the network, with whatever it said about itself. */
export interface Found {
	kind: ControllerKind;
	/** The address it answered from. */
	host: string;
	name: string;
	mac?: string;
	/** LEDs it drives, or was built for. */
	pixels?: number;
	matrix?: { width: number; height: number };
	white?: boolean;
	firmware?: string;
	/** Art-Net: the Port-Address of its first output. */
	universe?: number;
}

export const STATE_WORDS: Record<ControllerState, string> = {
	unconfigured: 'No address',
	searching: 'Looking',
	offline: 'Offline',
	online: 'Ready',
	streaming: 'Live',
	degraded: 'Live, with trouble',
	sending: 'Sending'
};

/** The whole room in one state, worst first, for a dot that stands for all its controllers. */
export function roomState(statuses: readonly ControllerStatus[], running: boolean): ControllerState {
	const states = statuses.map((s) => s.state).filter((s) => s !== 'unconfigured');
	if (states.length === 0) return 'unconfigured';
	if (states.includes('degraded')) return 'degraded';
	if (states.includes('offline')) return 'offline';
	if (running) return states.includes('streaming') ? 'streaming' : 'sending';
	return states.includes('searching') ? 'searching' : 'online';
}
