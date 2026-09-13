import { RealFft, hannWindow } from './fft.ts';

export const NFFT = 4096;
export const HOP = 1024;
const PAD = 1536;
const WINDOW = hannWindow(NFFT);
const FFT = new RealFft(NFFT);
const UNIT = new Float32Array(NFFT).fill(1);
const NORMALIZATION_CACHE = new Map<number, Float64Array>();
const MAX_CACHED_LENGTH = 352800;

/** Two fixed neural chunk lengths reuse identical window sums; longer inputs stay uncached. */
function inverseNormalization(length: number): Float64Array {
	const cached = NORMALIZATION_CACHE.get(length);
	if (cached) {
		NORMALIZATION_CACHE.delete(length);
		NORMALIZATION_CACHE.set(length, cached);
		return cached;
	}
	const frames = Math.ceil(length / HOP);
	const weight = new Float64Array(length);
	// Include the four zero frames in window-square normalization as torch.istft does.
	for (let t = -2; t < frames + 2; t++) {
		const start = t * HOP - PAD;
		for (let j = Math.max(0, -start); j < Math.min(NFFT, length - start); j++) {
			weight[start + j] += WINDOW[j] ** 2;
		}
	}
	if (length <= MAX_CACHED_LENGTH) {
		if (NORMALIZATION_CACHE.size === 2) NORMALIZATION_CACHE.delete(NORMALIZATION_CACHE.keys().next().value!);
		NORMALIZATION_CACHE.set(length, weight);
	}
	return weight;
}

function reflect(i: number, length: number): number {
	while (i < 0 || i >= length) i = i < 0 ? -i : 2 * length - 2 - i;
	return i;
}

/** HDemucs._magnitude(_spec(mix)): L real, L imaginary, R real, R imaginary. */
export function demucsSpec(mix: Float32Array, length: number): Float32Array {
	if (!Number.isInteger(length) || length < 2 || mix.length !== 2 * length) {
		throw new Error('Expected planar stereo PCM with at least two samples.');
	}
	const frames = Math.ceil(length / HOP);
	const spec = new Float32Array(4 * (NFFT / 2) * frames);
	const re = new Float32Array(NFFT / 2 + 1);
	const im = new Float32Array(NFFT / 2 + 1);
	const frame = new Float32Array(NFFT);
	for (let channel = 0; channel < 2; channel++) {
		for (let t = 0; t < frames; t++) {
			// The two-frame trim cancels torch.stft's centered padding.
			for (let j = 0; j < NFFT; j++) {
				frame[j] = mix[channel * length + reflect(t * HOP + j - PAD, length)];
			}
			FFT.forward(frame, 0, WINDOW, re, im);
			for (let f = 0; f < NFFT / 2; f++) {
				spec[((channel * 2) * (NFFT / 2) + f) * frames + t] = re[f] / Math.sqrt(NFFT);
				spec[((channel * 2 + 1) * (NFFT / 2) + f) * frames + t] = im[f] / Math.sqrt(NFFT);
			}
		}
	}
	return spec;
}

/** HDemucs._ispec with zero Nyquist bin, two zero frames each side, normalized=True. */
export function demucsIspec(spec: Float32Array, length: number, sources = 4): Float32Array {
	const frames = Math.ceil(length / HOP);
	const bins = NFFT / 2;
	if (!Number.isInteger(length) || length < 2 || !Number.isInteger(sources) || sources < 1
		|| spec.length < sources * 4 * bins * frames) {
		throw new Error('Invalid Demucs spectrogram shape.');
	}
	const result = new Float32Array(sources * 2 * length);
	const weight = inverseNormalization(length);
	const packed = new Float32Array(NFFT);
	const packedRe = new Float32Array(bins + 1), packedIm = new Float32Array(bins + 1);
	for (let channel = 0; channel < sources * 2; channel++) {
		const out = result.subarray(channel * length, (channel + 1) * length);
		for (let t = 0; t < frames; t++) {
			packed.fill(0);
			for (let f = 0; f < bins; f++) {
				const re = spec[((channel * 2) * bins + f) * frames + t];
				const im = spec[((channel * 2 + 1) * bins + f) * frames + t];
				// The Hermitian spectrum has even real and odd imaginary components.
				// Packing their sum lets one real FFT recover both: the even transform
				// occupies its real output, and the odd transform its imaginary output.
				packed[f] = f ? re + im : re;
				if (f) packed[NFFT - f] = re - im;
			}
			FFT.forward(packed, 0, UNIT, packedRe, packedIm);
			const start = t * HOP - PAD;
			for (let j = Math.max(0, -start); j < Math.min(NFFT, length - start); j++) {
				const k = j <= bins ? j : NFFT - j;
				const sample = (packedRe[k] + (j <= bins ? packedIm[k] : -packedIm[k])) / Math.sqrt(NFFT);
				out[start + j] += sample * WINDOW[j];
			}
		}
		for (let j = 0; j < length; j++) out[j] /= weight[j] || 1;
	}
	return result;
}
