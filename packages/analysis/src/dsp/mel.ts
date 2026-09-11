import { RealFft } from './fft.ts';

/**
 * Match Essentia TensorflowInputMusiCNN: 16 kHz, FFT 512, hop 256, power 2, Slaney mel
 * 0-8000 Hz, then log10(1 + 10000*x). These constants are model contracts, not tuning.
 */

const MEL_RATE = 16000;
export const MEL_BANDS = 96;
const N_FFT = 512;
const HOP = 256;

/** 22050/16000 in lowest terms, so the fractional phase repeats every UP output samples. */
const UP = 320;
const DOWN = 441;
/** 32 taps of Hann-windowed sinc: enough stopband that aliased content sits below what the
 * log compression can surface, at a cost the 3-minute cap keeps invisible. */
const HALF_TAPS = 16;
const TAPS = 2 * HALF_TAPS;

let polyphase: Float32Array | null = null;

function buildPolyphase(): Float32Array {
	const table = new Float32Array(UP * TAPS);
	// Cutoff at the output Nyquist (8 kHz), which is also the top of the mel range.
	const c = UP / DOWN;
	for (let p = 0; p < UP; p++) {
		const frac = p / UP;
		let sum = 0;
		for (let m = 0; m < TAPS; m++) {
			// Offset of input sample n0 - 15 + m from the ideal output point n0 + frac.
			const u = m - (HALF_TAPS - 1) - frac;
			const x = Math.PI * c * u;
			const sinc = x === 0 ? 1 : Math.sin(x) / x;
			const w = 0.5 * (1 + Math.cos((Math.PI * u) / HALF_TAPS));
			const v = c * sinc * w;
			table[p * TAPS + m] = v;
			sum += v;
		}
		// Unity DC gain per phase, or the truncated kernel would ripple the level at 320 Hz.
		for (let m = 0; m < TAPS; m++) table[p * TAPS + m] /= sum;
	}
	return table;
}

/**
 * Windowed-sinc resampling avoids aliasing and high-frequency droop in model mel bands.
 * A polyphase table precomputes the 32-tap kernels.
 */
export function resampleTo16k(mono22k: Float32Array): Float32Array {
	polyphase ??= buildPolyphase();
	const table = polyphase;
	const inLen = mono22k.length;
	const outLen = Math.floor((inLen * UP) / DOWN);
	const out = new Float32Array(outLen);

	for (let j = 0; j < outLen; j++) {
		const num = j * DOWN;
		const p = num % UP;
		const start = (num - p) / UP - (HALF_TAPS - 1);
		const base = p * TAPS;
		let acc = 0;
		if (start >= 0 && start + TAPS <= inLen) {
			for (let m = 0; m < TAPS; m++) acc += mono22k[start + m] * table[base + m];
		} else {
			for (let m = 0; m < TAPS; m++) {
				const n = start + m;
				if (n >= 0 && n < inLen) acc += mono22k[n] * table[base + m];
			}
		}
		out[j] = acc;
	}
	return out;
}

/** Slaney (Auditory Toolbox) mel: linear below 1 kHz, log above. Not the HTK formula. */
const F_SP = 200 / 3;
const MIN_LOG_HZ = 1000;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP;
const LOG_STEP = Math.log(6.4) / 27;

function hzToMel(hz: number): number {
	return hz < MIN_LOG_HZ ? hz / F_SP : MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP;
}

function melToHz(mel: number): number {
	return mel < MIN_LOG_MEL ? mel * F_SP : MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL));
}

interface MelBand {
	/** First FFT bin with non-zero weight. */
	start: number;
	coef: Float32Array;
}

/** 96 Slaney-normalised triangles, 0-8000 Hz. Store nonzero bin ranges to skip sparse weights. */
function melBands96(): MelBand[] {
	const bins = N_FFT / 2 + 1;
	const melMax = hzToMel(MEL_RATE / 2);
	const hz: number[] = [];
	for (let i = 0; i < MEL_BANDS + 2; i++) hz.push(melToHz((melMax * i) / (MEL_BANDS + 1)));

	const bands: MelBand[] = [];
	for (let b = 0; b < MEL_BANDS; b++) {
		const lo = hz[b];
		const mid = hz[b + 1];
		const hi = hz[b + 2];
		// 'slaney' / unit_tri: each triangle integrates to one, so band energy is per-Hz
		// density rather than growing with the widening triangles.
		const norm = 2 / (hi - lo);
		const weights: number[] = [];
		let start = -1;
		for (let k = 0; k < bins; k++) {
			const f = (k * MEL_RATE) / N_FFT;
			const w = Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid));
			if (w > 0) {
				if (start < 0) start = k;
				weights.push(w * norm);
			} else if (start >= 0) {
				break;
			}
		}
		bands.push({ start: Math.max(start, 0), coef: Float32Array.from(weights) });
	}
	return bands;
}

/** Use Essentia's symmetric Hann; fft.ts uses a periodic window for COLA. */
function symmetricHann(size: number): Float32Array {
	const w = new Float32Array(size);
	for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
	return w;
}

/**
 * 16 kHz mono to frame-major 96-band log10(1 + 10000 * mel power). Centre frames at f * hop
 * with zero padding, matching the training FrameCutter.
 */
export function melSpectrogram96(mono16k: Float32Array): { frames: number; data: Float32Array } {
	const bands = melBands96();
	const bins = N_FFT / 2 + 1;
	const frames = 1 + Math.floor(mono16k.length / HOP);
	const fft = new RealFft(N_FFT);
	const window = symmetricHann(N_FFT);
	const power = new Float32Array(bins);
	const out = new Float32Array(frames * MEL_BANDS);

	for (let f = 0; f < frames; f++) {
		fft.magnitudes(mono16k, f * HOP - (N_FFT >> 1), window, power, 1);
		for (let k = 0; k < bins; k++) power[k] *= power[k];
		const o = f * MEL_BANDS;
		for (let b = 0; b < MEL_BANDS; b++) {
			const band = bands[b];
			const coef = band.coef;
			let acc = 0;
			for (let i = 0; i < coef.length; i++) acc += power[band.start + i] * coef[i];
			out[o + b] = Math.log10(1 + 10000 * acc);
		}
	}
	return { frames, data: out };
}
