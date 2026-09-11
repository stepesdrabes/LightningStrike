/**
 * Dynamic programming tracks bar phase: normal steps are free and restarts cost a fixed price.
 * Unrestricted restarts can follow ambiguous two-bar loops, so callers use them near movement
 * seams or through acceptedRestarts. Model downbeats supply asymmetric half-bar evidence
 * that broadband onsets cannot.
 */

/** One stretch of the beat stream that counts its bars from one place. */
interface PhaseSegment {
	/** Index into the beat stream of this segment's first bar line. */
	startBeat: number;
	/** Which beat index mod `beatsPerBar` carries a downbeat inside this segment. */
	phase: number;
}

/** Restart cost in downbeats, tuned on Harmonix and judged tracks; four lies inside the stable plateau. */
const PHASE_RESET_COST = 4;

/** A small missing-downbeat cost discourages invented bar lines without dominating restart evidence. */
const EMPTY_BAR_LINE_COST = 0.15;

/** Fewest downbeats worth running the walk over; below this the modal phase is all there is. */
const MIN_DOWNBEATS = 8;

/** Model downbeats are an exact subset of beats, so phase evidence uses indices without time tolerance. */
export function phaseSegments(
	beats: readonly number[] | Float64Array,
	downbeats: readonly number[],
	beatsPerBar: number,
	resetCost = PHASE_RESET_COST
): PhaseSegment[] {
	const n = beats.length;
	const bpb = Math.max(1, Math.floor(beatsPerBar));
	if (n < bpb * 2 || downbeats.length < MIN_DOWNBEATS || bpb < 2) {
		return [{ startBeat: 0, phase: 0 }];
	}

	const isDownbeat = new Uint8Array(n);
	const at = new Map<number, number>();
	for (let i = 0; i < n; i++) at.set(Math.round(beats[i] * 1000), i);
	for (const t of downbeats) {
		const i = at.get(Math.round(t * 1000));
		if (i !== undefined) isDownbeat[i] = 1;
	}

	// Viterbi over position-in-bar. Stepping on is free; any other successor is a restart.
	const NEG = -Infinity;
	const score = new Float64Array(n * bpb).fill(NEG);
	const back = new Int32Array(n * bpb);
	const emit = (i: number, s: number): number =>
		s === 0 ? (isDownbeat[i] ? 1 : -EMPTY_BAR_LINE_COST) : 0;
	for (let s = 0; s < bpb; s++) score[s] = emit(0, s);
	for (let i = 1; i < n; i++) {
		const row = i * bpb;
		const prevRow = row - bpb;
		for (let s = 0; s < bpb; s++) {
			const stepped = (s - 1 + bpb) % bpb;
			let best = score[prevRow + stepped];
			let from = stepped;
			for (let q = 0; q < bpb; q++) {
				if (q === stepped) continue;
				const v = score[prevRow + q] - resetCost;
				if (v > best) {
					best = v;
					from = q;
				}
			}
			score[row + s] = best + emit(i, s);
			back[row + s] = from;
		}
	}

	let s = 0;
	for (let k = 1; k < bpb; k++) if (score[(n - 1) * bpb + k] > score[(n - 1) * bpb + s]) s = k;
	const states = new Int32Array(n);
	for (let i = n - 1; i >= 0; i--) {
		states[i] = s;
		s = back[i * bpb + s];
	}

	// A segment starts at its own first bar line, which is what `barStartsAtCuts` needs: the
	// walk between two restarts is uniform by construction, so one anchor describes it.
	const out: PhaseSegment[] = [];
	let restarted = true;
	for (let i = 0; i < n; i++) {
		if (i > 0 && states[i] !== (states[i - 1] + 1) % bpb) restarted = true;
		if (states[i] === 0 && restarted) {
			out.push({ startBeat: i, phase: i % bpb });
			restarted = false;
		}
	}
	return out.length > 0 ? out : [{ startBeat: 0, phase: 0 }];
}

/** One walk segment with the model's own downbeats counted against it. */
export interface PhaseRun {
	startBeat: number;
	endBeat: number;
	/** Beat index mod `beatsPerBar` of this run's bar lines. */
	phase: number;
	bars: number;
	/** The model's downbeats inside the run, and how many sit on each residue. */
	downbeats: number;
	onPhase: number[];
	/** Share of the run's downbeats on its own bar lines. */
	share: number;
}

