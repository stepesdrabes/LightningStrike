/** Tolerant ASCII firmware parsers; missing optional fields remain undefined. */

/**
 * Frame and bounce roles receive 673 and one pixel respectively, with separate addresses and
 * state.
 */
export type DeviceRole = 'frame' | 'bounce';
export const DEVICE_ROLES: readonly DeviceRole[] = ['frame', 'bounce'];

export const DEVICE_NAMES: Record<DeviceRole, string> = {
	frame: 'The Frame',
	bounce: 'Bounce Lamp'
};

export function isDeviceRole(v: unknown): v is DeviceRole {
	return DEVICE_ROLES.includes(v as DeviceRole);
}

/** Answer to a discovery query. Available whether or not anything is streaming. */
export interface DeviceIdentity {
	host: string;
	/** DHCP hostname the board offers, which is what the router lists it as. */
	name: string;
	firmware: string;
	uptimeS: number;
	/** Pixels this build can hold, not what it is being sent. */
	pixels: number;
	ddpPort: number;
	statsPort: number;
	/**
	 * Output kinds, joined with +: stub scores, monitor drives an indicator, lamp drives RGBW,
	 * ws2815 drives strips.
	 */
	leds: string;
	/**
	 * Packed-payload format the board decodes, 0 on firmware older than the field. The sink
	 * holds the version it writes; this only reports what the board said.
	 */
	packVersion: number;
}

/** Outputs that receive the whole fixture and light none of it. */
const DARK_OUTPUTS = new Set(['stub', 'monitor']);

/**
 * stub and monitor do not light the room. Any other output counts as lit, including future
 * firmware kinds.
 */
export function lightsRoom(identity: DeviceIdentity | null): boolean {
	if (identity === null) return false;
	return identity.leds.split('+').some((kind) => !DARK_OUTPUTS.has(kind));
}

/**
 * The board cuts each frame into its runs at the lengths it was built with, so a build made for
 * a different room does not reject the stream: it lands the far side of the fixture on the wrong
 * LEDs, and no counter downstream can see that. A region changes what the board is fed, never
 * what it was built to hold, so compare against the room. Firmware too old to report a capacity
 * says 0 and is left alone.
 */
export function capacityFault(identity: DeviceIdentity | null, room: number): string | null {
	if (identity === null || identity.pixels === 0 || identity.pixels === room) return null;
	return `Built for ${identity.pixels} pixels, but the room is ${room}. Reflash it, or the far side of the fixture lights the wrong LEDs.`;
}

/** One second of what actually arrived, reported by the board itself. */
export interface DeviceTelemetry {
	uptimeS: number;
	/** Largest frame seen, so it confirms how much of the fixture this board is being fed. */
	pixels: number;
	packetsPerSecond: number;
	kbPerSecond: number;
	/** PUSH flags per second. The headline number; 60 is the target. */
	fps: number;
	gapMinMs: number;
	gapMaxMs: number;
	/** Frames arriving more than 20 / 50 / 100 ms after the one before. */
	late: [number, number, number];
	assemblyMaxMs: number;
	/**
	 * Longest frame presentation, microseconds. WS2815 takes 30 us per LED against a 16.7 ms frame
	 * budget.
	 */
	ledMaxUs: number;
	seqGaps: number;
	bad: number;
	outOfRange: number;
	torn: number;
	/** When this line arrived, epoch ms, stamped by the receiver. */
	at: number;
}

const num = (line: string, re: RegExp): number | null => {
	const m = re.exec(line);
	return m ? Number(m[1]) : null;
};

/** The room-node prefix distinguishes discovery replies from unrelated devices. */
export function parseIdentity(line: string, host: string): DeviceIdentity | null {
	const text = line.trim();
	if (!text.startsWith('room-node')) return null;

	const word = (re: RegExp): string | null => {
		const m = re.exec(text);
		return m ? m[1] : null;
	};

	return {
		host,
		name: word(/\bhost\s+(\S+)/) ?? 'room-node',
		firmware: word(/\bfw\s+(\S+)/) ?? 'unknown',
		uptimeS: num(text, /\bup\s+(\d+)s/) ?? 0,
		pixels: num(text, /\bpx\s+(\d+)/) ?? 0,
		ddpPort: num(text, /\bddp\s+(\d+)/) ?? 4048,
		statsPort: num(text, /\bstats\s+(\d+)/) ?? 4049,
		leds: word(/\bleds\s+(\S+)/) ?? 'unknown',
		packVersion: num(text, /\bpack\s+(\d+)/) ?? 0
	};
}

