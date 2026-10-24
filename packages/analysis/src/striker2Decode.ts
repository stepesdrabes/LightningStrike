import type { ActivityStem, OnsetStream } from '@mv/core';
import type { DrumStream } from './drums.ts';

/** Striker 2.0's coarse drum classes, in its output columns' order after the 13 fine ones. */
export const STRIKER2_CLASSES = ['kick', 'snare', 'hat', 'cymbal', 'tom'] as const;
export type Striker2Class = (typeof STRIKER2_CLASSES)[number];

export const STRIKER2_FPS = 100;

/** One head's picking rule: probability threshold, closest two peaks, offset head's reach (frames). */
export interface PeakRule {
	threshold: number;
	gap: number;
	reach: number;
}

/**
 * numpy's float32 sigmoid, which the reference decoders apply to float32 outputs. Its rounding
 * matters: every logit above about 16.6 maps to exactly 1, so a saturated run is a plateau whose
 * first frame is the peak, as in Python.
 */
export function sigmoid32(x: number): number {
	return Math.fround(1 / Math.fround(1 + Math.fround(Math.exp(-x))));
}

export function round3(v: number): number {
	return Math.round(v * 1000) / 1000;
}

/** Python's round(v, 2) for a float32 v: v * 100 is exact, so only true halves need care. */
export function roundLevel(v: number): number {
	const y = v * 100;
	let r = Math.round(y);
	if (r - y === 0.5 && r % 2 !== 0) r -= 1;
	return r / 100;
}

/**
 * striker-2 `decode.peaks`: frames that hold the largest probability within +-gap frames and reach
 * the threshold (compared in float32, as numpy does), a plateau keeping its first frame.
 */
export function peaks(prob: Float32Array, threshold: number, gap: number): number[] {
	const limit = Math.fround(threshold);
	const kept: number[] = [];
	let last = -gap - 1;
	for (let t = 0; t < prob.length; t++) {
		const p = prob[t];
		if (!(p >= limit)) continue;
		let top = 0;
		for (let k = Math.max(0, t - gap); k <= Math.min(prob.length - 1, t + gap); k++) {
			if (prob[k] > top) top = prob[k];
		}
		if (p !== top || t - last <= gap) continue;
		kept.push(t);
		last = t;
	}
	return kept;
}

/** Column `column` of a [frames, width] row-major output, through the float32 sigmoid. */
export function probabilities(data: Float32Array, width: number, column: number): Float32Array {
	const frames = data.length / width;
	const out = new Float32Array(frames);
	for (let t = 0; t < frames; t++) out[t] = sigmoid32(data[t * width + column]);
	return out;
}

function hits(
	prob: Float32Array, offset: Float32Array, width: number, column: number, rule: PeakRule,
	level: (frame: number) => number, floor: number
): { times: number[]; levels: number[] } {
	const reach = Math.fround(rule.reach);
	const frames = peaks(prob, rule.threshold, rule.gap);
	const shift = (f: number) => Math.min(reach, Math.max(-reach, offset[f * width + column]));
	return {
		times: frames.map((f) => round3((f + shift(f)) / STRIKER2_FPS)),
		levels: frames.map((f) => Math.max(floor, roundLevel(level(f))))
	};
}

/**
 * striker-2 `decode.coarse_hits` on [frames, 13 + 5] outputs: time = (peak frame + clipped offset)
 * / 100 s to 1 ms, level = sigmoid(drum_level) to 0.01, floored so a crossed level never reads 0.
 */
export function coarseHits(
	outputs: { onset: Float32Array; offset: Float32Array; level: Float32Array; width: number },
	firstColumn: number, rules: Record<Striker2Class, PeakRule>, floor: number
): Record<Striker2Class, DrumStream> {
	const { onset, offset, level, width } = outputs;
	const out = {} as Record<Striker2Class, DrumStream>;
	STRIKER2_CLASSES.forEach((cls, i) => {
		const column = firstColumn + i;
		const curve = probabilities(onset, width, column);
		const loudness = (f: number) => sigmoid32(level[f * width + column]);
		const picked = hits(curve, offset, width, column, rules[cls], loudness, floor);
		out[cls] = { ...picked, curve, fps: STRIKER2_FPS };
	});
	return out;
}

/**
 * striker-2 `bass_eval.onsets` on [frames, 3] (onset logit, offset, level). The level column has
 * no training loss, so each onset's level is its probability instead.
 */
export function bassOnsets(bass: Float32Array, rule: PeakRule, floor: number): OnsetStream {
	const prob = probabilities(bass, 3, 0);
	return hits(prob, bass, 3, 1, rule, (f) => prob[f], floor);
}

/** [start, end] seconds where each stem's activity logit is above 0 (probability above 0.5). */
export function activitySpans(
	activity: Float32Array, stems: readonly ActivityStem[]
): Record<ActivityStem, [number, number][]> {
	const width = stems.length;
	const frames = activity.length / width;
	const out = {} as Record<ActivityStem, [number, number][]>;
	stems.forEach((stem, c) => {
		const spans: [number, number][] = [];
		let start = -1;
		for (let t = 0; t <= frames; t++) {
			const on = t < frames && activity[t * width + c] > 0;
			if (on && start < 0) start = t;
			if (!on && start >= 0) {
				spans.push([round3(start / STRIKER2_FPS), round3(t / STRIKER2_FPS)]);
				start = -1;
			}
		}
		out[stem] = spans;
	});
	return out;
}
