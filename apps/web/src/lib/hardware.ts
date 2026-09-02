/**
 * The two lines the board speaks, and what they mean.
 *
 * Both are ASCII, both are parsed here rather than on the server so the shapes can be tested
 * against the samples in docs/FIRMWARE.md without opening a socket. A field the firmware stops
 * sending reads as undefined rather than throwing: this parser is older than the next
 * firmware by construction.
 */

/**
 * Which fixture a board drives.
 *
 * The room is two devices now, and they are not interchangeable: one is fed the whole 720-pixel
 * frame, the other a single derived pixel. So the address, the state and the readout are per
 * role rather than per installation.
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
	 * What each of the build's outputs does with a frame, `+`-separated: `stub` only scores it,
	 * `monitor` puts it on one RGB LED, `lamp` on an analog RGBW fixture, `ws2815` on the strips.
	 */
	leds: string;
}

/** Outputs that receive the whole fixture and light none of it. */
const DARK_OUTPUTS = new Set(['stub', 'monitor']);

/**
 * Whether a frame reaching this board reaches the room.
 *
 * Two outputs receive the whole fixture and light none of it, and the difference matters to
 * whoever is reading these numbers: `stub` only counts packets, `monitor` summarises the frame
 * onto a single RGB LED so the path can be judged before there are strips to judge it with.
 * Both leave the room dark, so both have to say so.
 *
 * A board can carry several outputs at once, so the question is whether any of them emits
 * light, not what the first one happens to be. An unrecognised kind counts as lit: this parser
 * is older than the next firmware by construction, and warning that a lit room is dark is the
 * worse of the two mistakes.
 */
export function lightsRoom(identity: DeviceIdentity | null): boolean {
	if (identity === null) return false;
	return identity.leds.split('+').some((kind) => !DARK_OUTPUTS.has(kind));
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
	 * Longest the board spent presenting one frame, microseconds.
	 *
	 * The only part of the frame budget the board itself spends. It was noise while the output was
	 * one PWM write; driving a strip is 30 us per LED, so it is now a real share of 16.7 ms and
	 * the number beside it stops being about the radio if it climbs.
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

/**
 * `room-node host room-frame fw 0.1.0 up 42s px 720 ddp 4048 stats 4049 leds ws2815`
 *
 * The leading token is the magic that says this is ours; anything else on the port is some
 * other device answering something else.
 */
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
		leds: word(/\bleds\s+(\S+)/) ?? 'unknown'
	};
}

/**
 * `up 42s  1320 px  180 pkt/s  231.7 KB/s  60.0 fps  gap 15.9/17.8 ms  late 0/0/0
 *  asm 2.1 ms  seqgap 0  bad 0  oob 0  torn 0`
 *
 * `late` is absent from the sample in docs/FIRMWARE.md but present in what the firmware writes, so
 * it is optional here rather than required.
 */
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
 * How far the wire may be trimmed against the audio, milliseconds.
 *
 * Positive runs the room early, which is the direction that needs the range: DDP buffering,
 * WiFi jitter and WLED's own frame queue all delay the strips and none of them push the other
 * way. The negative end is there for a board on wired ethernet beating a Bluetooth speaker.
 */
export const OFFSET_MIN_MS = -100;
export const OFFSET_MAX_MS = 250;

/**
 * How far down the room can be dimmed. A tenth is already very dark on 12 m of strip, and below
 * it the dither runs out of codes to spread and the bottom of the range bands.
 */
export const OUTPUT_BRIGHTNESS_MIN = 0.1;

/**
 * The exponent between the authoring domain and light, at both ends of what is usable.
 *
 * 2.0 is nearly flat, which reads as a room with no hits in it. 2.8 is Adafruit's, where every
 * input below a tenth quantises to black and slow fades disappear rather than fade. The room was
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

/**
 * How fast the server renders to the wire.
 *
 * 60 is what the show is judged at and what the effects' own time constants assume. The other
 * two are for a fixture that cannot take it and one that can: WS2812 is 30 us per LED, so 1320
 * pixels on a single data line cap near 25 Hz however fast this sends, and 120 is only reachable
 * on a board with roughly one output per strip.
 */
/**
 * What the strips are addressed with.
 *
 * DDP stays the default: three packets per 1320-LED frame against eight, and no universe
 * arithmetic to get wrong. sACN is here because it is what pixel controllers that are not
 * WLED expect, and it costs the show nothing to speak either.
 */
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
	/**
	 * Which part of the room this board is fed, as a `RoomRegion` id. `all` is the whole
	 * fixture, which is the only sensible default and the only one that was possible before.
	 *
	 * Only meaningful for `frame`. The Bounce Lamp is fed a colour derived from the show rather
	 * than a slice of the room, so there is nothing for it to point at.
	 */
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
 * Anything the board reports that means the room is not seeing a clean 60.
 *
 * `seqgap` is deliberately not one of them: it only counts loss while this board is the sole
 * DDP target, and the host's sequence counter strides rather than steps across a split
 * fixture, so it would cry wolf the moment a second board is added.
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
