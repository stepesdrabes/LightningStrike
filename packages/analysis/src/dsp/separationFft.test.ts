import { describe, expect, it } from 'vitest';
import { demucsSpec, demucsIspec } from './separationFft.ts';

describe('Demucs spectral contract', () => {
	const length = 8329;
	const frames = 9;
	const mix = new Float32Array(2 * length);
	for (let i = 0; i < length; i++) {
		mix[i] = Math.sin(.017 * i) + .2 * Math.cos(.073 * i);
		mix[length + i] = .3 * Math.sin(.037 * i);
	}

	it('matches independent normalized NumPy FFT values with reflection, frame trim and channel ordering', () => {
		const spec = demucsSpec(mix, length);
		expect(spec.length).toBe(4 * 2048 * frames);
		const reference = [
			[0, 0, 0, 1.5798268954, 0], [0, 1, 0, -1.1090073664, -1.1316001573],
			[0, 11, 3, 15.0547444319, -5.2081364363], [0, 512, 4, 3.9479e-8, -1.0683e-7],
			[1, 0, 8, -.2252598738, 0], [1, 27, 6, .0069652217, -.0469786007],
			[1, 2047, 8, -6.5242513e-5, 4.2377528e-5]
		];
		for (const [c, bin, frame, re, im] of reference) {
			expect(Math.abs(spec[(2 * c * 2048 + bin) * frames + frame] - re)).toBeLessThan(2e-4);
			expect(Math.abs(spec[((2 * c + 1) * 2048 + bin) * frames + frame] - im)).toBeLessThan(2e-4);
		}
	});

	it('reconstructs exact sample positions and normalizes the missing edge frames', () => {
		const output = demucsIspec(demucsSpec(mix, length), length, 1);
		const indices = [0, 1, 37, 1536, 4096, 8192, 8328];
		const reference = [
			[.1000010391, .1083887596, .2146126475, .9432550919, .3244429279, .9340921301, -.1870843771],
			[6.7757465e-7, .005556081, .1548151198, .0838677106, .2057077485, .2951828081, .0744478917]
		];
		expect(output.length).toBe(2 * length);
		for (let c = 0; c < 2; c++) for (let j = 0; j < indices.length; j++) {
			expect(Math.abs(output[c * length + indices[j]] - reference[c][j])).toBeLessThan(4e-5);
		}
	});

	it('inverts a complex spectral bin with the correct phase in each channel', () => {
		const count = 512;
		const spectrum = new Float32Array(4 * 2048);
		for (let channel = 0; channel < 2; channel++) {
			spectrum[channel * 2 * 2048 + 11] = .75;
			spectrum[(channel * 2 + 1) * 2048 + 11] = channel ? .5 : -.5;
		}
		const output = demucsIspec(spectrum, count, 1);
		for (let channel = 0; channel < 2; channel++) for (const i of [0, 1, 97, 301, 511]) {
			const j = i + 1536;
			const phase = 2 * Math.PI * 11 * j / 4096;
			const inverse = 2 * (.75 * Math.cos(phase) - (channel ? .5 : -.5) * Math.sin(phase)) / 64;
			const window = .5 - .5 * Math.cos(2 * Math.PI * j / 4096);
			// Four overlapping periodic Hann squares sum to 1.5, including zero edge frames.
			expect(Math.abs(output[channel * count + i] - inverse * window / 1.5)).toBeLessThan(1e-8);
		}
	});

	it('rejects malformed buffers instead of reflecting indefinitely', () => {
		expect(() => demucsSpec(new Float32Array(2), 1)).toThrow();
		expect(() => demucsSpec(new Float32Array(20), 11)).toThrow();
		expect(() => demucsIspec(new Float32Array(0), 8192)).toThrow();
	});

	it('keeps analytical phase and normalization across repeated lengths and cache eviction', () => {
		// Three lengths exceed the two-entry cache. Different frame counts and residues
		// expose stale normalization arrays, including when a previously used length returns.
		for (const count of [512, 8329, 1025, 8329, 512]) {
			const countFrames = Math.ceil(count / 1024);
			const spectrum = new Float32Array(4 * 2048 * countFrames);
			for (let channel = 0; channel < 2; channel++) for (let t = 0; t < countFrames; t++) {
				spectrum[(channel * 2 * 2048 + 11) * countFrames + t] = .75;
				spectrum[((channel * 2 + 1) * 2048 + 11) * countFrames + t] = channel ? .5 : -.5;
			}
			const output = demucsIspec(spectrum, count, 1);
			for (let channel = 0; channel < 2; channel++) for (const i of [0, 1, Math.floor(count / 2), count - 1]) {
				let expected = 0;
				for (let t = 0; t < countFrames; t++) {
					const j = i - t * 1024 + 1536;
					if (j < 0 || j >= 4096) continue;
					const phase = 2 * Math.PI * 11 * j / 4096;
					const inverse = 2 * (.75 * Math.cos(phase) - (channel ? .5 : -.5) * Math.sin(phase)) / 64;
					expected += inverse * (.5 - .5 * Math.cos(2 * Math.PI * j / 4096)) / 1.5;
				}
				expect(Math.abs(output[channel * count + i] - expected)).toBeLessThan(1e-8);
			}
		}
	});
});
