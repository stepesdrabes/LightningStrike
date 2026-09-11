import type { Chromagram } from './chroma.ts';
import type { Spectrogram } from './dsp/spectrogram.ts';
import type { OnsetCurves } from './onsets.ts';
import { PITCH_CLASSES } from './chroma.ts';

/** Beat aggregation aligns repeats across tempo changes and reduces quadratic structure costs. */
export interface BeatFeatures {
	count: number;
	/** Beat start times; `time[count]` holds the end of the last beat. */
	time: Float64Array;
	/** count * bands, mean log-magnitude through the filterbank. */
	spectral: Float32Array;
	bands: number;
	/** count * 12, L2-normalised. */
	chroma: Float32Array;
	/** Onset strength at the beat instant, by band group. */
	flux: Float32Array;
	low: Float32Array;
	mid: Float32Array;
	high: Float32Array;
	/** Mean level over the beat, linear. */
	rms: Float32Array;
	/** Mean low-band energy over the beat, linear; the bassline, not its attack. */
	bass: Float32Array;
}

/** Peak rather than mean of the onset curve near a beat: an attack is an event, not a level. */
function peakNear(curve: Float32Array, fps: number, t: number, radiusSec: number): number {
	const c = Math.round(t * fps);
	const r = Math.max(1, Math.round(radiusSec * fps));
	let m = 0;
	for (let i = Math.max(0, c - r); i <= Math.min(curve.length - 1, c + r); i++) {
		if (curve[i] > m) m = curve[i];
	}
	return m;
}

export function beatSynchronous(
	spec: Spectrogram,
	chroma: Chromagram,
	curves: OnsetCurves,
	odf: Float32Array,
	beats: Float64Array,
	duration: number
): BeatFeatures {
	const count = Math.max(0, beats.length - 1);
	const bands = spec.bands;

	const time = new Float64Array(count + 1);
	for (let i = 0; i <= count; i++) time[i] = beats[i] ?? duration;

	const spectral = new Float32Array(count * bands);
	const chromaOut = new Float32Array(count * PITCH_CLASSES);
	const flux = new Float32Array(count);
	const low = new Float32Array(count);
	const mid = new Float32Array(count);
	const high = new Float32Array(count);
	const rms = new Float32Array(count);
	const bass = new Float32Array(count);

	// Low band means "the bassline", so it stops where a kick's body does rather than where
	// the contract's sub/low split happens to fall.
	let bassBands = 0;
	while (bassBands < bands && spec.centreHz[bassBands] < 200) bassBands++;
	bassBands = Math.max(1, bassBands);

	for (let b = 0; b < count; b++) {
		const f0 = Math.max(0, Math.round(time[b] * spec.fps));
		const f1 = Math.max(f0 + 1, Math.min(spec.frames, Math.round(time[b + 1] * spec.fps)));
		const n = f1 - f0;

		for (let k = 0; k < bands; k++) {
			let acc = 0;
			for (let f = f0; f < f1; f++) acc += spec.mag[f * bands + k];
			// Log after averaging: a section's identity is its average spectrum, and averaging
			// in dB would let one silent frame drag a whole beat down.
			spectral[b * bands + k] = Math.log10(1 + acc / n);
		}

		let acc = 0;
		for (let f = f0; f < f1; f++) acc += spec.rms[f];
		rms[b] = acc / n;

		let lowAcc = 0;
		for (let f = f0; f < f1; f++) {
			for (let k = 0; k < bassBands; k++) lowAcc += spec.mag[f * bands + k];
		}
		bass[b] = lowAcc / (n * bassBands);

		const c0 = Math.max(0, Math.round(time[b] * chroma.fps));
		const c1 = Math.max(c0 + 1, Math.min(chroma.frames, Math.round(time[b + 1] * chroma.fps)));
		let norm = 0;
		for (let p = 0; p < PITCH_CLASSES; p++) {
			let v = 0;
			for (let f = c0; f < c1; f++) v += chroma.values[f * PITCH_CLASSES + p];
			v /= c1 - c0;
			chromaOut[b * PITCH_CLASSES + p] = v;
			norm += v * v;
		}
		norm = Math.sqrt(norm);
		if (norm > 1e-9) {
			for (let p = 0; p < PITCH_CLASSES; p++) chromaOut[b * PITCH_CLASSES + p] /= norm;
		}

		// Half a beat is too wide and a frame is too narrow: an attack can sit up to about
		// 60 ms off the grid and still be that beat's hit.
		const radius = Math.min(0.06, (time[b + 1] - time[b]) * 0.3);
		flux[b] = peakNear(odf, curves.fps, time[b], radius);
		low[b] = peakNear(curves.low, curves.fps, time[b], radius);
		mid[b] = peakNear(curves.mid, curves.fps, time[b], radius);
		high[b] = peakNear(curves.high, curves.fps, time[b], radius);
	}

	return {
		count,
		time,
		spectral,
		bands,
		chroma: chromaOut,
		flux,
		low,
		mid,
		high,
		rms,
		bass
	};
}

/** Cosine distance between two rows of a flattened matrix. */
export function rowDistance(a: Float32Array, i: number, j: number, dim: number): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let k = 0; k < dim; k++) {
		const x = a[i * dim + k];
		const y = a[j * dim + k];
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	return 1 - dot / (Math.sqrt(na * nb) + 1e-12);
}

