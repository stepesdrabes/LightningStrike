import { DWELL_MAX, DWELL_MIN, hsv2rgb, rampHueFor, type ColourSource } from '@mv/core';

/**
 * The bounds the sliders offer and the settings API clamps to, in one place.
 *
 * Imported by both, like the hardware trim's, because the two disagreeing means a value that can be
 * dragged to and is then silently changed on the way to disk.
 */
export const HUE_MIN = 0;
export const HUE_MAX = 359;

/** Below this the room stops being a colour and becomes a white that happens to be tinted. */
export const SAT_MIN = 0.15;
export const SAT_MAX = 1;

/**
 * Degrees a minute. At the top it is a lap in twelve minutes, which is the fastest a drift can run
 * and still be something you notice having happened rather than something you watch happening.
 */
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

/**
 * The colour the room will actually deliver for a hue picked off a wheel, as a CSS string.
 *
 * Through `rampHueFor` and `hsv2rgb` rather than CSS `hsl`, because the two are different curves:
 * the ramp widens yellow and spends no coordinates at all across cyan. A CSS gradient under the
 * thumb would offer colours the room cannot make and hide the reach it does have.
 */
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
