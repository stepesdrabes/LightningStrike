/** Seconds, or '90s', '8m', '1h', '1h30m', '3:30' (m:ss), '1:02:03' (h:mm:ss). */
export type Length =
	| number
	| `${number}s`
	| `${number}m`
	| `${number}h`
	| `${number}h${number}m`
	| `${number}:${number}`
	| `${number}:${number}:${number}`;

/** 24-hour wall clock on the night, 'HH:MM'. */
export type Clock = `${number}:${number}`;

const UNITS = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/;
const COLON = /^(\d+):([0-5]?\d(?:\.\d+)?)(?::([0-5]?\d(?:\.\d+)?))?$/;

/** Seconds, or null for anything that is not a non-negative length. */
export function parseLength(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
	if (typeof value !== 'string') return null;
	const text = value.trim().toLowerCase();
	if (text === '') return null;
	const colon = COLON.exec(text);
	if (colon) {
		const [a, b, c] = [colon[1], colon[2], colon[3]].map((x) => (x === undefined ? 0 : Number(x)));
		return colon[3] === undefined ? a * 60 + b : a * 3600 + b * 60 + c;
	}
	const units = UNITS.exec(text);
	if (!units || (units[1] === undefined && units[2] === undefined && units[3] === undefined)) {
		return null;
	}
	const [h, m, s] = [units[1], units[2], units[3]].map((x) => (x === undefined ? 0 : Number(x)));
	return h * 3600 + m * 60 + s;
}

/** Minutes after midnight for 'HH:MM', or null. */
export function parseClock(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The night's day turns over at noon, so a party's 00:30 comes after its 22:00. */
export const ROLLOVER_MINUTES = 12 * 60;

/** Minutes since the night's noon, which orders clock times the way the evening runs. */
export function nightMinutes(clockMinutes: number): number {
	return (clockMinutes - ROLLOVER_MINUTES + 1440) % 1440;
}

/**
 * Epoch ms of a clock time on the night containing `now`. `offsetMinutes` is what
 * `Date.getTimezoneOffset` returns, passed in so tests do not depend on the machine's zone.
 */
export function clockOnNight(clockMinutes: number, now: number, offsetMinutes: number): number {
	const day = 86_400_000;
	const local = now - offsetMinutes * 60_000;
	const midnight = Math.floor(local / day) * day;
	const noon = midnight + ROLLOVER_MINUTES * 60_000;
	const nightNoon = local >= noon ? noon : noon - day;
	return nightNoon + nightMinutes(clockMinutes) * 60_000 + offsetMinutes * 60_000;
}

/** 'H:MM' for durations, 'M:SS' under an hour. */
export function formatLength(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
