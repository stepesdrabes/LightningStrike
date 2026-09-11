import { MAX_BPM, MIN_BPM } from './tempo.ts';
import { sampleAt } from './dsp/stats.ts';

/**
 * Assess metrical ambiguity without correcting the tracker: midpoint onset strength and
 * tempo priors do not reliably choose the level. The listener makes that decision.
 */

/** Where the perceptual tactus sits, and how wide in octaves. Matches `tempo.ts`. */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 0.6;
/**
 * Offer prior-supported relatives without onset gating: real hats can occupy the beats a
 * half-time reading drops. Include 2:3 relationships as well as tempo octaves.
 */
const RELATIVES = [1 / 2, 2 / 3, 3 / 2, 2];
/** The tactus prior controls correction prominence only; alternatives remain available on every track. */
const UNUSUAL_TACTUS = 0.6;

function prior(bpm: number): number {
	return Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2);
}

function meanAt(odf: Float32Array, fps: number, times: readonly number[]): number {
	if (times.length === 0) return 0;
	let acc = 0;
	for (const t of times) acc += sampleAt(odf, t * fps);
	return acc / times.length;
}

/** Use 8-beat spans to reduce the model's 20 ms beat-time quantisation error by a factor of eight. */
export function medianPeriod(beats: readonly number[]): number {
	if (beats.length < 2) return 0;
	const span = beats.length >= 18 ? 8 : 1;
	const d: number[] = [];
	for (let i = span; i < beats.length; i++) d.push((beats[i] - beats[i - span]) / span);
	d.sort((a, b) => a - b);
	return d[d.length >> 1];
}

interface MetricalAssessment {
	bpm: number;
	/** True when half or double is defensible on the evidence, so a listener may disagree. */
	ambiguous: boolean;
	/** 0..1. How safe the reported level is; low means offer the correction prominently. */
	confidence: number;
	/** Readings a listener might prefer, most plausible first. Empty when nothing rivals. */
	alternatives: number[];
	reason: string;
}

export function assessMetricalLevel(
	beats: readonly number[],
	odf: Float32Array,
	fps: number
): MetricalAssessment {
	const period = medianPeriod(beats);
	if (beats.length < 8 || !(period > 1e-6)) {
		return { bpm: 0, ambiguous: true, confidence: 0, alternatives: [], reason: 'too few beats' };
	}
	const bpm = 60 / period;

	const onBeat = meanAt(odf, fps, beats);
	if (!(onBeat > 1e-9)) {
		return { bpm, ambiguous: true, confidence: 0, alternatives: [], reason: 'no onset energy on the beats' };
	}

	const mids: number[] = [];
	for (let i = 1; i < beats.length; i++) mids.push((beats[i - 1] + beats[i]) / 2);
	const midRatio = meanAt(odf, fps, mids) / onBeat;

	const alternatives = RELATIVES.map((r) => bpm * r)
		.filter((alt) => alt >= MIN_BPM && alt <= MAX_BPM)
		.sort((x, y) => prior(y) - prior(x));

	// A rival reading almost always exists, so "a rival exists" would flag everything and mean
	// nothing. What is worth saying is that this reading is an unusual place for a tactus.
	const support = prior(bpm);
	const ambiguous = support < UNUSUAL_TACTUS;

	return {
		bpm,
		ambiguous,
		confidence: Math.max(0, Math.min(1, support)),
		alternatives: alternatives.map((x) => Math.round(x * 100) / 100),
		reason: ambiguous
			? `${Math.round(bpm)} bpm is an unusual tactus; ${Math.round(alternatives[0])} is a commoner reading of the same beats`
			: `midpoints ${(midRatio * 100).toFixed(0)}% of beat strength`
	};
}
