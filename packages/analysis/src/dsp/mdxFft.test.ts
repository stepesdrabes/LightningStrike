import { describe, expect, it } from 'vitest';
import { MDX_BINS, mdxFrames, mdxIspec, mdxSpec } from './mdxFft.ts';

describe('MDX23C spectral contract', () => {
	const length = 8329;
	const frames = mdxFrames(length);
	const mix = new Float32Array(2 * length);
	for (let i = 0; i < length; i++) {
		mix[i] = Math.sin(.017 * i) + .2 * Math.cos(.073 * i);
		mix[length + i] = .3 * Math.sin(.037 * i);
	}
	const close = (actual: number, expected: number) =>
		expect(Math.abs(actual - expected)).toBeLessThan(2e-4 * Math.max(1, Math.abs(expected)));

	it('matches torch.stft with centred reflection padding, periodic Hann and channel ordering', () => {
		const spec = mdxSpec(mix, length);
		expect(frames).toBe(17);
		expect(spec.length).toBe(4 * MDX_BINS * frames);
		// torch 2.11 float64: stft(n_fft=2048, hop_length=512, hann_window(periodic), center, reflect).
		const reference = [
			[0, 0, 0, 119.8826778, 0], [0, 1, 0, -123.7145768, 0], [0, 5, 3, -350.4511702, 235.582725],
			[0, 511, 16, .001787476525, .0007937722286], [1, 0, 8, -.007227028454, 0],
			[1, 12, 6, 82.26326951, -129.290447], [1, 1023, 12, 1.111138067e-9, -4.31247954e-11]
		];
		for (const [c, bin, frame, re, im] of reference) {
			close(spec[(2 * c * MDX_BINS + bin) * frames + frame], re);
			close(spec[((2 * c + 1) * MDX_BINS + bin) * frames + frame], im);
		}
	});

	it('inverts like torch.istft once the Nyquist bin the network never sees is zero', () => {
		const output = mdxIspec(mdxSpec(mix, length), length, 1);
		expect(output.length).toBe(2 * length);
		const indices = [0, 1, 37, 1536, 4096, 8192, 8328];
		const reference = [
			[.2000041505, .2164623698, .4074325617, .943253765, .324440182, .947636055, -.1937501183],
			[2.710276447e-6, .01109475891, .2939097852, .08386697138, .2057073081, .299463388, .07709833771]
		];
		for (let c = 0; c < 2; c++) for (let j = 0; j < indices.length; j++) {
			expect(Math.abs(output[c * length + indices[j]] - reference[c][j])).toBeLessThan(2e-5);
		}
	});

	it('keeps each source separate in the inverse', () => {
		const spec = mdxSpec(mix, length);
		const stacked = new Float32Array(3 * spec.length);
		stacked.set(spec, spec.length);
		const output = mdxIspec(stacked, length, 3);
		const single = mdxIspec(spec, length, 1);
		expect(output.subarray(0, 2 * length).every((v) => v === 0)).toBe(true);
		expect(Buffer.from(output.slice(2 * length, 4 * length).buffer).equals(Buffer.from(single.buffer))).toBe(true);
		expect(output.subarray(4 * length).every((v) => v === 0)).toBe(true);
	});

	it('rejects malformed buffers', () => {
		expect(() => mdxSpec(new Float32Array(2048), 1024)).toThrow();
		expect(() => mdxSpec(new Float32Array(3000), 1600)).toThrow();
		expect(() => mdxIspec(new Float32Array(10), length, 1)).toThrow();
	});
});
