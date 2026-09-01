import { describe, expect, it } from 'vitest';
import { hsv2rgb, rampHueFor } from '@mv/core';
import {
	SAT_MAX,
	SAT_MIN,
	clamp,
	deliveredCss,
	hueTrack,
	isColourSource,
	wrapDegrees
} from './ambient.ts';

describe('bounds', () => {
	it('wraps a hue rather than pinning it, because a wheel has no ends', () => {
		expect(wrapDegrees(370)).toBe(10);
		expect(wrapDegrees(-10)).toBe(350);
		expect(wrapDegrees(359.6)).toBe(0);
		expect(wrapDegrees(0)).toBe(0);
	});

	it('pins everything that does have ends', () => {
		expect(clamp(2, SAT_MIN, SAT_MAX)).toBe(SAT_MAX);
		expect(clamp(-1, SAT_MIN, SAT_MAX)).toBe(SAT_MIN);
	});

	it('accepts only the three colour sources', () => {
		expect(isColourSource('fixed')).toBe(true);
		expect(isColourSource('drift')).toBe(true);
		expect(isColourSource('track')).toBe(true);
		expect(isColourSource('rainbow')).toBe(false);
		expect(isColourSource(undefined)).toBe(false);
	});
});

describe('swatches', () => {
	/**
	 * The reason these exist at all. A wheel in the interface is in textbook degrees and the room
	 * runs on FastLED's ramp, and the two are different curves rather than a rotation - so a swatch
	 * drawn with CSS `hsl` offers colours the strips cannot make.
	 */
	it('draws a picked hue in the colour the room will deliver, not the one CSS would', () => {
		const [r, g, b] = hsv2rgb(rampHueFor(90), 1, 1);
		const byte = (v: number) => Math.round(v * 255);
		expect(deliveredCss(90)).toBe(`rgb(${byte(r)} ${byte(g)} ${byte(b)})`);
	});

	it('builds a track that starts and ends on the same colour, so the wheel joins up', () => {
		const track = hueTrack(1, 4);
		const stops = track.slice('linear-gradient(to right, '.length, -1).split(', ');
		expect(stops).toHaveLength(5);
		expect(stops[0].split(' ').slice(0, 3)).toEqual(stops[4].split(' ').slice(0, 3));
	});
});
