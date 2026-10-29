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

/** One row of log10(1 + band magnitude) from the frame centred at sample `centre`, into `out`. */
function bandRow(
	signal: Float32Array, centre: number, fft: RealFft, window: Float32Array, mags: Float32Array,
	bank: Filterbank, out: Float32Array, at: number
): void {
	// centre-aligned like librosa's center=True, zero-padded past either end.
	fft.magnitudes(signal, centre - window.length / 2, window, mags, 1);
	for (let i = 0; i < bank.nBins; i++) {
		const row = i * bank.fftBins;
		let acc = 0;
		for (let b = bank.first[i]; b <= bank.last[i]; b++) acc += bank.filters[row + b] * mags[b];
		out[at + i] = Math.log10(1 + acc);
	}
}

/** Branch A: centred 44.1 kHz PCM to log10(1 + band magnitude) rows at 100 fps. */
export function branchASpectrogram(mono: Float32Array, bank: Filterbank): Float32Array {
	const frames = 1 + Math.floor(mono.length / HOP);
	const spec = new Float32Array(frames * bank.nBins);
	const fft = new RealFft(A.frame);
	const window = hannSymmetric(A.frame);
	const mags = new Float32Array(A.frame / 2 + 1);
	for (let t = 0; t < frames; t++) {
		bandRow(mono, t * HOP, fft, window, mags, bank, spec, t * bank.nBins);
	}
	return spec;
}

/** d[m] = sum_k h[k] x[9m + k - half] for m in [from, to): the zero-phase low-pass, every ninth. */
function decimateInto(
	mono: Float32Array, taps: Float32Array, out: Float32Array, from: number, to: number
): void {
	const half = (taps.length - 1) / 2;
	for (let m = from; m < to; m++) {
		const base = m * B.decimate - half;
		let acc = 0;
		const first = Math.max(0, -base);
		const last = Math.min(taps.length, mono.length - base);
		for (let k = first; k < last; k++) acc += taps[k] * mono[base + k];
		out[m] = acc;
	}
}

/**
 * 44.1 kHz mono, (L + R) / 2, to [frames, 179] float32 rows at 100 fps, computed on demand:
 * `through(t)` fills every row before t once. Each row depends on the PCM alone, so any order of
 * calls leaves the same bits as one pass.
 */
export class Striker2FrontEnd {
	readonly frames: number;
	readonly bins: number;
	readonly data: Float32Array;
	private readonly a = branchAFilterbank();
	private readonly b = logFilterbank(B.frame, B.rate, B.perOctave, B.fmin, B.fmax);
	private readonly fftA = new RealFft(A.frame);
	private readonly fftB = new RealFft(B.frame);
	private readonly windowA = hannSymmetric(A.frame);
	private readonly windowB = hannSymmetric(B.frame);
	private readonly magsA = new Float32Array(A.frame / 2 + 1);
	private readonly magsB = new Float32Array(B.frame / 2 + 1);
	private readonly mono: Float32Array;
	private readonly taps: Float32Array;
	private readonly low: Float32Array;
	private rows = 0;
	private decimated = 0;

	constructor(mono: Float32Array, taps: Float32Array) {
		this.mono = mono;
		this.taps = taps;
		this.frames = 1 + Math.floor(mono.length / HOP);
		this.bins = this.a.nBins + this.b.nBins;
		this.data = new Float32Array(this.frames * this.bins);
		this.low = new Float32Array(Math.ceil(mono.length / B.decimate));
	}

	through(frame: number): void {
		const to = Math.min(frame, this.frames);
		if (to <= this.rows) return;
		// Branch B's last frame reads the low band up to (to - 1) * hop + frame / 2, exclusive.
		const needed = Math.min(this.low.length, (to - 1) * B.hop + B.frame / 2);
		if (needed > this.decimated) {
			decimateInto(this.mono, this.taps, this.low, this.decimated, needed);
			this.decimated = needed;
		}
		const { a, b, bins, data } = this;
		for (let t = this.rows; t < to; t++) {
			const at = t * bins;
			bandRow(this.mono, t * HOP, this.fftA, this.windowA, this.magsA, a, data, at);
			bandRow(this.low, t * B.hop, this.fftB, this.windowB, this.magsB, b, data, at + a.nBins);
		}
		this.rows = to;
	}
}

export function striker2Features(
	mono: Float32Array, taps: Float32Array
): { data: Float32Array; frames: number; bins: number } {
	const front = new Striker2FrontEnd(mono, taps);
	front.through(front.frames);
	return { data: front.data, frames: front.frames, bins: front.bins };
}
