import { MAX_BPM, MIN_BPM, tempoCandidates, trackBeats } from './tempo.ts';
import { gaussianSmooth, mean, quantile, sampleAt } from './dsp/stats.ts';

export interface BeatGrid {
	bpm: number;
	beatPeriod: number;
	/** Time of beat 0, seconds. Always inside [0, beatPeriod). */
	firstBeat: number;
	/** Every beat in the track. Equal to the constant grid when `constant` is true. */
	beats: Float64Array;
	/** False when the track drifts enough that one period cannot describe it. */
	constant: boolean;
	/** 0..1. How much of the onset energy the grid actually explains. */
	confidence: number;
}

/** Tuned bar-grouping weight relative to tempogram evidence. */
const COHERENCE_WEIGHT = 1;

interface BeatOptions {
	/** Constrain the search to within 6% of a known tempo. */
	bpmHint?: number;
}

/** Mean onset support on grid beats within active audio; long silent tails must not dilute it. */
function gridSupport(
	odf: Float32Array,
	fps: number,
	period: number,
	phase: number,
	from: number,
	to: number
): number {
	let acc = 0;
	let n = 0;
	const start = Math.ceil((from - phase) / period);
	const end = Math.floor((to - phase) / period);
	for (let k = start; k <= end; k++) {
		acc += sampleAt(odf, (phase + k * period) * fps);
		n++;
	}
	return n > 0 ? acc / n : 0;
}

function bestPhase(
	odf: Float32Array,
	fps: number,
	period: number,
	from: number,
	to: number,
	steps: number
): { phase: number; support: number } {
	let best = 0;
	let bestSupport = -1;
	for (let s = 0; s < steps; s++) {
		const phase = (s / steps) * period;
		const support = gridSupport(odf, fps, period, phase, from, to);
		if (support > bestSupport) {
			bestSupport = support;
			best = phase;
		}
	}
	return { phase: best, support: bestSupport };
}

/** Refine tempo to 0.001 bpm; small period errors accumulate into substantial phase drift. */
function refineGrid(
	odf: Float32Array,
	fps: number,
	seedBpm: number,
	from: number,
	to: number
): { bpm: number; phase: number; support: number } {
	let bpm = seedBpm;
	let phase = 0;
	let support = 0;

	for (const [range, step, phases] of [
		[0.02, 0.0015, 96],
		[0.002, 0.00015, 192],
		[0.0002, 0.00002, 384]
	] as const) {
		let bestBpm = bpm;
		let bestPhaseV = phase;
		let bestSupport = -1;
		for (let r = -range; r <= range + 1e-12; r += step) {
			const cand = bpm * (1 + r);
			if (cand < MIN_BPM * 0.9 || cand > MAX_BPM * 1.1) continue;
			const period = 60 / cand;
			const p = bestPhase(odf, fps, period, from, to, phases);
			if (p.support > bestSupport) {
				bestSupport = p.support;
				bestBpm = cand;
				bestPhaseV = p.phase;
			}
		}
		bpm = bestBpm;
		phase = bestPhaseV;
		support = bestSupport;
	}

	return { bpm, phase, support };
}

/** Onset strength at each beat of a constant grid, the sequence bars are made of. */
function beatSeries(
	odf: Float32Array,
	fps: number,
	period: number,
	phase: number,
	from: number,
	to: number
): number[] {
	const out: number[] = [];
	const reach = 3;
	for (let k = Math.ceil((from - phase) / period); k <= Math.floor((to - phase) / period); k++) {
		const c = Math.round((phase + k * period) * fps);
		let m = 0;
		for (let i = Math.max(0, c - reach); i <= Math.min(odf.length - 1, c + reach); i++) {
			if (odf[i] > m) m = odf[i];
		}
		out.push(m);
	}
	return out;
}

function autocorrelation(a: readonly number[], lag: number): number {
	const n = a.length - lag;
	if (n < 8) return 0;
	let m = 0;
	for (const v of a) m += v;
	m /= a.length;
	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) {
		num += (a[i] - m) * (a[i + lag] - m);
		den += (a[i] - m) ** 2;
	}
	return den > 1e-12 ? num / den : 0;
}

/** Bar grouping breaks tempo ties: triplets may match onsets while failing to recur every 3 or 4 beats. */
function barCoherence(
	odf: Float32Array,
	fps: number,
	bpm: number,
	from: number,
	to: number
): number {
	const period = 60 / bpm;
	const phase = bestPhase(odf, fps, period, from, to, 96).phase;
	const series = beatSeries(odf, fps, period, phase, from, to);
	const four = (autocorrelation(series, 4) + autocorrelation(series, 8)) / 2;
	const three = (autocorrelation(series, 3) + autocorrelation(series, 6)) / 2;
	return Math.max(0, four, three);
}

