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

const { sampleRate: RATE, hop: HOP, a: A, b: B } = STRIKER2_FRONT_END;

export interface Filterbank {
	filters: Float32Array;
	nBins: number;
	fftBins: number;
	/** Inclusive nonzero span of each band's row; zero weights add nothing to its sum. */
	first: Int32Array;
	last: Int32Array;
}

/** Triangular bands on the FFT bins nearest a log-spaced frequency ladder, each row summing to 1. */
function logFilterbank(
	frame: number, rate: number, perOctave: number, fmin: number, fmax: number
): Filterbank {
	const fftBins = frame / 2;
	const binHz = rate / frame;

	const targets: number[] = [];
	const factor = Math.pow(2, 1 / perOctave);
	for (let f = fmin; f <= fmax * (1 + 1e-12); f *= factor) targets.push(f);

	const bins: number[] = [];
	let last = -1;
	for (const f of targets) {
		let best = 0;
		let bestDist = Infinity;
		for (let k = 0; k < fftBins; k++) {
			const d = Math.abs(k * binHz - f);
			if (d < bestDist) {
				bestDist = d;
				best = k;
			}
		}
		if (best > last) {
			bins.push(best);
			last = best;
		}
	}

	const nBins = bins.length - 2;
	const filters = new Float32Array(nBins * fftBins);
	for (let i = 0; i < nBins; i++) {
		const left = bins[i];
		const centre = bins[i + 1];
		const right = bins[i + 2];
		const row = i * fftBins;
		if (right - left < 2) {
			if (left >= 0 && left < fftBins) filters[row + left] = 1;
		} else {
			for (let b = left; b < centre; b++) filters[row + b] = (b - left) / (centre - left);
			if (centre >= 0 && centre < fftBins) filters[row + centre] = 1;
			for (let b = centre + 1; b < Math.min(right, fftBins); b++) {
				filters[row + b] = (right - b) / (right - centre);
			}
		}
		let sum = 0;
		for (let b = 0; b < fftBins; b++) sum += filters[row + b];
		if (sum > 0) for (let b = 0; b < fftBins; b++) filters[row + b] /= sum;
	}
	return { filters, nBins, fftBins, ...filterbankSpans(filters, nBins, fftBins) };
}

/** Each band row's inclusive nonzero span, for a bank laid out as nBins rows of fftBins weights. */
function filterbankSpans(
	filters: Float32Array, nBins: number, fftBins: number
): Pick<Filterbank, 'first' | 'last'> {
	const first = new Int32Array(nBins).fill(fftBins);
	const last = new Int32Array(nBins).fill(-1);
	for (let i = 0; i < nBins; i++) {
		for (let b = 0; b < fftBins; b++) {
			if (filters[i * fftBins + b] === 0) continue;
			first[i] = Math.min(first[i], b);
			last[i] = b;
		}
	}
	return { first, last };
}

/** np.hanning: symmetric, unlike the analysis stack's periodic COLA window. */
function hannSymmetric(size: number): Float32Array {
	const w = new Float32Array(size);
	for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
	return w;
}

/** Branch A's bands, anchored at 20 Hz as ADTOF's PyTorch port anchors them. */
export function branchAFilterbank(): Filterbank {
	return logFilterbank(A.frame, RATE, A.perOctave, A.fmin, A.fmax);
}

/** Branch A: centred 44.1 kHz PCM to log10(1 + band magnitude) rows at 100 fps. */
export function branchASpectrogram(mono: Float32Array, bank: Filterbank): Float32Array {
	const frames = 1 + Math.floor(mono.length / HOP);
	const spec = new Float32Array(frames * bank.nBins);
	const fft = new RealFft(A.frame);
	const window = hannSymmetric(A.frame);
	const mags = new Float32Array(A.frame / 2 + 1);

	for (let t = 0; t < frames; t++) {
		// centre-aligned like librosa's center=True, zero-padded past either end.
		fft.magnitudes(mono, t * HOP - A.frame / 2, window, mags, 1);
		const out = t * bank.nBins;
		for (let i = 0; i < bank.nBins; i++) {
			const row = i * bank.fftBins;
			let acc = 0;
			for (let b = bank.first[i]; b <= bank.last[i]; b++) acc += bank.filters[row + b] * mags[b];
			spec[out + i] = Math.log10(1 + acc);
		}
	}

	return spec;
}

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
	const frames = 1 + Math.floor(mono.length / HOP);
	const a = branchASpectrogram(mono, branchAFilterbank());
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
