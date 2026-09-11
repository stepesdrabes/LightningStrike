import { describe, expect, it } from 'vitest';
import { activationStream } from './adtof.ts';
import { quantiseOnsets } from './quantise.ts';

const FPS = 100;

function pulse(curve: Float32Array, time: number, level: number): void {
	const centre = Math.round(time * FPS);
	for (let k = -2; k <= 2; k++) curve[centre + k] += level * Math.exp(-k * k);
}

describe('model drum evidence', () => {
	it('does not turn sustained uncertain activations into missing pattern hits', () => {
		const activation = new Float32Array(1200).fill(0.18);
		const expected: number[] = [];
		for (let bar = 0; bar < 5; bar++) {
			pulse(activation, bar * 2 + 0.5, 0.8);
			expected.push(bar * 2 + 0.5);
			if (bar === 2) continue;
			pulse(activation, bar * 2 + 1.5, 0.8);
			expected.push(bar * 2 + 1.5);
		}
		const stream = activationStream(activation, 0.24);
		const onsets = quantiseOnsets(stream, {
			beats: Float64Array.from({ length: 24 }, (_, i) => i * 0.5),
			beatsPerBar: 4,
			duration: 12
		});
		expect(onsets.times).toEqual(expected);
		expect(onsets.invented.every((invented) => !invented)).toBe(true);
	});

	it('retains a faint genuine onset when a repeating pattern supports it', () => {
		const activation = new Float32Array(1200).fill(0.02);
		for (let bar = 0; bar < 5; bar++) {
			pulse(activation, bar * 2 + 0.5, 0.9);
			pulse(activation, bar * 2 + 1.5, bar === 2 ? 0.2 : 0.9);
		}
		const stream = activationStream(activation, 0.24);
		expect(stream.times).not.toContain(5.5);
		const onsets = quantiseOnsets(stream, {
			beats: Float64Array.from({ length: 24 }, (_, i) => i * 0.5),
			beatsPerBar: 4,
			duration: 12
		});
		const recovered = onsets.times.indexOf(5.5);
		expect(recovered).toBeGreaterThanOrEqual(0);
		expect(onsets.invented[recovered]).toBe(true);
		expect(onsets.levels[recovered]).toBeLessThan(0.6);
	});

	it('keeps weak detections subtle even if no confident hit exists in the track', () => {
		const activation = new Float32Array(400);
		pulse(activation, 1, 0.33);
		pulse(activation, 2, 0.35);
		const stream = activationStream(activation, 0.24);
		expect(stream.times).toEqual([1, 2]);
		expect(Math.max(...stream.levels)).toBeLessThan(0.3);
		expect(Math.min(...stream.levels)).toBeGreaterThan(0.1);
	});

	it('does not promote a missing hit above the uncertain pattern that supports it', () => {
		const activation = new Float32Array(1200).fill(0.02);
		for (let bar = 0; bar < 5; bar++) {
			pulse(activation, bar * 2 + 0.5, 0.35);
			pulse(activation, bar * 2 + 1.5, bar === 2 ? 0.2 : 0.35);
		}
		const stream = activationStream(activation, 0.24);
		const onsets = quantiseOnsets(stream, {
			beats: Float64Array.from({ length: 24 }, (_, i) => i * 0.5),
			beatsPerBar: 4,
			duration: 12
		});
		const recovered = onsets.times.indexOf(5.5);
		expect(onsets.invented[recovered]).toBe(true);
		expect(onsets.levels[recovered]).toBeLessThan(Math.min(...stream.levels));
	});

	it('preserves confident hits and tightly spaced snare rolls', () => {
		const activation = new Float32Array(400);
		for (const time of [1, 1.06, 1.12, 2]) pulse(activation, time, 0.95);
		const stream = activationStream(activation, 0.24);
		expect(stream.times).toEqual([1, 1.06, 1.12, 2]);
		expect(Math.min(...stream.levels)).toBeGreaterThan(0.75);
	});
});