/** Trim leading and trailing near-silence, which no grid should be scored against. */
function activeSpan(odf: Float32Array, fps: number): [number, number] {
	const level = gaussianSmooth(odf, fps * 0.5);
	const floor = quantile(level, 0.55) * 0.35;
	let lo = 0;
	let hi = level.length - 1;
	while (lo < hi && level[lo] < floor) lo++;
	while (hi > lo && level[hi] < floor) hi--;
	return [lo / fps, hi / fps];
}

/**
 * Local tempo spread as a fraction of its median, measured over 16 tracked beats. A fitted grid
 * cannot bend and would always report zero.
 */
function tempoSpread(times: Float64Array): number {
	const win = 16;
	const locals: number[] = [];
	for (let i = 0; i + win < times.length; i += win) {
		locals.push((60 * win) / (times[i + win] - times[i]));
	}
	if (locals.length < 4) return 0;
	locals.sort((a, b) => a - b);
	const p10 = locals[Math.floor(locals.length * 0.1)];
	const p90 = locals[Math.floor(locals.length * 0.9)];
	const mid = locals[locals.length >> 1];
	return mid > 0 ? (p90 - p10) / mid : 0;
}

export function detectBeats(
	odf: Float32Array,
	fps: number,
	duration: number,
	opts: BeatOptions = {}
): BeatGrid {
	const [from, to] = activeSpan(odf, fps);
	const minBpm = opts.bpmHint ? opts.bpmHint * 0.94 : MIN_BPM;
	const maxBpm = opts.bpmHint ? opts.bpmHint * 1.06 : MAX_BPM;
	const candidates = tempoCandidates(odf, fps, minBpm, maxBpm);
	if (candidates.length === 0) return fallbackGrid(duration, (minBpm + maxBpm) / 2);

	// Use prior-weighted tempogram salience and bar grouping for octave selection. Grid support
	// alone favours progressively halved tempos.
	const shortlist = candidates
		.slice(0, 4)
		.filter((c) => c.salience > candidates[0].salience * 0.5);

	let best: { bpm: number; phase: number; support: number; score: number } | null = null;
	let runnerUp = 0;
	for (const c of shortlist) {
		const g = refineGrid(odf, fps, c.bpm, from, to);
		const score = c.salience * (1 + COHERENCE_WEIGHT * barCoherence(odf, fps, g.bpm, from, to));
		if (!best || score > best.score) {
			if (best) runnerUp = Math.max(runnerUp, best.score);
			best = { ...g, score };
		} else {
			runnerUp = Math.max(runnerUp, score);
		}
	}
	if (!best) return fallbackGrid(duration, (minBpm + maxBpm) / 2);

	// Midpoint onset strength does not resolve octave ambiguity; keep the prior's reading.
	const period = 60 / best.bpm;
	const phase = ((best.phase % period) + period) % period;

	// The tracked sequence is what says whether one period can describe the whole track. It is
	// not used for the beats themselves unless it has to be: a constant grid keeps its phase
	// across a quiet passage, where the tracker is free to slip half a beat and slip back.
	const dp = trackBeats(odf, fps, best.bpm);
	const drifting = dp.times.length > 32 && tempoSpread(dp.times) > 0.025;

	const beats = drifting ? Float64Array.from(dp.times) : constantBeats(phase, period, duration);

	// Use the weaker of fit and metrical margin: accurate onset alignment can still have the wrong octave.
	const reference = mean(odf, Math.round(from * fps), Math.round(to * fps)) || 1e-9;
	const support = Math.max(0, Math.min(1, (best.support / reference - 1) / 3));
	const margin = best.score > 0 ? Math.max(0, Math.min(1, 1 - runnerUp / best.score)) : 0;

	return {
		bpm: drifting ? dp.bpm : best.bpm,
		beatPeriod: drifting ? 60 / dp.bpm : period,
		firstBeat: drifting ? (beats[0] ?? 0) : phase,
		beats,
		constant: !drifting,
		confidence: Math.min(support, 0.35 + 0.65 * margin)
	};
}

function fallbackGrid(duration: number, bpm: number): BeatGrid {
	const period = 60 / bpm;
	return {
		bpm,
		beatPeriod: period,
		firstBeat: 0,
		beats: constantBeats(0, period, duration),
		constant: true,
		confidence: 0
	};
}

function constantBeats(phase: number, period: number, duration: number): Float64Array {
	const first = phase % period;
	const count = Math.max(0, Math.floor((duration - first) / period) + 1);
	const beats = new Float64Array(count);
	for (let i = 0; i < count; i++) beats[i] = first + i * period;
	return beats;
}
