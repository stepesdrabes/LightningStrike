import { describe, expect, it } from 'vitest';
import type { DrumStream } from './drums.ts';
import { quantiseOnsets } from './quantise.ts';

const beats = Float64Array.from({ length: 25 }, (_, i) => i * 0.5);
const options = { beats, beatsPerBar: 4, duration: 12 };

function stream(times: number[], levels = times.map(() => 0.9)): DrumStream {
	const curve = new Float32Array(1201);
	for (let i = 0; i < times.length; i++) curve[Math.round(times[i] * 100)] = levels[i];
	return { times, levels, curve, fps: 100 };
}

describe('pattern evidence and played timing', () => {
	it('retains every separately detected flam and fast roll inside one grid slot', () => {
		const input = stream([0.48, 0.52, 1, 1.05, 1.1, 1.15, 2.5, 3.5]);
		const output = quantiseOnsets(input, options);
		for (let i = 0; i < input.times.length; i++) {
			const found = output.times.indexOf(input.times[i]);
			expect(found).toBeGreaterThanOrEqual(0);
			expect(output.levels[found]).toBe(input.levels[i]);
			expect(output.invented[found]).toBe(false);
		}
	});

	it('recovers a faint late backbeat at its audio attack and local strength', () => {
		const input = stream([0.5, 1.5, 2.5, 3.5, 4.5, 6.5, 7.5]);
		input.curve[554] = 0.18;
		const output = quantiseOnsets(input, options);
		const found = output.times.indexOf(5.54);
		expect(found).toBeGreaterThanOrEqual(0);
		expect(output.times).not.toContain(5.5);
		expect(output.invented[found]).toBe(true);
		expect(output.levels[found]).toBeCloseTo(0.18 * 0.55);
	});

	it('does not turn a sustained evidence floor into repeating hits', () => {
		const input = stream([0.5, 1.5, 2.5, 3.5, 4.5, 6.5, 7.5]);
		input.curve.fill(0.2, 520, 580);
		const output = quantiseOnsets(input, options);
		expect(output.times).toEqual(input.times);
	});

	it('does not use one ambiguous boundary peak for both neighbouring subdivisions', () => {
		const input = stream([0.5, 0.625, 2.5, 2.625, 4, 6.5, 6.625]);
		input.curve[456] = 0.2;
		const output = quantiseOnsets(input, options);
		const additions = output.times.filter((_, i) => output.invented[i]);
		expect(additions).toEqual([4.56]);
	});

	it('follows actual bar resets and excludes short bars from pattern votes', () => {
		const input = stream([0.5, 1.5, 2.5, 4, 5, 6, 8, 9]);
		input.curve[700] = 0.2;
		input.curve[650] = 0.2;
		const output = quantiseOnsets(input, {
			...options,
			barTimes: Float64Array.from([0, 2, 3.5, 5.5, 7.5, 9.5, 11.5]),
			barGroup: Int32Array.from([0, 0, 0, 0, 0, 0])
		});
		expect(output.times).toContain(7);
		expect(output.times).not.toContain(6.5);
		for (const time of input.times) expect(output.times).toContain(time);
	});

	it('uses calibrated evidence rather than treating a model probability as brightness', () => {
		const input = stream([0.5, 1.5, 2.5, 3.5, 4.5, 6.5, 7.5]);
		input.curve[550] = 0.18;
		input.levelCurve = Float32Array.from(input.curve);
		input.levelCurve[550] = 0.09;
		const output = quantiseOnsets(input, options);
		expect(output.levels[output.times.indexOf(5.5)]).toBeCloseTo(0.09 * 0.55);
	});
});

describe('cohort floors', () => {
	it('refuses to complete a sparse, uncertain cohort and to thin a confident one', () => {
		const faint = stream([0.5, 1.5, 2.5, 3.5, 4.5, 6.5, 7.5], [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
		faint.curve[550] = 0.2;
		expect(quantiseOnsets(faint, options).times).toContain(5.5);
		expect(quantiseOnsets(faint, { ...options, promoteFloor: 0.4 }).times).not.toContain(5.5);

		const stray = stream([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 1.75], [1, 1, 1, 1, 1, 1, 1, 1, 0.1]);
		expect(quantiseOnsets(stray, options).times).not.toContain(1.75);
		expect(quantiseOnsets(stray, { ...options, demoteFloor: 0.9 }).times).not.toContain(1.75);
		const softer = stream([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 1.75], [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.1]);
		expect(quantiseOnsets(softer, options).times).not.toContain(1.75);
		expect(quantiseOnsets(softer, { ...options, demoteFloor: 0.9 }).times).toContain(1.75);
	});
});
