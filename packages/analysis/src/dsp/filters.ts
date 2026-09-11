/** Normalised direct-form-I biquad: y = b0 x + b1 x1 + b2 x2 - a1 y1 - a2 y2. */
interface Biquad {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
}

function rbj(
	sampleRate: number,
	freq: number,
	q: number,
	kind: 'lowpass' | 'highpass' | 'bandpass'
): Biquad {
	const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
	const cosW = Math.cos(w0);
	const alpha = Math.sin(w0) / (2 * q);
	const a0 = 1 + alpha;

	let b0: number;
	let b1: number;
	let b2: number;
	if (kind === 'lowpass') {
		b0 = (1 - cosW) / 2;
		b1 = 1 - cosW;
		b2 = b0;
	} else if (kind === 'highpass') {
		b0 = (1 + cosW) / 2;
		b1 = -(1 + cosW);
		b2 = b0;
	} else {
		b0 = alpha;
		b1 = 0;
		b2 = -alpha;
	}

	return {
		b0: b0 / a0,
		b1: b1 / a0,
		b2: b2 / a0,
		a1: (-2 * cosW) / a0,
		a2: (1 - alpha) / a0
	};
}

export function lowpass(sampleRate: number, freq: number, q = Math.SQRT1_2): Biquad {
	return rbj(sampleRate, freq, q, 'lowpass');
}

export function applyBiquad(signal: Float32Array, f: Biquad): void {
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < signal.length; i++) {
		const x0 = signal[i];
		const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
		signal[i] = y0;
	}
}

export function applyCascade(signal: Float32Array, filters: readonly Biquad[]): void {
	for (const f of filters) applyBiquad(signal, f);
}

/**
 * ITU-R BS.1770-4 K-weighting: +4 dB shelf and 38 Hz high-pass. Re-derive coefficients for
 * sampleRate; using the 48 kHz table at other rates shifts the filter corners.
 */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
	const shelfF = 1681.974450955533;
	const shelfG = 3.999843853973347;
	const shelfQ = 0.7071752369554196;

	const k = Math.tan((Math.PI * shelfF) / sampleRate);
	const vh = Math.pow(10, shelfG / 20);
	const vb = Math.pow(vh, 0.4996667741545416);
	const s0 = 1 + k / shelfQ + k * k;
	const shelf: Biquad = {
		b0: (vh + (vb * k) / shelfQ + k * k) / s0,
		b1: (2 * (k * k - vh)) / s0,
		b2: (vh - (vb * k) / shelfQ + k * k) / s0,
		a1: (2 * (k * k - 1)) / s0,
		a2: (1 - k / shelfQ + k * k) / s0
	};

	const hpF = 38.13547087602444;
	const hpQ = 0.5003270373238773;
	const kh = Math.tan((Math.PI * hpF) / sampleRate);
	const h0 = 1 + kh / hpQ + kh * kh;
	const hp: Biquad = {
		b0: 1,
		b1: -2,
		b2: 1,
		a1: (2 * (kh * kh - 1)) / h0,
		a2: (1 - kh / hpQ + kh * kh) / h0
	};

	return [shelf, hp];
}

/** Two cascaded Butterworth sections at 0.4 of the new Nyquist prevent aliasing during decimation. */
export function decimate(signal: Float32Array, sampleRate: number, factor: number): Float32Array {
	if (factor <= 1) return Float32Array.from(signal);
	const work = Float32Array.from(signal);
	const cutoff = (sampleRate / factor) * 0.4;
	applyBiquad(work, lowpass(sampleRate, cutoff));
	applyBiquad(work, lowpass(sampleRate, cutoff));

	const out = new Float32Array(Math.floor(signal.length / factor));
	for (let i = 0; i < out.length; i++) out[i] = work[i * factor];
	return out;
}

