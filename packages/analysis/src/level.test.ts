import { describe, expect, it } from 'vitest';
import { decodeBase64 } from '@mv/core';
import { levelTrack } from './level.ts';

const rate = 22050;

/** Two seconds of a loud groove, then a quiet count-in: clicks in silence with a 300 ms rest. */
function signal(): Float32Array {
	const out = new Float32Array(rate * 4);
	for (let i = 0; i < rate * 2; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate);
	for (const at of [2.5, 3.0, 3.5]) {
		const start = Math.round(at * rate);
		for (let i = 0; i < Math.round(0.02 * rate); i++) {
			out[start + i] = 0.08 * Math.exp(-i / (0.005 * rate)) * (i % 2 === 0 ? 1 : -1);
		}
	}
	return out;
}

describe('level track', () => {
	const bytes = decodeBase64(
		levelTrack(signal(), rate, 4, (t) => (t < 2 ? 'groove' : 'intro')).data
	);
	const at = (t: number) => bytes[Math.round(t * 100 - 0.5)];

	it('samples at 100 Hz for the whole duration', () => {
		expect(bytes.length).toBe(400);
	});

	it('reads the loud passage near the top and silence at zero', () => {
		expect(at(1)).toBeGreaterThan(235);
		expect(at(2.3)).toBe(0);
		expect(at(3.3)).toBe(0);
	});

	it('shows a quiet click as a clear, short rise above the rest around it', () => {
		const click = at(2.51);
		expect(click).toBeGreaterThan(60);
		expect(click).toBeLessThan(at(1) - 60);
		expect(at(2.6)).toBeLessThan(click * 0.3);
	});
});
