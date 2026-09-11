import { RealFft, hannWindow } from './dsp/fft.ts';
import { decimate } from './dsp/filters.ts';

export const PITCH_CLASSES = 12;

/** C2 to C7. Below C2 an STFT cannot separate semitones; above C7 it is mostly cymbals. */
const FMIN = 65.406;
const OCTAVES = 5;
/** Three bins per semitone, so a slightly detuned instrument still lands in its own bin. */
const BINS_PER_SEMITONE = 3;

export interface Chromagram {
	fps: number;
	frames: number;
	/** frames * 12, each frame L2-normalised. C is index 0. */
	values: Float32Array;
	/** frames * 12, unnormalised energy, for key estimation and level work. */
	energy: Float32Array;
	timeOf(frame: number): number;
}

/**
 * Decimate to 11 kHz before chroma: a 2048-point window retains ~5 Hz pitch resolution at
 * one quarter of the 44.1 kHz cost; discarded frequencies are above the pitch range.
 */
export function chromagram(mono: Float32Array, sampleRate: number, targetFps = 50): Chromagram {
	const factor = Math.max(1, Math.round(sampleRate / 11025));
	const sr = sampleRate / factor;
	const signal = decimate(mono, sampleRate, factor);

	const fftSize = 2048;
	const hop = Math.max(1, Math.round(sr / targetFps));
	const fft = new RealFft(fftSize);
	const window = hannWindow(fftSize);
	const mags = new Float32Array(fft.bins);

	const semitones = OCTAVES * PITCH_CLASSES;
	const bins = semitones * BINS_PER_SEMITONE;
	const binHz = sr / fftSize;

	// One triangular filter per third-of-a-semitone, in log frequency.
	const centre = new Float64Array(bins);
	for (let i = 0; i < bins; i++) {
		centre[i] = FMIN * Math.pow(2, i / (PITCH_CLASSES * BINS_PER_SEMITONE));
	}

	const frames = Math.max(1, Math.ceil(signal.length / hop));
	const values = new Float32Array(frames * PITCH_CLASSES);
	const energy = new Float32Array(frames * PITCH_CLASSES);
	const scale = 2 / fftSize;
	const halfStep = Math.pow(2, 1 / (2 * PITCH_CLASSES * BINS_PER_SEMITONE));

	for (let f = 0; f < frames; f++) {
		fft.magnitudes(signal, f * hop - (fftSize >> 1), window, mags, scale);
		const out = f * PITCH_CLASSES;

		for (let i = 0; i < bins; i++) {
			const lo = centre[i] / halfStep / binHz;
			const hi = (centre[i] * halfStep) / binHz;
			const from = Math.max(1, Math.floor(lo));
			const to = Math.min(fft.bins - 1, Math.ceil(hi));
			let acc = 0;
			for (let k = from; k <= to; k++) {
				// Triangle in bin space, so a partial straddling two bins is not counted twice.
				const w = 1 - Math.abs(k - (lo + hi) / 2) / Math.max((hi - lo) / 2 + 0.5, 1e-9);
				if (w > 0) acc += mags[k] * w;
			}
			energy[out + (Math.round(i / BINS_PER_SEMITONE) % PITCH_CLASSES)] += acc;
		}

		let norm = 0;
		for (let p = 0; p < PITCH_CLASSES; p++) norm += energy[out + p] ** 2;
		norm = Math.sqrt(norm);
		if (norm > 1e-9) {
			for (let p = 0; p < PITCH_CLASSES; p++) values[out + p] = energy[out + p] / norm;
		}
	}

	const fps = sr / hop;
	return { fps, frames, values, energy, timeOf: (frame) => frame / fps };
}

/**
 * Temperley (2001) revision of Krumhansl-Kessler profiles. Report tonic and mode confidence
 * separately because tonic is usually easier to identify.
 */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const NOTE_NAMES = [
	'C',
	'C#',
	'D',
	'D#',
	'E',
	'F',
	'F#',
	'G',
	'G#',
	'A',
	'A#',
	'B'
] as const;

export interface KeyEstimate {
	tonic: number;
	name: string;
	mode: 'major' | 'minor';
	/** Correlation of the winner, 0..1 after clamping. */
	confidence: number;
}

function correlate(a: readonly number[], b: readonly number[], rotate: number): number {
	const n = a.length;
	let ma = 0;
	let mb = 0;
	for (let i = 0; i < n; i++) {
		ma += a[i];
		mb += b[i];
	}
	ma /= n;
	mb /= n;

	let num = 0;
	let da = 0;
	let db = 0;
	for (let i = 0; i < n; i++) {
		const x = a[i] - ma;
		const y = b[(i + rotate) % n] - mb;
		num += x * y;
		da += x * x;
		db += y * y;
	}
	return num / (Math.sqrt(da * db) + 1e-12);
}

export function estimateKey(chroma: Chromagram): KeyEstimate {
	return estimateKeySpan(chroma, 0, chroma.frames / chroma.fps);
}

/** Estimate one span with the same key profiles; the caller interprets disagreements between spans. */
export function estimateKeySpan(chroma: Chromagram, fromSec: number, toSec: number): KeyEstimate {
	const from = Math.max(0, Math.floor(fromSec * chroma.fps));
	const to = Math.min(chroma.frames, Math.ceil(toSec * chroma.fps));
	const avg = new Array<number>(PITCH_CLASSES).fill(0);
	for (let f = from; f < to; f++) {
		const o = f * PITCH_CLASSES;
		for (let p = 0; p < PITCH_CLASSES; p++) avg[p] += chroma.values[o + p];
	}

	let best = { tonic: 0, mode: 'major' as const, score: -2 };
	for (let tonic = 0; tonic < PITCH_CLASSES; tonic++) {
		const major = correlate(MAJOR, avg, -tonic + PITCH_CLASSES);
		const minor = correlate(MINOR, avg, -tonic + PITCH_CLASSES);
		if (major > best.score) best = { tonic, mode: 'major', score: major };
		if (minor > best.score) best = { tonic, mode: 'minor' as 'major', score: minor };
	}

	return {
		tonic: best.tonic,
		name: `${NOTE_NAMES[best.tonic]} ${best.mode}`,
		mode: best.mode,
		confidence: Math.max(0, Math.min(1, best.score))
	};
}
