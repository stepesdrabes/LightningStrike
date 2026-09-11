import { DWELL_MAX, DWELL_MIN, hsv2rgb, rampHueFor, type ColourSource } from '@mv/core';

/** Shared slider/API bounds prevent values changing when persisted. */
export const HUE_MIN = 0;
export const HUE_MAX = 359;

/** Below this the room stops being a colour and becomes a white that happens to be tinted. */
export const SAT_MIN = 0.15;
export const SAT_MAX = 1;

/** Degrees per minute; 30 gives a twelve-minute lap, slow enough to read as drift. */
export const DRIFT_MIN = 0;
export const DRIFT_MAX = 30;

export { DWELL_MAX, DWELL_MIN };

/** The default first, so the panel reads as a choice away from it rather than toward it. */
export const COLOUR_SOURCES: readonly { id: ColourSource; label: string }[] = [
	{ id: 'track', label: 'Follow the track' },
	{ id: 'fixed', label: 'One colour' },
	{ id: 'drift', label: 'Slow drift' }
];

export function isColourSource(v: unknown): v is ColourSource {
	return v === 'fixed' || v === 'drift' || v === 'track';
}

/** A hue is a wheel, so a value off the end belongs on the other end rather than pinned to it. */
export function wrapDegrees(v: number): number {
	return ((Math.round(v) % 360) + 360) % 360;
}

export function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

/** Use the room's FastLED ramp, not CSS HSL, so slider colours match delivered light. */
export function deliveredCss(degrees: number, sat = 1, value = 1): string {
	const [r, g, b] = hsv2rgb(rampHueFor(degrees), sat, value);
	const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
	return `rgb(${byte(r)} ${byte(g)} ${byte(b)})`;
}

/** The hue slider's track, in the colours the strips make. */
export function hueTrack(sat: number, steps = 36): string {
	const stops: string[] = [];
	for (let i = 0; i <= steps; i++) {
		stops.push(`${deliveredCss((i / steps) * 360, sat)} ${((i / steps) * 100).toFixed(1)}%`);
	}
	return `linear-gradient(to right, ${stops.join(', ')})`;
}
