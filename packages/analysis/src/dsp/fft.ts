/**
 * Radix-2 FFT with a half-length real-input wrapper. Float64 working buffers avoid Float32
 * rounding on every butterfly store in V8.
 */
class Fft {
	readonly size: number;
	private readonly rev: Uint32Array;
	private readonly cos: Float64Array;
	private readonly sin: Float64Array;

	constructor(size: number) {
		if (size < 2 || (size & (size - 1)) !== 0) {
			throw new Error(`FFT size must be a power of two >= 2: ${size}`);
		}
		this.size = size;

		const bits = Math.log2(size);
		this.rev = new Uint32Array(size);
		for (let i = 0; i < size; i++) {
			let r = 0;
			for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
			this.rev[i] = r;
		}

		const half = size >> 1;
		this.cos = new Float64Array(half);
		this.sin = new Float64Array(half);
		for (let i = 0; i < half; i++) {
			this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
			this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
		}
	}

	transform(re: Float64Array, im: Float64Array): void {
		const n = this.size;
		const rev = this.rev;
		const tcos = this.cos;
		const tsin = this.sin;

		for (let i = 0; i < n; i++) {
			const j = rev[i];
			if (j > i) {
				let t = re[i];
				re[i] = re[j];
				re[j] = t;
				t = im[i];
				im[i] = im[j];
				im[j] = t;
			}
		}

		for (let len = 2; len <= n; len <<= 1) {
			const half = len >> 1;
			const step = n / len;
			for (let i = 0; i < n; i += len) {
				for (let k = 0; k < half; k++) {
					const tw = k * step;
					const wr = tcos[tw];
					const wi = tsin[tw];
					const a = i + k;
					const b = a + half;
					const xr = re[b] * wr - im[b] * wi;
					const xi = re[b] * wi + im[b] * wr;
					re[b] = re[a] - xr;
					im[b] = im[a] - xi;
					re[a] += xr;
					im[a] += xi;
				}
			}
		}
	}
}

/** Real-input FFT of size N, producing bins 0..N/2 inclusive. */
export class RealFft {
	readonly size: number;
	readonly bins: number;

	private readonly half: Fft;
	private readonly re: Float64Array;
	private readonly im: Float64Array;
	private readonly twCos: Float64Array;
	private readonly twSin: Float64Array;

	constructor(size: number) {
		if (size < 4 || (size & (size - 1)) !== 0) {
			throw new Error(`Real FFT size must be a power of two >= 4: ${size}`);
		}
		this.size = size;
		this.bins = size / 2 + 1;

		const h = size >> 1;
		this.half = new Fft(h);
		this.re = new Float64Array(h);
		this.im = new Float64Array(h);
		this.twCos = new Float64Array(h);
		this.twSin = new Float64Array(h);
		for (let k = 0; k < h; k++) {
			this.twCos[k] = Math.cos((-2 * Math.PI * k) / size);
			this.twSin[k] = Math.sin((-2 * Math.PI * k) / size);
		}
	}

	/** Even samples into the real part, odd into the imaginary part, then transform. */
	private pack(signal: Float32Array, offset: number, window: Float32Array): void {
		const h = this.size >> 1;
		const re = this.re;
		const im = this.im;
		const n = signal.length;
		for (let k = 0; k < h; k++) {
			const a = offset + 2 * k;
			const b = a + 1;
			re[k] = a >= 0 && a < n ? signal[a] * window[2 * k] : 0;
			im[k] = b >= 0 && b < n ? signal[b] * window[2 * k + 1] : 0;
		}
		this.half.transform(re, im);
	}

	/** Windowed spectrum at offset, zero-padded outside signal. Output arrays must hold bins values. */
	forward(
		signal: Float32Array,
		offset: number,
		window: Float32Array,
		outRe: Float32Array,
		outIm: Float32Array
	): void {
		this.pack(signal, offset, window);

		const h = this.size >> 1;
		const re = this.re;
		const im = this.im;

		// Untangle conjugate-symmetric even/odd spectra with a half-bin twiddle. Reusing each pair
		// for h-k limits the loop to a quarter turn.
		for (let k = 0; k <= h >> 1; k++) {
			const j = (h - k) % h;
			const evenRe = 0.5 * (re[k] + re[j]);
			const evenIm = 0.5 * (im[k] - im[j]);
			const oddRe = 0.5 * (im[k] + im[j]);
			const oddIm = -0.5 * (re[k] - re[j]);

			const wr = this.twCos[k];
			const wi = this.twSin[k];
			const tr = oddRe * wr - oddIm * wi;
			const ti = oddRe * wi + oddIm * wr;

			outRe[k] = evenRe + tr;
			outIm[k] = evenIm + ti;
			const m = h - k;
			outRe[m] = evenRe - tr;
			outIm[m] = -(evenIm - ti);
		}

		outRe[h] = re[0] - im[0];
		outIm[h] = 0;
	}

	/** Magnitudes for bins 0..N/2, multiplied by `scale`. */
	magnitudes(
		signal: Float32Array,
		offset: number,
		window: Float32Array,
		out: Float32Array,
		scale: number
	): void {
		this.pack(signal, offset, window);

		const h = this.size >> 1;
		const re = this.re;
		const im = this.im;

		for (let k = 0; k <= h >> 1; k++) {
			const j = (h - k) % h;
			const evenRe = 0.5 * (re[k] + re[j]);
			const evenIm = 0.5 * (im[k] - im[j]);
			const oddRe = 0.5 * (im[k] + im[j]);
			const oddIm = -0.5 * (re[k] - re[j]);

			const wr = this.twCos[k];
			const wi = this.twSin[k];
			const tr = oddRe * wr - oddIm * wi;
			const ti = oddRe * wi + oddIm * wr;

			const ar = evenRe + tr;
			const ai = evenIm + ti;
			out[k] = Math.sqrt(ar * ar + ai * ai) * scale;

			const br = evenRe - tr;
			const bi = evenIm - ti;
			out[h - k] = Math.sqrt(br * br + bi * bi) * scale;
		}

		out[h] = Math.abs(re[0] - im[0]) * scale;
	}
}

/** Periodic Hann, which is the one that satisfies COLA for overlapped analysis. */
export function hannWindow(size: number): Float32Array {
	const w = new Float32Array(size);
	for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
	return w;
}
