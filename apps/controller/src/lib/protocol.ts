/**
 * Mirror the firmware API without browser imports. Parsers ignore unknown fields and tolerate
 * missing optional fields for firmware compatibility.
 */

type Power = 'on' | 'off';
export type Policy = 'restore' | 'always-on';
/** Read-only. `party` is entered by DDP arriving, never by a control in here. */
type Mode = 'smart' | 'party' | 'party-muted';

export interface LightState {
	power: Power;
	/** `#rrggbb`, lowercase. */
	colour: string;
	/** 0..255. */
	brightness: number;
	effect: string;
	powerOn: Policy;
	mode: Mode;
}

export interface DeviceInfo {
	/** The DHCP hostname, which is also what the router lists the board as. */
	name: string;
	/** The board's own address. Empty on firmware older than this field. */
	ip: string;
	firmware: string;
	uptimeS: number;
	pixels: number;
	ddpPort: number;
	statsPort: number;
	/** What the output drives: `lamp`, `sk6812`, `monitor`, `stub`. */
	leds: string;
	/** What this fixture actually runs, which is not the same on both boards. */
	effects: string[];
}

/** Any subset, applied atomically by the board, which answers with the state that resulted. */
export type Patch = Partial<Pick<LightState, 'power' | 'colour' | 'brightness' | 'effect' | 'powerOn'>>;

const POWERS: readonly string[] = ['on', 'off'];
const POLICIES: readonly string[] = ['restore', 'always-on'];
const MODES: readonly string[] = ['smart', 'party', 'party-muted'];

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(v: unknown, fallback = ''): string {
	return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** A name and DDP port distinguish boards from unrelated JSON servers on the subnet. */
export function parseInfo(value: unknown): DeviceInfo | null {
	const o = record(value);
	if (!o) return null;
	const name = str(o.name);
	if (name === '' || typeof o.ddpPort !== 'number') return null;
	const effects = Array.isArray(o.effects) ? o.effects.filter((e) => typeof e === 'string') : [];
	return {
		name,
		ip: str(o.ip),
		firmware: str(o.firmware, '?'),
		uptimeS: num(o.uptimeS),
		pixels: num(o.pixels),
		ddpPort: o.ddpPort,
		statsPort: num(o.statsPort),
		leds: str(o.leds, 'unknown'),
		effects
	};
}

export function parseState(value: unknown): LightState | null {
	const o = record(value);
	if (!o) return null;
	const power = str(o.power);
	const colour = str(o.colour);
	if (!POWERS.includes(power) || !/^#[0-9a-f]{6}$/i.test(colour)) return null;
	const powerOn = str(o.powerOn);
	const mode = str(o.mode);
	return {
		power: power as Power,
		colour: colour.toLowerCase(),
		brightness: Math.max(0, Math.min(255, Math.round(num(o.brightness)))),
		effect: str(o.effect),
		powerOn: (POLICIES.includes(powerOn) ? powerOn : 'restore') as Policy,
		mode: (MODES.includes(mode) ? mode : 'smart') as Mode
	};
}

/** Names keyed by firmware Fixture::HOSTNAME; unknown boards retain their hostname. */
const NAMES: Record<string, string> = {
	'room-bounce': 'Bounce Lamp',
	'room-frame': 'The Frame',
	'room-bench': 'The bench run'
};

export function displayName(info: DeviceInfo | null, host: string): string {
	if (!info) return host;
	return NAMES[info.name] ?? info.name;
}

/** The hostnames worth trying before anything is known, newest fixture first. */
export const KNOWN_HOSTS: readonly string[] = ['room-bounce', 'room-frame', 'room-bench'];

const EFFECT_LABELS: Record<string, string> = {
	wash: 'Wash',
	twinkle: 'Twinkle',
	fire: 'Fire',
	breathe: 'Breathe',
	aurora: 'Aurora',
	sparkle: 'Sparkle',
	chase: 'Chase',
	candle: 'Candle'
};

export function effectLabel(effect: string): string {
	return EFFECT_LABELS[effect] ?? effect.charAt(0).toUpperCase() + effect.slice(1);
}

/** Whether the board is currently taking its pixels from a show rather than from this app. */
export function isStreaming(state: LightState | null): boolean {
	return state !== null && state.mode !== 'smart';
}
