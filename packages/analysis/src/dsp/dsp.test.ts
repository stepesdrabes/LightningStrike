import { describe, expect, it } from 'vitest';
import { RealFft, hannWindow } from './fft.ts';
import { applyBiquad, kWeighting, lowpass } from './filters.ts';
import { computeSpectrogram, logFilterBank } from './spectrogram.ts';
import { quantile, smooth } from './stats.ts';

function naiveDft(x: Float32Array, k: number): [number, number] {
	let re = 0;
	let im = 0;
	for (let n = 0; n < x.length; n++) {
		const a = (-2 * Math.PI * k * n) / x.length;
		re += x[n] * Math.cos(a);
		im += x[n] * Math.sin(a);
	}
	return [re, im];
}

describe('RealFft', () => {
	it('matches a naive DFT bin for bin', () => {
		for (const size of [4, 8, 64, 256, 1024]) {
			const fft = new RealFft(size);
			const rect = new Float32Array(size).fill(1);
			const signal = new Float32Array(size);
			for (let i = 0; i < size; i++) {
				signal[i] = Math.sin(i * 1.7) + 0.3 * Math.cos(i * 0.31) + (i % 7) * 0.05;
			}
			const re = new Float32Array(fft.bins);
			const im = new Float32Array(fft.bins);
			fft.forward(signal, 0, rect, re, im);

			for (let k = 0; k < fft.bins; k++) {
				const [nr, ni] = naiveDft(signal, k);
				expect(Math.abs(nr - re[k])).toBeLessThan(1e-3 * size);
				expect(Math.abs(ni - im[k])).toBeLessThan(1e-3 * size);
			}
		}
	});

	it('reads a full-scale sine as amplitude 1 at its own bin', () => {
		const size = 2048;
		const sampleRate = 22050;
		const fft = new RealFft(size);
		const window = hannWindow(size);
		const freq = (8 * sampleRate) / size;
		const signal = new Float32Array(size);
		for (let i = 0; i < size; i++) signal[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);

		const mags = new Float32Array(fft.bins);
		fft.magnitudes(signal, 0, window, mags, 4 / size);

		let peak = 0;
		let peakBin = 0;
		for (let k = 0; k < fft.bins; k++) {
			if (mags[k] > peak) {
				peak = mags[k];
				peakBin = k;
			}
		}
		expect(peakBin).toBe(8);
		expect(peak).toBeCloseTo(1, 2);
	});

	it('zero-pads rather than wrapping past either end of the signal', () => {
		const fft = new RealFft(64);
		const window = new Float32Array(64).fill(1);
		const signal = new Float32Array(16).fill(1);
		const mags = new Float32Array(fft.bins);
		fft.magnitudes(signal, -32, window, mags, 1);
		// Sixteen ones starting at offset 32 of a 64-point frame: DC is exactly 16.
		expect(mags[0]).toBeCloseTo(16, 3);
	});
});

describe('filter banks', () => {
	it('spaces log bands by the requested number per octave', () => {
		const bank = logFilterBank(2048, 22050, 24, 30, 11000);
		expect(bank.bands).toBeGreaterThan(80);
		// Once the bands are wider than a bin, consecutive centres are a 24th of an octave apart.
		const ratio = bank.centreHz[bank.bands - 1] / bank.centreHz[bank.bands - 2];
		expect(ratio).toBeCloseTo(Math.pow(2, 1 / 24), 3);
	});

	it('never places a band above Nyquist', () => {
		const bank = logFilterBank(2048, 22050, 24, 30, 17000);
		for (let b = 0; b < bank.bands; b++) expect(bank.centreHz[b]).toBeLessThanOrEqual(11025);
	});
});

describe('spectrogram', () => {
	const sampleRate = 22050;

	it('centres frames on their timestamp', () => {
		const signal = new Float32Array(sampleRate * 2);
		signal[sampleRate] = 1;
		const spec = computeSpectrogram(signal, sampleRate, {
			fftSize: 2048,
			hop: 220,
			bank: logFilterBank(2048, sampleRate, 24, 30, 11000)
		});
		let loudest = 0;
		for (let f = 0; f < spec.frames; f++) if (spec.rms[f] > spec.rms[loudest]) loudest = f;
		expect(Math.abs(spec.timeOf(loudest) - 1)).toBeLessThan(0.02);
	});

	it('puts a tone in the band that contains it', () => {
		const signal = new Float32Array(sampleRate);
		for (let i = 0; i < signal.length; i++) {
			signal[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
		}
		const bank = logFilterBank(2048, sampleRate, 24, 30, 11000);
		const spec = computeSpectrogram(signal, sampleRate, { fftSize: 2048, hop: 220, bank });
		const mid = Math.floor(spec.frames / 2);
		let peak = 0;
		for (let b = 0; b < spec.bands; b++) {
			if (spec.mag[mid * spec.bands + b] > spec.mag[mid * spec.bands + peak]) peak = b;
		}
		expect(Math.abs(spec.centreHz[peak] - 1000)).toBeLessThan(60);
	});
});

describe('biquads', () => {
	it('attenuates well above a lowpass corner and passes well below it', () => {
		const sampleRate = 22050;
		const level = (freq: number) => {
			const signal = new Float32Array(sampleRate);
			for (let i = 0; i < signal.length; i++) {
				signal[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
			}
			applyBiquad(signal, lowpass(sampleRate, 500));
			let acc = 0;
			// Skip the first tenth of a second, which is the filter settling.
			for (let i = 2205; i < signal.length; i++) acc += signal[i] * signal[i];
			return Math.sqrt(acc / (signal.length - 2205));
		};
		expect(level(100)).toBeGreaterThan(0.65);
		expect(level(5000)).toBeLessThan(0.05);
	});

	it('derives K-weighting for the sample rate rather than assuming 48 kHz', () => {
		const [shelf48, hp48] = kWeighting(48000);
		// The values tabulated in ITU-R BS.1770-4 for 48 kHz.
		expect(shelf48.b0).toBeCloseTo(1.53512485958697, 6);
		expect(shelf48.b1).toBeCloseTo(-2.69169618940638, 6);
		expect(shelf48.b2).toBeCloseTo(1.19839281085285, 6);
		expect(shelf48.a1).toBeCloseTo(-1.69065929318241, 6);
		expect(shelf48.a2).toBeCloseTo(0.73248077421585, 6);
		expect(hp48.a1).toBeCloseTo(-1.99004745483398, 6);
		expect(hp48.a2).toBeCloseTo(0.99007225036621, 6);

		const [shelf44] = kWeighting(44100);
		expect(shelf44.b0).not.toBeCloseTo(shelf48.b0, 4);
	});
});

describe('stats', () => {
	it('interpolates quantiles', () => {
		expect(quantile([0, 1, 2, 3, 4], 0)).toBe(0);
		expect(quantile([0, 1, 2, 3, 4], 1)).toBe(4);
		expect(quantile([0, 1, 2, 3, 4], 0.5)).toBe(2);
		expect(quantile([0, 10], 0.25)).toBeCloseTo(2.5, 6);
	});

	it('preserves the mean when smoothing a constant', () => {
		const flat = new Float32Array(50).fill(7);
		for (const v of smooth(flat, 5)) expect(v).toBeCloseTo(7, 5);
	});
});
