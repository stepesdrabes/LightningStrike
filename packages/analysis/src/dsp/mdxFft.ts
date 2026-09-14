import { RealFft, hannWindow } from './fft.ts';

/** MDX23C's torch.stft: n_fft 2048, hop 512, periodic Hann, centred with reflection, unnormalised. */
const MDX_NFFT = 2048;
export const MDX_HOP = 512;
/** The network reads and writes bins 0..1023; the Nyquist bin is dropped and restored as zero. */
export const MDX_BINS = 1024;
const WINDOW = hannWindow(MDX_NFFT);
const FFT = new RealFft(MDX_NFFT);
const UNIT = new Float32Array(MDX_NFFT).fill(1);
const HALF = MDX_NFFT / 2;

function reflect(i: number, length: number): number {
	while (i < 0 || i >= length) i = i < 0 ? -i : 2 * length - 2 - i;
	return i;
}

export const mdxFrames = (length: number) => 1 + Math.floor(length / MDX_HOP);

/** Planar stereo PCM to [4, MDX_BINS, frames]: left real, left imaginary, right real, right imaginary. */
export function mdxSpec(planar: Float32Array, length: number): Float32Array {
	if (!Number.isInteger(length) || length <= HALF || planar.length !== 2 * length) {
		throw new Error('Expected planar stereo PCM longer than half an MDX window.');
	}
	const frames = mdxFrames(length);
	const spec = new Float32Array(4 * MDX_BINS * frames);
	const re = new Float32Array(HALF + 1);
	const im = new Float32Array(HALF + 1);
	const frame = new Float32Array(MDX_NFFT);
	for (let channel = 0; channel < 2; channel++) {
		const offset = channel * length;
		for (let t = 0; t < frames; t++) {
			const start = t * MDX_HOP - HALF;
			for (let j = 0; j < MDX_NFFT; j++) frame[j] = planar[offset + reflect(start + j, length)];
			FFT.forward(frame, 0, WINDOW, re, im);
			for (let f = 0; f < MDX_BINS; f++) {
				spec[((channel * 2) * MDX_BINS + f) * frames + t] = re[f];
				spec[((channel * 2 + 1) * MDX_BINS + f) * frames + t] = im[f];
			}
		}
	}
	return spec;
}

const normalizationCache = new Map<number, Float64Array>();

/** torch.istft's window-square envelope for a centred signal of `length` samples. */
function envelope(length: number): Float64Array {
	const cached = normalizationCache.get(length);
	if (cached) return cached;
	const frames = mdxFrames(length);
	const weight = new Float64Array(length);
	for (let t = 0; t < frames; t++) {
		const start = t * MDX_HOP - HALF;
		const end = Math.min(MDX_NFFT, length - start);
		for (let j = Math.max(0, -start); j < end; j++) weight[start + j] += WINDOW[j] ** 2;
	}
	if (normalizationCache.size >= 2) normalizationCache.delete(normalizationCache.keys().next().value!);
	normalizationCache.set(length, weight);
	return weight;
}

/**
 * [sources, 4, MDX_BINS, frames] to planar stereo per source, [sources, 2, length]. Mirrors
 * torch.istft(center=True) with the zero Nyquist bin MDX23C's inverse pads.
 */
export function mdxIspec(spec: Float32Array, length: number, sources: number): Float32Array {
	const frames = mdxFrames(length);
	if (!Number.isInteger(sources) || sources < 1 || spec.length < sources * 4 * MDX_BINS * frames) {
		throw new Error('Invalid MDX23C spectrogram shape.');
	}
	const result = new Float32Array(sources * 2 * length);
	const weight = envelope(length);
	const packed = new Float32Array(MDX_NFFT);
	const packedRe = new Float32Array(HALF + 1);
	const packedIm = new Float32Array(HALF + 1);
	for (let channel = 0; channel < sources * 2; channel++) {
		const out = result.subarray(channel * length, (channel + 1) * length);
		for (let t = 0; t < frames; t++) {
			packed.fill(0);
			for (let f = 0; f < MDX_BINS; f++) {
				const re = spec[((channel * 2) * MDX_BINS + f) * frames + t];
				const im = spec[((channel * 2 + 1) * MDX_BINS + f) * frames + t];
				// Even real and odd imaginary parts share one real transform, as in separationFft.
				packed[f] = f ? re + im : re;
				if (f) packed[MDX_NFFT - f] = re - im;
			}
			FFT.forward(packed, 0, UNIT, packedRe, packedIm);
			const start = t * MDX_HOP - HALF;
			for (let j = Math.max(0, -start); j < Math.min(MDX_NFFT, length - start); j++) {
				const k = j <= HALF ? j : MDX_NFFT - j;
				const sample = (packedRe[k] + (j <= HALF ? packedIm[k] : -packedIm[k])) / MDX_NFFT;
				out[start + j] += sample * WINDOW[j];
			}
		}
		for (let j = 0; j < length; j++) out[j] /= weight[j] || 1;
	}
	return result;
}
