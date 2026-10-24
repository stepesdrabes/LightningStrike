import { adtofFilterbank, adtofSpectrogram, hannSymmetric, logFilterbank } from './adtof.ts';
import { RealFft } from './dsp/fft.ts';

/**
 * Striker 2.0's input (striker-2 docs/design.md section 2): branch A is ADTOF's spectrogram
 * unchanged, branch B a long-window view of the bass. A manifest whose `front_end` says otherwise
 * is refused, because these numbers are code, not data.
 */
export const STRIKER2_FRONT_END = {
	sampleRate: 44100,
	fps: 100,
	hop: 441,
	a: { frame: 2048, perOctave: 12, fmin: 20, fmax: 20000, bands: 84 },
	b: {
		decimate: 9, rate: 4900, hop: 49, frame: 1024, perOctave: 24, fmin: 30, fmax: 1200, bands: 95, firTaps: 255
	},
	bins: 179
} as const;

const B = STRIKER2_FRONT_END.b;

/** d[m] = sum_k h[k] x[9m + k - half]: the zero-phase low-pass, then every ninth sample. */
export function decimate(mono: Float32Array, taps: Float32Array): Float32Array {
	const half = (taps.length - 1) / 2;
	const out = new Float32Array(Math.ceil(mono.length / B.decimate));
	for (let m = 0; m < out.length; m++) {
		const base = m * B.decimate - half;
		let acc = 0;
		const from = Math.max(0, -base);
		const to = Math.min(taps.length, mono.length - base);
		for (let k = from; k < to; k++) acc += taps[k] * mono[base + k];
		out[m] = acc;
	}
	return out;
}

/** 44.1 kHz mono, (L + R) / 2, to [frames, 179] float32 rows at 100 fps. */
export function striker2Features(
	mono: Float32Array, taps: Float32Array
): { data: Float32Array; frames: number; bins: number } {
	const frames = 1 + Math.floor(mono.length / STRIKER2_FRONT_END.hop);
	const a = adtofSpectrogram(mono, adtofFilterbank());
	const aBands = a.length / frames;
	const bank = logFilterbank(B.frame, B.rate, B.perOctave, B.fmin, B.fmax);
	const low = decimate(mono, taps);
	const fft = new RealFft(B.frame);
	const window = hannSymmetric(B.frame);
	const mags = new Float32Array(B.frame / 2 + 1);
	const bins = aBands + bank.nBins;
	const data = new Float32Array(frames * bins);
	for (let t = 0; t < frames; t++) {
		data.set(a.subarray(t * aBands, (t + 1) * aBands), t * bins);
		fft.magnitudes(low, t * B.hop - B.frame / 2, window, mags, 1);
		for (let i = 0; i < bank.nBins; i++) {
			const row = i * bank.fftBins;
			let acc = 0;
			for (let b = bank.first[i]; b <= bank.last[i]; b++) acc += bank.filters[row + b] * mags[b];
			data[t * bins + aBands + i] = Math.log10(1 + acc);
		}
	}
	return { data, frames, bins };
}
