/** What a WLED controller says about itself at /json/info, in the parts this app acts on. */
export interface WledInfo {
	name: string;
	version: string;
	/** LEDs it is set up to drive. */
	leds: number;
	/** Its LEDs have a white channel. */
	white: boolean;
	/** Set only when it is set up as a 2D panel. */
	matrix: { width: number; height: number } | null;
	/** Realtime data has taken over from its own effects. */
	live: boolean;
	/** Where that data comes from, when it says. */
	liveFrom: string;
	fps: number;
	/** Wi-Fi quality, 0 to 100. */
	signal: number;
	/** Lowercase hex without separators. */
	mac: string;
	ip: string;
	/** What it estimates it draws, and what its limiter allows; the budget is 0 when unlimited. */
	milliamps: number;
	budget: number;
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const text = (v: unknown) => (typeof v === 'string' ? v : '');

export function parseWledInfo(value: unknown): WledInfo | null {
	if (typeof value !== 'object' || value === null) return null;
	const o = value as Record<string, unknown>;
	const leds = (typeof o.leds === 'object' && o.leds !== null ? o.leds : null) as Record<string, unknown> | null;
	if (!leds || typeof leds.count !== 'number') return null;
	const wifi = (typeof o.wifi === 'object' && o.wifi !== null ? o.wifi : {}) as Record<string, unknown>;
	const matrix = (typeof leds.matrix === 'object' && leds.matrix !== null ? leds.matrix : null) as
		| Record<string, unknown>
		| null;
	// `lc` is a capability mask: bit 1 is a white channel. Older builds said `rgbw` instead.
	const white = typeof leds.lc === 'number' ? (leds.lc & 2) !== 0 : leds.rgbw === true;
	return {
		name: text(o.name) || 'WLED',
		version: text(o.ver),
		leds: num(leds.count),
		white,
		matrix: matrix && num(matrix.w) > 0 && num(matrix.h) > 0 ? { width: num(matrix.w), height: num(matrix.h) } : null,
		live: o.live === true,
		liveFrom: text(o.lip),
		fps: num(leds.fps),
		signal: num(wifi.signal),
		mac: text(o.mac).toLowerCase().replace(/[^0-9a-f]/g, ''),
		ip: text(o.ip),
		milliamps: num(leds.pwr),
		budget: num(leds.maxpwr)
	};
}

/** Whatever about a WLED controller would surprise someone watching the room, in words. */
export function wledNotes(info: WledInfo, sent: number, us: readonly string[]): string[] {
	const notes: string[] = [];
	if (info.live && info.liveFrom && !us.includes(info.liveFrom)) {
		notes.push(`Another app is sending it frames, from ${info.liveFrom}.`);
	}
	if (sent > info.leds) {
		notes.push(`It drives ${info.leds} LEDs and this room sends it ${sent}. Set its LED count to ${sent} in WLED.`);
	}
	if (info.budget > 0 && info.milliamps >= info.budget * 0.95) {
		notes.push('Its current limiter is dimming the lights.');
	}
	if (info.signal > 0 && info.signal < 40) notes.push('Its Wi-Fi is weak, so frames may arrive late.');
	return notes;
}