/** Run support and duration, with absolute beat-index residues for direct phase comparison. */
export function phaseRuns(
	segments: readonly PhaseSegment[],
	beats: readonly number[] | Float64Array,
	downbeats: readonly number[],
	beatsPerBar: number
): PhaseRun[] {
	const bpb = Math.max(1, Math.floor(beatsPerBar));
	const isDownbeat = new Set(downbeats.map((t) => Math.round(t * 1000)));
	return segments.map((seg, k) => {
		const startBeat = seg.startBeat;
		const endBeat = k + 1 < segments.length ? segments[k + 1].startBeat : beats.length;
		const onPhase = new Array<number>(bpb).fill(0);
		let count = 0;
		for (let i = startBeat; i < endBeat; i++) {
			if (!isDownbeat.has(Math.round(beats[i] * 1000))) continue;
			count++;
			onPhase[i % bpb]++;
		}
		const phase = startBeat % bpb;
		return {
			startBeat,
			endBeat,
			phase,
			bars: (endBeat - startBeat) / bpb,
			downbeats: count,
			onPhase,
			share: count > 0 ? onPhase[phase] / count : 0
		};
	});
}

/**
 * Require sustained agreement on a new residue: short or 50-60% runs can be two-bar-loop ambiguity.
 * A terminal run may be shorter because no later run can contradict it.
 */
const SOLID_SHARE = 0.85;
const SOLID_MIN_DOWNBEATS = 6;
const SOLID_MIN_BARS = 8;
const SOLID_TAIL_BARS = 6;
/** Require downbeats on most bars; sparse tail detections cannot establish a new phase. */
const SOLID_DENSITY = 0.7;
/**
 * Opening phase needs a majority; a long body with the same majority may also override an intro.
 * A weaker opening defers to the first solid run.
 */
const OPENING_SHARE = 0.6;
const BODY_BARS = 32;
/** A residue already common in the reference is resolved ambiguity, not a new bar phase. */
const AMBIGUOUS_SHARE = 0.25;

function solid(run: PhaseRun, tail: boolean): boolean {
	if (run.downbeats < SOLID_MIN_DOWNBEATS || run.downbeats < SOLID_DENSITY * run.bars) return false;
	if (run.share >= SOLID_SHARE && run.bars >= (tail ? SOLID_TAIL_BARS : SOLID_MIN_BARS)) return true;
	return run.share >= OPENING_SHARE && run.bars >= BODY_BARS;
}

/**
 * Opening phase: first majority run of at least eight bars, else first solid run, else null
 * for the modal fallback.
 */
export function openingRun(runs: readonly PhaseRun[]): PhaseRun | null {
	const majority = runs.find((r) => r.share >= OPENING_SHARE && r.bars >= SOLID_MIN_BARS);
	if (majority) return majority;
	return runs.find((r, k) => solid(r, k === runs.length - 1)) ?? null;
}

/**
 * Accepted restart beat indices. Ignore short/divided runs and residues already common in the
 * reference. A half-bar shift that returns is loop ambiguity unless a seam corroborates it.
 * Each accepted solid run becomes the reference.
 */
export function acceptedRestarts(
	runs: readonly PhaseRun[],
	beatsPerBar: number,
	/** Beat indices a movement seam already cuts at; a restart within a bar of one is its business. */
	seams: readonly number[] = []
): number[] {
	const bpb = Math.max(1, Math.floor(beatsPerBar));
	const opening = openingRun(runs);
	if (!opening) return [];
	const out: number[] = [];
	let reference = opening;
	for (let k = runs.indexOf(opening) + 1; k < runs.length; k++) {
		const run = runs[k];
		const tail = k === runs.length - 1;
		if (!solid(run, tail)) continue;
		const shift = (((run.phase - reference.phase) % bpb) + bpb) % bpb;
		if (shift === 0) {
			reference = run;
			continue;
		}
		if (reference.onPhase[run.phase] > AMBIGUOUS_SHARE * reference.downbeats) continue;
		const returns = runs.slice(k + 1).some((later) => later.phase === reference.phase);
		const nearSeam = seams.some((s) => Math.abs(s - run.startBeat) <= bpb);
		if (shift * 2 === bpb && returns && !nearSeam) continue;
		if (!nearSeam) out.push(run.startBeat);
		reference = run;
	}
	return out;
}

/** Bar-line beat indices: each phase segment walks uniformly from its own anchor. */
export function barLinesFrom(
	segments: readonly PhaseSegment[],
	beatCount: number,
	beatsPerBar: number
): number[] {
	const out: number[] = [];
	for (let k = 0; k < segments.length; k++) {
		const end = k + 1 < segments.length ? segments[k + 1].startBeat : beatCount;
		for (let i = segments[k].startBeat; i < end; i += beatsPerBar) out.push(i);
	}
	return out;
}
