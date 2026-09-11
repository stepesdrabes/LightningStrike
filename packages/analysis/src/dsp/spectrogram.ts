import { RealFft, hannWindow } from './fft.ts';

/** Flat triangular bank: band b spans start[b] through start[b]+width[b]-1, weights at offset[b]. */
interface FilterBank {
	bands: number;
	start: Int32Array;
	width: Int32Array;
	offset: Int32Array;
	weights: Float32Array;
	centreHz: Float32Array;
}

function buildBank(fftSize: number, sampleRate: number, centres: number[]): FilterBank {
	const binHz = sampleRate / fftSize;
	const maxBin = fftSize / 2;

	const start: number[] = [];
	const width: number[] = [];
	const offset: number[] = [];
	const weights: number[] = [];
	const centreHz: number[] = [];

	for (let i = 1; i < centres.length - 1; i++) {
		const lo = centres[i - 1] / binHz;
		const mid = centres[i] / binHz;
		const hi = centres[i + 1] / binHz;

		const from = Math.max(0, Math.ceil(lo));
		const to = Math.min(maxBin, Math.floor(hi));
		if (to < from) continue;

		const local: number[] = [];
		let area = 0;
		for (let k = from; k <= to; k++) {
			const w = k <= mid ? (k - lo) / Math.max(mid - lo, 1e-9) : (hi - k) / Math.max(hi - mid, 1e-9);
			const v = Math.max(0, w);
			local.push(v);
			area += v;
		}
		if (area <= 0) continue;

		// Unit area, so a band's value reads as average magnitude density rather than as
		// "how many bins happened to land in it".
		const first = start.length;
		if (first > 0 && start[first - 1] === from && width[first - 1] === local.length) continue;

		start.push(from);
		width.push(local.length);
		offset.push(weights.length);
		for (const v of local) weights.push(v / area);
		centreHz.push(centres[i]);
	}

	return {
		bands: start.length,
		start: Int32Array.from(start),
		width: Int32Array.from(width),
		offset: Int32Array.from(offset),
		weights: Float32Array.from(weights),
		centreHz: Float32Array.from(centreHz)
	};
}

/** Log-spaced triangular bank, the one onset detection is usually built on. */
export function logFilterBank(
	fftSize: number,
	sampleRate: number,
	bandsPerOctave = 24,
	fmin = 30,
	fmax = 17000
): FilterBank {
	const top = Math.min(fmax, sampleRate / 2);
	const centres: number[] = [];
	for (let i = 0; ; i++) {
		const f = fmin * Math.pow(2, i / bandsPerOctave);
		centres.push(f);
		if (f > top) break;
	}
	return buildBank(fftSize, sampleRate, centres);
}

function applyBank(mags: Float32Array, bank: FilterBank, out: Float32Array, at = 0): void {
	for (let b = 0; b < bank.bands; b++) {
		const from = bank.start[b];
		const n = bank.width[b];
		const o = bank.offset[b];
		let acc = 0;
		for (let i = 0; i < n; i++) acc += mags[from + i] * bank.weights[o + i];
		out[at + b] = acc;
	}
}

interface SpectrogramOptions {
	fftSize: number;
	hop: number;
	bank: FilterBank;
}

export interface Spectrogram {
	sampleRate: number;
	hop: number;
	/** Frames per second. */
	fps: number;
	frames: number;
	bands: number;
	/** frames * bands, filtered magnitudes. */
	mag: Float32Array;
	centreHz: Float32Array;
	/** Broadband RMS of each frame's linear spectrum, for level work. */
	rms: Float32Array;
	timeOf(frame: number): number;
	frameOf(time: number): number;
}

/**
 * Reduce STFT directly into filterbank bands to avoid retaining a large linear spectrogram.
 * Frame f is centred on f * hop / sampleRate.
 */
export function computeSpectrogram(
	signal: Float32Array,
	sampleRate: number,
	opts: SpectrogramOptions
): Spectrogram {
	const { fftSize, hop, bank } = opts;
	const fft = new RealFft(fftSize);
	const window = hannWindow(fftSize);
	const mags = new Float32Array(fft.bins);
	const frames = Math.max(1, Math.ceil(signal.length / hop));
	const mag = new Float32Array(frames * bank.bands);
	const rms = new Float32Array(frames);
	const scale = 2 / fftSize;

	for (let f = 0; f < frames; f++) {
		fft.magnitudes(signal, f * hop - (fftSize >> 1), window, mags, scale);
		applyBank(mags, bank, mag, f * bank.bands);
		let acc = 0;
		for (let k = 1; k < mags.length; k++) acc += mags[k] * mags[k];
		rms[f] = Math.sqrt(acc);
	}

	const fps = sampleRate / hop;
	return {
		sampleRate,
		hop,
		fps,
		frames,
		bands: bank.bands,
		mag,
		centreHz: bank.centreHz,
		rms,
		timeOf: (frame) => frame / fps,
		frameOf: (time) => Math.round(time * fps)
	};
}
