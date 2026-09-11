import type { Spectrogram } from './dsp/spectrogram.ts';
import { maxFilter, quantile, smooth } from './dsp/stats.ts';

/**
 * SuperFlux (Böck & Widmer, DAFx 2013): max-filter the preceding log-frequency frame before
 * subtracting it so vibrato and slow pitch glides do not become onsets.
 */
export interface OnsetCurves {
	fps: number;
	frames: number;
	/** Broadband SuperFlux, the curve tempo and beat tracking run on. */
	flux: Float32Array;
	/** The same flux restricted to a band range, for drums and downbeats. */
	low: Float32Array;
	mid: Float32Array;
	high: Float32Array;
}

const MAX_FILTER_BANDS = 1;
/** Difference across half a window; adjacent-frame differences mostly measure window overlap. */
const DIFF_FRAMES = 2;

function bandRange(spec: Spectrogram, loHz: number, hiHz: number): [number, number] {
	let lo = 0;
	let hi = spec.bands;
	while (lo < spec.bands && spec.centreHz[lo] < loHz) lo++;
	while (hi > lo && spec.centreHz[hi - 1] > hiHz) hi--;
	return [lo, Math.max(hi, lo + 1)];
}

export function onsetStrength(spec: Spectrogram): OnsetCurves {
	const { frames, bands } = spec;

	// log10(1 + mag): compression, so an onset in a quiet intro is the same size as one in a
	// loud drop and a single threshold can serve both.
	const logMag = new Float32Array(frames * bands);
	for (let i = 0; i < logMag.length; i++) logMag[i] = Math.log10(1 + spec.mag[i]);

	const maxed = new Float32Array(frames * bands);
	for (let f = 0; f < frames; f++) {
		const o = f * bands;
		for (let b = 0; b < bands; b++) {
			let m = 0;
			const from = Math.max(0, b - MAX_FILTER_BANDS);
			const to = Math.min(bands - 1, b + MAX_FILTER_BANDS);
			for (let k = from; k <= to; k++) if (logMag[o + k] > m) m = logMag[o + k];
			maxed[o + b] = m;
		}
	}

	const ranges: [number, number][] = [
		bandRange(spec, 0, 22050),
		bandRange(spec, 0, 160),
		bandRange(spec, 160, 2000),
		bandRange(spec, 2000, 22050)
	];
	const out = ranges.map(() => new Float32Array(frames));

	for (let f = DIFF_FRAMES; f < frames; f++) {
		const cur = f * bands;
		const prev = (f - DIFF_FRAMES) * bands;
		for (let r = 0; r < ranges.length; r++) {
			const [lo, hi] = ranges[r];
			let acc = 0;
			for (let b = lo; b < hi; b++) {
				const d = logMag[cur + b] - maxed[prev + b];
				if (d > 0) acc += d;
			}
			out[r][f] = acc;
		}
	}

	return { fps: spec.fps, frames, flux: out[0], low: out[1], mid: out[2], high: out[3] };
}

/** Subtract local mean and scale by local spread so thresholds transfer between sparse and dense passages. */
export function conditionCurve(curve: Float32Array, fps: number, windowSec = 1.5): Float32Array {
	const n = curve.length;
	const out = new Float32Array(n);
	const radius = Math.max(1, Math.round(windowSec * fps));
	const trend = smooth(curve, radius);

	for (let i = 0; i < n; i++) out[i] = Math.max(0, curve[i] - trend[i]);

	// Scale by a high quantile rather than by the maximum: one cymbal crash should not push
	// the entire track's curve into the floor.
	const top = quantile(out, 0.98);
	if (top > 1e-9) for (let i = 0; i < n; i++) out[i] /= top;
	return out;
}

interface PeakOptions {
	/** A peak must be the maximum over this radius, in seconds. */
	localMaxSec: number;
	/** ... and exceed the moving mean over this radius by `delta`. */
	movingMeanSec: number;
	delta: number;
	/** Minimum gap between reported peaks, in seconds. */
	refractorySec: number;
}

export interface Peak {
	frame: number;
	time: number;
	strength: number;
}

/** Adaptive-floor local maxima with a refractory gap. Strength is the excess above the floor. */
export function pickPeaks(curve: Float32Array, fps: number, opts: PeakOptions): Peak[] {
	const n = curve.length;
	if (n === 0) return [];

	const maxRadius = Math.max(1, Math.round(opts.localMaxSec * fps));
	const meanRadius = Math.max(1, Math.round(opts.movingMeanSec * fps));
	const refractory = Math.max(1, Math.round(opts.refractorySec * fps));

	const local = maxFilter(curve, maxRadius);
	const floor = smooth(curve, meanRadius);

	const peaks: Peak[] = [];
	let last = -refractory - 1;
	for (let i = 0; i < n; i++) {
		const v = curve[i];
		if (v < local[i] || v < floor[i] + opts.delta || v <= 0) continue;
		if (i - last < refractory) {
			// Keep the stronger of two peaks inside one refractory window rather than the first,
			// so a soft pre-hit cannot mask the beat behind it.
			const prev = peaks[peaks.length - 1];
			if (prev && v - floor[i] > prev.strength) {
				peaks[peaks.length - 1] = { frame: i, time: i / fps, strength: v - floor[i] };
				last = i;
			}
			continue;
		}
		peaks.push({ frame: i, time: i / fps, strength: v - floor[i] });
		last = i;
	}
	return peaks;
}

/** Peaks refined to sub-frame accuracy by a parabola through the three samples at the top. */
export function refinePeakTime(curve: Float32Array, frame: number, fps: number): number {
	if (frame <= 0 || frame >= curve.length - 1) return frame / fps;
	const a = curve[frame - 1];
	const b = curve[frame];
	const c = curve[frame + 1];
	const denom = a - 2 * b + c;
	const shift = Math.abs(denom) < 1e-12 ? 0 : (0.5 * (a - c)) / denom;
	return (frame + Math.max(-0.5, Math.min(0.5, shift))) / fps;
}