/** Telemetry late counters are optional for older firmware. */
export function parseTelemetry(line: string, at: number): DeviceTelemetry | null {
	const text = line.trim();
	const fps = num(text, /([\d.]+)\s+fps/);
	// fps is the one field that makes a line a stats line rather than anything else on the port.
	if (fps === null) return null;

	const gap = /gap\s+([\d.]+)\/([\d.]+)\s+ms/.exec(text);
	const late = /late\s+(\d+)\/(\d+)\/(\d+)/.exec(text);

	return {
		uptimeS: num(text, /\bup\s+(\d+)s/) ?? 0,
		pixels: num(text, /(\d+)\s+px/) ?? 0,
		packetsPerSecond: num(text, /(\d+)\s+pkt\/s/) ?? 0,
		kbPerSecond: num(text, /([\d.]+)\s+KB\/s/) ?? 0,
		fps,
		gapMinMs: gap ? Number(gap[1]) : 0,
		gapMaxMs: gap ? Number(gap[2]) : 0,
		late: late ? [Number(late[1]), Number(late[2]), Number(late[3])] : [0, 0, 0],
		assemblyMaxMs: num(text, /asm\s+([\d.]+)\s+ms/) ?? 0,
		ledMaxUs: num(text, /\bled\s+(\d+)\s+us/) ?? 0,
		seqGaps: num(text, /seqgap\s+(\d+)/) ?? 0,
		bad: num(text, /\bbad\s+(\d+)/) ?? 0,
		outOfRange: num(text, /\boob\s+(\d+)/) ?? 0,
		torn: num(text, /\btorn\s+(\d+)/) ?? 0,
		at
	};
}

export type LinkState =
	| 'unconfigured'
	| 'searching'
	| 'offline'
	| 'online'
	| 'streaming'
	| 'degraded';

/**
 * Wire/audio trim, milliseconds. Positive compensates for transport delay; negative allows
 * wired LEDs with slower audio.
 */
export const OFFSET_MIN_MS = -100;
export const OFFSET_MAX_MS = 250;

/** Below 10% brightness, dithering runs out of codes and dark fades band. */
export const OUTPUT_BRIGHTNESS_MIN = 0.1;

/**
 * Output exponent: below 2 loses hit contrast; above 2.8 quantises low fades to black. Room
 * judged at 2.45.
 */
export const CONTRAST_MIN = 2;
export const CONTRAST_MAX = 2.8;

export function isOutputBrightness(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v >= OUTPUT_BRIGHTNESS_MIN && v <= 1;
}

export function isContrast(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v) && v >= CONTRAST_MIN && v <= CONTRAST_MAX;
}

/** DDP minimises packet overhead; sACN supports controllers that require it. */
export type WireProtocol = 'ddp' | 'sacn';
export const WIRE_PROTOCOLS = ['ddp', 'sacn'] as const;

export function isWireProtocol(v: unknown): v is WireProtocol {
	return WIRE_PROTOCOLS.includes(v as WireProtocol);
}

export const OUTPUT_FPS_CHOICES = [30, 60, 120] as const;
export const DEFAULT_OUTPUT_FPS = 60;

export function isOutputFps(v: unknown): v is number {
	return OUTPUT_FPS_CHOICES.includes(v as (typeof OUTPUT_FPS_CHOICES)[number]);
}

export interface HardwareStatus {
	role: DeviceRole;
	host: string;
	/** RoomRegion id for frame only; all covers the fixture. Bounce derives one colour instead. */
	region: string;
	state: LinkState;
	streaming: boolean;
	identity: DeviceIdentity | null;
	telemetry: DeviceTelemetry | null;
	/** Round trip of the last discovery answer, ms. */
	latencyMs: number | null;
	message: string;
}

/**
 * Exclude seqgap: a shared DDP counter strides across split fixtures and would report false
 * loss.
 */
export function faultsIn(t: DeviceTelemetry): string[] {
	const faults: string[] = [];
	if (t.torn > 0) faults.push(`${t.torn} torn frame${t.torn === 1 ? '' : 's'}`);
	if (t.outOfRange > 0) faults.push(`${t.outOfRange} out of range`);
	if (t.bad > 0) faults.push(`${t.bad} rejected`);
	if (t.late[2] > 0) faults.push(`${t.late[2]} stall${t.late[2] === 1 ? '' : 's'} over 100 ms`);
	else if (t.fps > 0 && t.fps < 55) faults.push(`${t.fps.toFixed(1)} fps`);
	return faults;
}
