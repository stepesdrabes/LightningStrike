import type { BeatFeatures } from './beatsync.ts';
import { PITCH_CLASSES } from './chroma.ts';
import { quantile } from './dsp/stats.ts';

/**
 * How many sub-frames each bar is resampled to. Keeping a time axis inside the bar is what
 * separates "these two bars have the same average spectrum" from "these two bars play the
 * same pattern", and in this repertoire the pattern is the identity of the section. Sixteen
 * is a sixteenth note in four, which is as fine as a placement ever needs to be read.
 */
const SUB_FRAMES = 16;
/** Timbre needs roughly a third of an octave; finer only adds pitch, which chroma covers. */
const TIMBRE_BANDS = 32;

export interface BarFeatures {
	count: number;
	/** Bar start times; `time[count]` is the end of the last bar. */
	time: Float64Array;
	/** count * (SUB_FRAMES * TIMBRE_BANDS), L2-normalised per bar. */
	pattern: Float32Array;
	patternDim: number;
	/** count * 12, mean chroma over the bar, L2-normalised. */
	chroma: Float32Array;
	/** Mean level over the bar, linear. */
	rms: Float32Array;
	/** Mean onset strength over the bar's beats, by band group. */
	low: Float32Array;
	mid: Float32Array;
	high: Float32Array;
	/** Quietest beat in the bar, relative to the track; finds a collapse before a drop. */
	floor: Float32Array;
}

/**
 * Bars built from beats, keeping the within-bar time axis.
 *
 * Aggregating to bars rather than beats is the single largest accuracy lever in structure
 * analysis: published boundary F-measures rise by around a third for the same algorithm,
 * because Western popular structure changes on bar lines by construction.
 */
export function barSynchronous(bf: BeatFeatures, beatsPerBar: number, phase: number): BarFeatures {
	const count = Math.max(0, Math.floor((bf.count - phase) / beatsPerBar));
	const starts = new Array<number>(count + 1);
	for (let b = 0; b <= count; b++) starts[b] = phase + b * beatsPerBar;
	return barSynchronousAt(bf, starts);
}

/**
 * The bar table over explicit bar-start beat indices, so a grid can absorb a half-bar
 * edit as one SHORT bar. A track that inserts two beats has no uniform reading: every
 * phase choice is wrong on one side of the edit (Safir's chorus was heard "still early"
 * through three uniform fixes), and absorbing the edit as a LONG bar stretches whatever
 * gesture lands in it (the staged strobe led its slam by six real beats). `starts` has
 * one entry per bar plus the end boundary, ascending, in beat indices.
 */
export function barSynchronousAt(bf: BeatFeatures, starts: readonly number[]): BarFeatures {
	const count = Math.max(0, starts.length - 1);
	const patternDim = SUB_FRAMES * TIMBRE_BANDS;

	const time = new Float64Array(count + 1);
	const pattern = new Float32Array(count * patternDim);
	const chroma = new Float32Array(count * PITCH_CLASSES);
	const rms = new Float32Array(count);
	const low = new Float32Array(count);
	const mid = new Float32Array(count);
	const high = new Float32Array(count);
	const floor = new Float32Array(count);

	const group = Math.max(1, Math.floor(bf.bands / TIMBRE_BANDS));

	for (let b = 0; b < count; b++) {
		const first = starts[b];
		const beatsInBar = Math.max(1, starts[b + 1] - first);
		time[b] = bf.time[first];
		time[b + 1] = bf.time[Math.min(first + beatsInBar, bf.count)];

		let norm = 0;
		for (let s = 0; s < SUB_FRAMES; s++) {
			// Sub-frame s of the bar maps onto a beat and a fraction of it; sampling the beat's
			// spectrum is enough because a beat is already the finest row we kept.
			const u = (s / SUB_FRAMES) * beatsInBar;
			const beat = Math.min(bf.count - 1, first + Math.floor(u));
			for (let k = 0; k < TIMBRE_BANDS; k++) {
				let acc = 0;
				const from = k * group;
				const to = Math.min(bf.bands, from + group);
				for (let j = from; j < to; j++) acc += bf.spectral[beat * bf.bands + j];
				const v = acc / Math.max(1, to - from);
				pattern[b * patternDim + s * TIMBRE_BANDS + k] = v;
				norm += v * v;
			}
		}
		norm = Math.sqrt(norm);
		if (norm > 1e-9) {
			for (let i = 0; i < patternDim; i++) pattern[b * patternDim + i] /= norm;
		}

		let cn = 0;
		for (let p = 0; p < PITCH_CLASSES; p++) {
			let acc = 0;
			for (let k = 0; k < beatsInBar; k++) {
				const beat = Math.min(bf.count - 1, first + k);
				acc += bf.chroma[beat * PITCH_CLASSES + p];
			}
			const v = acc / beatsInBar;
			chroma[b * PITCH_CLASSES + p] = v;
			cn += v * v;
		}
		cn = Math.sqrt(cn);
		if (cn > 1e-9) for (let p = 0; p < PITCH_CLASSES; p++) chroma[b * PITCH_CLASSES + p] /= cn;

		let accRms = 0;
		let accLow = 0;
		let accMid = 0;
		let accHigh = 0;
		let quietest = Infinity;
		for (let k = 0; k < beatsInBar; k++) {
			const beat = Math.min(bf.count - 1, first + k);
			accRms += bf.rms[beat];
			accLow += bf.low[beat];
			accMid += bf.mid[beat];
			accHigh += bf.high[beat];
			if (bf.rms[beat] < quietest) quietest = bf.rms[beat];
		}
		rms[b] = accRms / beatsInBar;
		low[b] = accLow / beatsInBar;
		mid[b] = accMid / beatsInBar;
		high[b] = accHigh / beatsInBar;
		floor[b] = Number.isFinite(quietest) ? quietest : rms[b];
	}

	return { count, time, pattern, patternDim, chroma, rms, low, mid, high, floor };
}

/** The bars of one movement, as a table of their own, so a stage written for a track runs on a song. */
export function sliceBars(bars: BarFeatures, from: number, to: number): BarFeatures {
	const count = Math.max(0, to - from);
	return {
		count,
		time: bars.time.subarray(from, to + 1),
		pattern: bars.pattern.subarray(from * bars.patternDim, to * bars.patternDim),
		patternDim: bars.patternDim,
		chroma: bars.chroma.subarray(from * PITCH_CLASSES, to * PITCH_CLASSES),
		rms: bars.rms.subarray(from, to),
		low: bars.low.subarray(from, to),
		mid: bars.mid.subarray(from, to),
		high: bars.high.subarray(from, to),
		floor: bars.floor.subarray(from, to)
	};
}

/** The similarity matrix of one movement's bars, cut from the track's. */
export function sliceSimilarity(sim: Float32Array, n: number, from: number, to: number): Float32Array {
	const m = to - from;
	const out = new Float32Array(m * m);
	for (let i = 0; i < m; i++) out.set(sim.subarray((from + i) * n + from, (from + i) * n + to), i * m);
	return out;
}

/**
 * Physics under which the settling-contrast term is allowed to vote: the decisive class
 * (the pin threshold) needs no second witness, and boosting it is how a fill's echo
 * once outbid the owner's bar.
 */
const SETTLE_GATE = 2;
/**
 * Under this the track has no dynamics to read and a level term would only amplify noise.
 * Six dB is about the range a heavily limited master still has left between its verse and its
 * chorus, so it is the point below which "louder" stops carrying structure.
 */
const MIN_LEVEL_SPREAD_DB = 6;
/**
 * How far apart in level two bars may sit, as a fraction of the track's own p10-p90 range,
 * before they stop reading as the same passage.
 */
const LEVEL_TOL = 0.2;
/** The most of a pair's similarity that a level difference is allowed to withdraw. */
const LEVEL_DEPTH = 0.55;

/** Bar levels in dB, floored so a digitally silent bar cannot stretch the track's range. */
function barLevels(bars: BarFeatures): Float32Array {
	const db = new Float32Array(bars.count);
	for (let b = 0; b < bars.count; b++) db[b] = 20 * Math.log10(Math.max(bars.rms[b], 1e-5));
	return db;
}

/** The track's own working range in dB, floored so a flat master cannot divide by nothing. */
function levelSpread(db: Float32Array): number {
	return Math.max(MIN_LEVEL_SPREAD_DB, quantile(db, 0.9) - quantile(db, 0.1));
}

/** Cosine similarity matrix over bars, count * count, values in 0..1. */
export function similarityMatrix(bars: BarFeatures): Float32Array {
	const n = bars.count;
	const dim = bars.patternDim;
	const sim = new Float32Array(n * n);

	// Amplitude has to re-enter somewhere. `barSynchronous` L2-normalises each bar's pattern,
	// which is what lets a repeat match its original at any level, and is also why a drop and
	// the groove behind it playing the same figure were literally identical rows: a 1.6 dB step
	// scored 1.000. It re-enters as a multiplier rather than a summand, because two bars playing
	// different figures are different whatever their levels, so level may only ever withdraw
	// similarity and never supply it.
	const db = barLevels(bars);
	const tol = LEVEL_TOL * levelSpread(db);

	for (let i = 0; i < n; i++) {
		sim[i * n + i] = 1;
		for (let j = i + 1; j < n; j++) {
			let dot = 0;
			for (let k = 0; k < dim; k++) dot += bars.pattern[i * dim + k] * bars.pattern[j * dim + k];
			// Chroma agreement carries the harmony, which timbre alone misses when a verse and a
			// chorus share a drum kit.
			let cdot = 0;
			for (let k = 0; k < PITCH_CLASSES; k++) {
				cdot += bars.chroma[i * PITCH_CLASSES + k] * bars.chroma[j * PITCH_CLASSES + k];
			}
			const d = (db[i] - db[j]) / tol;
			const level = 1 - LEVEL_DEPTH + LEVEL_DEPTH * Math.exp(-d * d);
			const v = Math.max(0, (0.75 * dot + 0.25 * cdot) * level);
			sim[i * n + j] = v;
			sim[j * n + i] = v;
		}
	}
	return sim;
}

/**
 * Only bars within `BAND` of each other are compared inside a candidate segment. A section
 * is a place where nearby bars resemble each other; requiring bar 1 to resemble bar 16
 * would reject any section that develops, which is most of them.
 */
const BAND = 7;
/**
 * Six phrases. Reachable only because `similarityMatrix` now sees level: while it did not, a
 * ceiling above 16 fused a drop with the groove behind it, since the two play the same figure
 * and the L2-normalised patterns were identical rows.
 */
const MAX_SEGMENT_BARS = 24;
const MIN_SEGMENT_BARS = 2;
/** Weight of the length prior, in units of one bar's worth of banded pairs. */
const LAMBDA = 1.1;

/** 0 for eight bars, then progressively worse for four, two and anything else. */
function lengthPenalty(bars: number): number {
	if (bars === 8) return 0;
	if (bars % 8 === 0) return 0.125;
	if (bars % 4 === 0) return 0.25;
	if (bars % 2 === 0) return 0.5;
	return 1;
}

/**
 * How much better than average the bars inside this segment resemble each other.
 *
 * The baseline subtraction is what makes the objective work, and its absence was a real bug:
 * dividing the banded similarity sum by the segment length saturates once the length passes
 * `BAND`, because each bar can only ever contribute `BAND` pairs. A saturating per-segment
 * score summed over segments is maximised by having as many segments as possible, so the DP
 * chopped every input into the shortest length that paid no phrase penalty, and a synthetic
 * matrix of five perfect 32-bar blocks came back as twenty 8-bar ones.
 *
 * Measuring each pair against the track's own mean instead makes a boundary cost what it
 * should: splitting homogeneous material throws away pairs that were scoring above average,
 * and merging unlike material takes on pairs scoring below it. Neither direction is free, so
 * the optimum is where the music actually changes.
 */
function segmentScore(
	sim: Float32Array,
	n: number,
	from: number,
	to: number,
	baseline: number
): number {
	let acc = 0;
	for (let i = from; i < to; i++) {
		const hi = Math.min(to, i + BAND + 1);
		for (let j = i + 1; j < hi; j++) acc += sim[i * n + j] - baseline;
	}
	return 2 * acc;
}

/** Mean similarity over every pair the segment scorer can see, which is the level to beat. */
function bandedMean(sim: Float32Array, n: number): number {
	let acc = 0;
	let count = 0;
	for (let i = 0; i < n; i++) {
		const hi = Math.min(n, i + BAND + 1);
		for (let j = i + 1; j < hi; j++) {
			acc += sim[i * n + j];
			count++;
		}
	}
	return count > 0 ? acc / count : 0;
}

/**
 * Convolutive block matching (Marmoret et al.): choose the segmentation maximising total
 * within-segment similarity minus a cost for lengths that are not phrase multiples.
 *
 * The length term is the point. Every published alternative either snaps boundaries onto a
 * phrase grid afterwards, which throws away every genuine off-grid change, or ignores phrase
 * structure entirely. Expressing it as a cost lets the evidence overrule it when the music
 * really does move at seven bars, and lets it win when the evidence is a coin toss.
 */
/**
 * Segment each movement on its own and join the tables: the DP's baseline is the mean
 * similarity of the passage it reads, and two songs share no baseline, so a seam between
 * them is not a boundary to be found but a wall to segment up to. The movement starts are
 * bounds by construction.
 */
export function segmentMovements(sim: Float32Array, bars: BarFeatures, starts: readonly number[]): number[] {
	const edges = [...new Set([0, ...starts.filter((b) => b > 0 && b < bars.count), bars.count])].sort((a, b) => a - b);
	if (edges.length <= 2) return segmentBars(sim, bars);
	const bounds: number[] = [];
	for (let k = 0; k + 1 < edges.length; k++) {
		const from = edges[k];
		const to = edges[k + 1];
		const inner = segmentBars(sliceSimilarity(sim, bars.count, from, to), sliceBars(bars, from, to));
		for (const b of inner) if (b < to - from) bounds.push(from + b);
	}
	bounds.push(bars.count);
	return bounds;
}

export function segmentBars(sim: Float32Array, bars: BarFeatures): number[] {
	const n = bars.count;
	if (n < MIN_SEGMENT_BARS * 2) return [0, n];

	const baseline = bandedMean(sim, n);
	// One bar contributes about `BAND` pairs, so this is the penalty in bars-worth of evidence
	// and lambda means the same thing whatever the track's overall similarity happens to be.
	const unit = BAND;

	const best = new Float64Array(n + 1).fill(-Infinity);
	const link = new Int32Array(n + 1).fill(-1);
	best[0] = 0;

	for (let end = MIN_SEGMENT_BARS; end <= n; end++) {
		for (let len = MIN_SEGMENT_BARS; len <= Math.min(MAX_SEGMENT_BARS, end); len++) {
			const start = end - len;
			if (best[start] === -Infinity) continue;
			// The tail of a track is often a fade whose length nobody chose; charging it the
			// full phrase penalty would drag the previous boundary out of place.
			const penalty = end === n ? lengthPenalty(len) * 0.5 : lengthPenalty(len);
			const v = best[start] + segmentScore(sim, n, start, end, baseline) - unit * LAMBDA * penalty;
			if (v > best[end]) {
				best[end] = v;
				link[end] = start;
			}
		}
	}

	const bounds: number[] = [n];
	for (let at = n; at > 0; at = link[at]) {
		if (link[at] < 0) break;
		bounds.push(link[at]);
	}
	bounds.reverse();
	if (bounds[0] !== 0) bounds.unshift(0);
	return bounds;
}

/**
 * How decisively a neighbour has to beat the chosen boundary before the boundary moves.
 *
 * The DP optimises segment cohesion, which is the right objective everywhere except at a
 * hard arrival: the drop bar and the bar after it are nearly identical rows, so cohesion
 * barely changes when the boundary slides one bar off the hit - and one bar late is
 * exactly how the reported failures present. Arrival evidence is a different signal from
 * cohesion, so it gets a second pass rather than a term inside the DP, where a level-step
 * bonus was already tried once and measurably hurt.
 */
const REFINE_MARGIN = 1.45;
/** Below this, a bar's arrival is noise and has no business moving a boundary. */
const REFINE_FLOOR = 0.6;
/** How far a boundary may be pulled onto an arrival. One bar is the observed failure class. */
const REFINE_REACH = 1;

/**
 * How hard bar `b` arrives: a level step up, the kit returning, the voice arriving, the bar
 * before collapsing, and the pattern changing, in comparable units. Zero for a bar that
 * continues its passage.
 */
function arrivalStrength(
	bars: BarFeatures,
	db: Float32Array,
	tol: number,
	kicksPerBar: Int32Array | null,
	vocal: Float64Array | null,
	hooks: Uint8Array | null,
	b: number,
	settle: Float32Array | null = null,
	settleWeight = 0
): number {
	if (b <= 0 || b >= bars.count) return 0;
	const step = Math.max(0, db[b] - db[b - 1]) / tol;

	let kit = 0;
	if (kicksPerBar) {
		const now = kicksPerBar[b] ?? 0;
		const before = kicksPerBar[b - 1] ?? 0;
		if (now > 0 && before === 0) kit = 1;
		else kit = Math.max(0, now - before) / 8;
	}

	// The lyric evidence, two forms because tracks come in two shapes. On a sparse-vocal
	// track the voice ENTERING is the boundary (coverage jumps across the bar line); on a
	// wall-to-wall one - most rap - coverage never moves and the boundary the audience
	// hears is the HOOK starting, so the caller marks the bars where a repeated-line block
	// begins. Weighted beside the kit's return: either tips a boundary that has physical
	// evidence, neither moves one alone (the refine floor sits above them), and a track
	// with no lyrics scores exactly zero everywhere.
	const entrance = vocal && vocal[b] >= 0.25 && (vocal[b - 1] ?? 0) < 0.1;
	const voice = entrance || (hooks && hooks[b] === 1) ? 1.2 : 0;

	// The held-breath bar: its quietest beat collapses while the arrival bar slams. Measured
	// against the bar's own mean so a track-wide quiet passage does not read as a dip.
	const dipRef = Math.max(bars.rms[b], 1e-6);
	const dip = Math.max(0, 1 - bars.floor[b - 1] / dipRef);

	let novelty = 0;
	{
		const dim = bars.patternDim;
		let dot = 0;
		for (let k = 0; k < dim; k++) {
			dot += bars.pattern[(b - 1) * dim + k] * bars.pattern[b * dim + k];
		}
		novelty = Math.max(0, 1 - dot);
	}

	// Newness that PERSISTS: an arrival bar resembles its successor and not its
	// predecessor, while a fill resembles neither - the drum fill before a slam scores
	// kit and novelty exactly like the slam does, and this is the term that tells them
	// apart. The judged round's boundary errors ran three-to-one EARLY, onto fills.
	//
	// EVIDENCE-GATED: the term votes only where the physics are indecisive. Ungated at
	// weight 1.2 it fixed a voice-led seam (KITN 21 -> 22, vocal 0.26 -> 1.0, physics
	// 0.89) and broke a physics-led one (Titi 73 -> 74, where 74's own 2.43 needed no
	// help and the boost pushed the boundary past the owner's bar). Where the physics
	// already speak, settling has nothing to add; where they cannot, it is the only
	// witness left. The gate also keeps every absolute threshold calibrated on the
	// settle-free scale honest for decisive bars: pins, the snap's cuts and the
	// consolidation floor all read decisive arrivals exactly as before.
	const physics = step + kit + 0.8 * dip + 1.5 * novelty;
	const settling =
		settle && settleWeight > 0 && physics < SETTLE_GATE
			? settleWeight * Math.max(0, settle[b])
			: 0;

	return physics + voice + settling;
}

/**
 * Per-bar settling contrast from the similarity matrix: how much more bar `b` resembles
 * the bar after it than the bar before it. Positive where new material establishes
 * itself, near zero mid-passage and on one-bar transients.
 */
export function settlingContrast(sim: Float32Array, n: number): Float32Array {
	const out = new Float32Array(n);
	for (let b = 1; b < n - 1; b++) {
		out[b] = sim[b * n + (b + 1)] - sim[(b - 1) * n + b];
	}
	return out;
}

export interface BoundaryMove {
	from: number;
	to: number;
	/** The winning arrival score, so a caller can pin only the decisive moves. */
	score: number;
}

/**
 * The structure stage's tunable constants, in one object so the bench can sweep them
 * against annotated ground truth. The defaults are what shipped after that sweep.
 */
export interface StructureTuning {
	/** Arrival score below which a boundary does not move at all. */
	refineFloor: number;
	/** Arrival score below which a refined move may not become a phase pin. */
	pinScore: number;
	/**
	 * PHYSICS-ONLY arrival score at which a boundary that never moved earns a pin anyway.
	 * Higher than pinScore on purpose: a moved pin proved itself against its neighbours
	 * under the refine margin, a stayed bound was never contested, so it pins only where
	 * no contest is conceivable. Physics-only because the hook term lifted a weak bar
	 * (0.89) over pinScore on Killing In the Name and the false pin then held off the
	 * phrase snap that kept the praised bar - the lyric evidence cannot vouch for the
	 * bar the lyric stages downstream are still adjudicating.
	 */
	stayPinScore: number;
	/** 0 disables re-phasing entirely. Bars a boundary may be dragged onto the pinned phase. */
	rephaseReach: number;
	/** Fewest pins whose phase agreement is trusted. */
	rephaseMinPins: number;
	/** Share of pins that must share the winning phase. */
	rephaseAgreement: number;
	/**
	 * Arrival score below which a seam between two same-kind sections is a DP artefact
	 * rather than structure, and the sections merge. 0 disables consolidation.
	 */
	consolidateFloor: number;
	/**
	 * Weight of the settling-contrast term in arrival scores. 0 keeps the score the
	 * refine sweep shipped; positive lets an arrival that PERSISTS outbid the fill
	 * before it. Swept at 1.6 it fixed one marked bar and moved two praised ones, so it
	 * ships at 0. Any positive weight rescales a score that five ABSOLUTE thresholds are
	 * calibrated on - refineFloor, pinScore, consolidateFloor, and the snap veto's
	 * decisive/noise cuts - so a future sweep must re-ask all five, not just this dial.
	 */
	settleWeight: number;
	/** Bars a boundary may be pulled onto an arrival by the refine pass. */
	refineReach: number;
}

/**
 * Swept against 60 annotated Harmonix tracks and 60 annotated Raveform EDM tracks, five
 * variants. This one - move a boundary only onto a DECISIVE arrival, pin what moved, and
 * re-phase one bar at most behind three near-unanimous pins - was best or tied-best on
 * every metric on both corpora. The first shipped version (floor 0.6, reach 2, 70%
 * agreement) was the worst on every boundary metric, which is what the room's owner heard
 * as "every section start is wrong": weak arrivals, vocal jumps among them, were dragging
 * good boundaries off by up to two bars track-wide.
 */
export const DEFAULT_TUNING: StructureTuning = {
	refineFloor: 2,
	pinScore: 2,
	rephaseReach: 1,
	rephaseMinPins: 3,
	rephaseAgreement: 0.8,
	// The 2026-08-14 sweep (60 Harmonix + 60 Raveform, material gate on): 1.6 was
	// best-or-tied on both corpora - Raveform F3 0.521 -> 0.552 with sections 20.0 ->
	// 17.2, Harmonix within noise (0.530 -> 0.526, sections 10.4 vs 10.1 annotated).
	// Arrival-only merging (no material gate) paid 1.7-2.2 points of Harmonix F3 for
	// the same floors: soft real boundaries between different material must survive.
	consolidateFloor: 1.6,
	// Still 0, now with the gate measured too: ungated, 1.2 fixed one tentative bar and
	// broke a hard one; GATED (physics < 2, and < 2.4), it fixes and breaks nothing at
	// all - the one gain travelled through a decisive bar the gate rightly silences.
	// The term, the gate and this negative result are all kept; the next candidate
	// weight starts from here instead of rediscovering the trade.
	settleWeight: 0,
	refineReach: 1,
	// The on-file cases split wide: legitimate stays tower (5.9, 6.0, 7.2 - Vitej's and
	// Way Too Self Aware's drops, Titi's slam) while the stays that displaced praised or
	// marked bars sat at 2.4 and below (Titi 74, KITN 50). 3 sits in the gap.
	stayPinScore: 3
};

/**
 * A boundary sitting on the bar the kit drops out of, one bar before it comes back on a
 * decisive arrival, moves onto the return. That bar is the tension bar that ends the
 * section before - Vitej mezi nama's fourth groove begins where the kick returns, and the
 * phrase grid had put it a bar early on the bar of nothing. Only into a section the kit
 * carries: a breakdown begins on the bar the kit LEAVES, and HIGHEST IN THE ROOM's second
 * one sits there, a bar before the crash the same pull would have moved it onto. Bars in
 * `keep` (pins, movement starts, hook-placed bars) and void edges are not up for review,
 * and the section keeps at least two bars. Returns the bars moved onto, so consolidation
 * leaves them alone too.
 */
const KIT_CARRIED = new Set(['drop', 'groove', 'chorus', 'verse']);
export function pullOntoReturn(
	segments: { startBar: number; endBar: number; kind: string }[],
	arrivals: Float32Array,
	kicks: Int32Array,
	floor: number,
	keep: ReadonlySet<number>
): number[] {
	const moved: number[] = [];
	for (let i = 1; i < segments.length; i++) {
		const here = segments[i];
		const prev = segments[i - 1];
		const b = here.startBar;
		if (keep.has(b) || !KIT_CARRIED.has(here.kind) || prev.kind === 'void') continue;
		if (b + 1 >= arrivals.length || here.endBar - (b + 1) < 2) continue;
		if (kicks[b] !== 0 || kicks[b + 1] === 0) continue;
		if (arrivals[b + 1] < floor || arrivals[b] >= floor) continue;
		here.startBar = b + 1;
		prev.endBar = b + 1;
		moved.push(b + 1);
	}
	return moved;
}

/** Kinds that begin when the kit leaves; a void's edges are measurements and stay. */
const KIT_LEFT = new Set(['breakdown', 'build', 'outro']);
/** The bar the kit leaves must carry at most this share of the low band the bar before had. */
const DEPARTURE_LOW = 0.5;

/**
 * The mirror of `pullOntoReturn`: a section the kit leaves begins on the bar it leaves. Where
 * a boundary into one sits a bar after a bar of no kicks that followed a bar of kicks, and
 * the kit has not come back on the boundary bar either, the boundary moves back onto the
 * departure. HIGHEST IN THE ROOM's second breakdown: the kit stops at 1:52.95 and the refine
 * had put the boundary on the crash a bar later, because arrivals are all it weighs. The
 * floor has to go with the kit: SICKO MODE's kick pauses a bar before its breakdown while
 * the 808 holds the low band at six tenths, and that bar is still the chorus; HIGHEST's low
 * band falls to a quarter on the bar the kit leaves. A pin from the refine does not hold
 * here - it pinned that crash - but a movement start, a hook bar or a drawn boundary does,
 * and the section before keeps at least two bars.
 */
export function pushOntoDeparture(
	segments: { startBar: number; endBar: number; kind: string }[],
	kicks: Int32Array,
	/** The low band per bar, 0..1. */
	low: ArrayLike<number>,
	keep: ReadonlySet<number>
): number[] {
	const moved: number[] = [];
	for (let i = 1; i < segments.length; i++) {
		const here = segments[i];
		const prev = segments[i - 1];
		const b = here.startBar;
		if (keep.has(b) || !KIT_LEFT.has(here.kind) || prev.kind === 'void') continue;
		if (b < 2 || b - 1 - prev.startBar < 2) continue;
		if (kicks[b] !== 0 || kicks[b - 1] !== 0 || kicks[b - 2] === 0) continue;
		if (!(low[b - 1] <= DEPARTURE_LOW * low[b - 2])) continue;
		here.startBar = b - 1;
		prev.endBar = b - 1;
		moved.push(b - 1);
	}
	return moved;
}

/**
 * Per-bar arrival strengths: the same evidence `refineBoundaries` weighs, as an array,
 * for the consolidation pass and the bench.
 */
export function arrivalStrengths(
	bars: BarFeatures,
	kicksPerBar: Int32Array | null,
	vocal: Float64Array | null = null,
	hooks: Uint8Array | null = null,
	settle: Float32Array | null = null,
	settleWeight = 0
): Float32Array {
	const db = barLevels(bars);
	const tol = LEVEL_TOL * levelSpread(db);
	const out = new Float32Array(bars.count);
	for (let b = 1; b < bars.count; b++) {
		out[b] = arrivalStrength(bars, db, tol, kicksPerBar, vocal, hooks, b, settle, settleWeight);
	}
	return out;
}

/**
 * Pull each boundary onto the arrival next door when the evidence there clearly beats it.
 *
 * Refinement, not re-segmentation: a boundary may move at most `REFINE_REACH` bars, may not
 * shorten a neighbour below `MIN_SEGMENT_BARS`, and stays put on a soft transition, where
 * arrival strength is mush on both sides and the DP's cohesion answer is the better one.
 */
export function refineBoundaries(
	bounds: number[],
	bars: BarFeatures,
	kicksPerBar: Int32Array | null,
	moves?: BoundaryMove[],
	floor = REFINE_FLOOR,
	vocal: Float64Array | null = null,
	hooks: Uint8Array | null = null,
	settle: Float32Array | null = null,
	settleWeight = 0,
	reach = REFINE_REACH,
	/** Boundaries that are walls rather than findings - movement starts - which no arrival may move. */
	fixed: ReadonlySet<number> = new Set()
): number[] {
	const db = barLevels(bars);
	const tol = LEVEL_TOL * levelSpread(db);
	const out = [...bounds];
	const score = (b: number) =>
		arrivalStrength(bars, db, tol, kicksPerBar, vocal, hooks, b, settle, settleWeight);

	for (let i = 1; i + 1 < out.length; i++) {
		const here = out[i];
		if (fixed.has(here)) continue;
		let best = here;
		let bestScore = score(here) * REFINE_MARGIN;
		for (let c = here - reach; c <= here + reach; c++) {
			if (c === here) continue;
			if (c - out[i - 1] < MIN_SEGMENT_BARS || out[i + 1] - c < MIN_SEGMENT_BARS) continue;
			const v = score(c);
			if (v > bestScore && v > floor) {
				bestScore = v;
				best = c;
			}
		}
		if (best !== here) {
			moves?.push({ from: here, to: best, score: bestScore });
			out[i] = best;
		}
	}
	return out;
}

/**
 * Re-read the boundaries that had only mush to stand on onto the phrase phase the pinned
 * arrivals prove.
 *
 * A pinned boundary sits on a measured hit - the kick wall, the sub slam, the voice - and
 * a track's arrivals overwhelmingly share one bar-phase mod 4. The boundaries between
 * gentle passages have no such evidence, land within a bar of the truth, and one bar early
 * is exactly how a show telegraphs its own next move. Nothing moves unless at least two
 * pins agree on a phase, and nothing moves further than the ambiguity being corrected.
 */
export function rephaseToPins(
	bounds: number[],
	pinned: Set<number>,
	barCount: number,
	tuning: StructureTuning = DEFAULT_TUNING,
	/**
	 * The pins whose phase agreement is trusted, when narrower than `pinned`. A moved pin
	 * proved the track's phase against a contested neighbour; a stayed pin is decisive
	 * about its own bar only - letting stays vote diluted a unanimous phase vote below
	 * agreement on Killing In the Name and switched the praised re-phasing off track-wide.
	 */
	voting: ReadonlySet<number> = pinned
): number[] {
	if (tuning.rephaseReach <= 0) return bounds;
	const pins = bounds.filter((b) => voting.has(b) && b > 0 && b < barCount);
	if (pins.length < tuning.rephaseMinPins) return bounds;

	const votes = new Int32Array(4);
	for (const p of pins) votes[p % 4]++;
	let phase = 0;
	for (let k = 1; k < 4; k++) if (votes[k] > votes[phase]) phase = k;
	// A split vote is a track whose phase genuinely moves; re-phasing it would invent order.
	if (votes[phase] < pins.length * tuning.rephaseAgreement) return bounds;

	const out = [...bounds];
	for (let i = 1; i + 1 < out.length; i++) {
		const here = out[i];
		if (pinned.has(here) || here % 4 === phase) continue;
		let target = here;
		let bestDist = tuning.rephaseReach + 1;
		for (let c = here - tuning.rephaseReach; c <= here + tuning.rephaseReach; c++) {
			if (c % 4 !== phase && ((c % 4) + 4) % 4 !== phase) continue;
			if (c - out[i - 1] < MIN_SEGMENT_BARS || out[i + 1] - c < MIN_SEGMENT_BARS) continue;
			const dist = Math.abs(c - here);
			if (dist < bestDist) {
				bestDist = dist;
				target = c;
			}
		}
		if (target !== here) {
			out[i] = target;
			// Re-phased onto the proven grid, so the later phrase snap must not drag it off.
			pinned.add(target);
		}
	}
	return out;
}

/**
 * How close two segments must come to their own internal cohesion to count as the same
 * material. Below 1 because a repeat is never identical: a second chorus has a different
 * vocal take and usually an extra layer.
 */
const SAME_MATERIAL = 0.92;
/**
 * And an absolute floor underneath it. The relative test alone is not enough: on a track whose
 * segments are internally loose, nine tenths of a low cohesion is a low bar, and everything
 * links into one group. Two passages that do not resemble each other this much are not the
 * same material however unlike themselves they each are.
 */
const SAME_MATERIAL_FLOOR = 0.62;

export interface SegmentGroup {
	/** Index of the earliest segment this one repeats, or null when it stands alone. */
	repeatOf: (number | null)[];
	/** Group id per segment; segments sharing an id are the same material. */
	group: number[];
}

/**
 * Which segments are the same material.
 *
 * Transitive closure is what turns a set of pairwise matches into "A B A B C B": if the
 * second chorus matches the first and the third matches the second, the third is a chorus
 * even if it never directly matched the first.
 */
export function groupSegments(
	sim: Float32Array,
	n: number,
	bounds: readonly number[],
	/** Movement starts: two songs never share material, however alike a bar of each measures. */
	movementStarts: readonly number[] = []
): SegmentGroup {
	const count = bounds.length - 1;
	const movementOf = (segment: number) => movementStarts.filter((m) => m <= bounds[segment]).length;
	const repeatOf = new Array<number | null>(count).fill(null);
	const group = new Array<number>(count).fill(-1);
	if (count === 0) return { repeatOf, group };

	// Cross-similarity of two segments: the mean of the best diagonal alignment, which is what
	// makes a 16-bar chorus match its own 8-bar half.
	const score = (a: number, b: number): number => {
		const aFrom = bounds[a];
		const aLen = bounds[a + 1] - aFrom;
		const bFrom = bounds[b];
		const bLen = bounds[b + 1] - bFrom;
		const len = Math.min(aLen, bLen);
		let acc = 0;
		for (let k = 0; k < len; k++) acc += sim[(aFrom + k) * n + (bFrom + k)];
		return acc / len;
	};

	if (count === 1) {
		group[0] = 0;
		return { repeatOf, group };
	}

	/**
	 * How much a segment's own bars resemble each other, which is the level a different
	 * segment has to reach to count as the same material.
	 *
	 * An absolute-ish reference, not a quantile of the pair distribution. A distribution cut
	 * admits a roughly fixed top slice whatever the content, so it can never answer "this
	 * track has no repeated material" and it fuses a uniform track into a single group; it can
	 * also land above 1.0, at which point a track gets no repeats at all.
	 */
	const cohesion = (s: number): number => {
		const from = bounds[s];
		const to = bounds[s + 1];
		let acc = 0;
		let pairs = 0;
		for (let i = from; i < to; i++) {
			for (let j = i + 1; j < Math.min(to, i + BAND + 1); j++) {
				acc += sim[i * n + j];
				pairs++;
			}
		}
		// A two-bar segment has almost no internal pairs, so it falls back to the diagonal,
		// which is 1 by construction and correctly makes it hard to match.
		return pairs > 0 ? acc / pairs : 1;
	};

	const self = Array.from({ length: count }, (_, s) => cohesion(s));

	const parent = Array.from({ length: count }, (_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

	for (let i = 0; i < count; i++) {
		for (let j = i + 1; j < count; j++) {
			const aLen = bounds[i + 1] - bounds[i];
			const bLen = bounds[j + 1] - bounds[j];
			// Segments of very different lengths are rarely the same thing, and letting them
			// link is how a whole track collapses into one group.
			if (Math.min(aLen, bLen) / Math.max(aLen, bLen) < 0.5) continue;
			if (movementOf(i) !== movementOf(j)) continue;
			// Two passages are the same material when they resemble each other nearly as much
			// as each resembles itself.
			const reference = Math.max(SAME_MATERIAL_FLOOR, ((self[i] + self[j]) / 2) * SAME_MATERIAL);
			if (score(i, j) < reference) continue;
			const ra = find(i);
			const rb = find(j);
			if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
		}
	}

	const ids = new Map<number, number>();
	for (let i = 0; i < count; i++) {
		const root = find(i);
		if (!ids.has(root)) ids.set(root, ids.size);
		group[i] = ids.get(root)!;
		if (root !== i) repeatOf[i] = root;
	}

	return { repeatOf, group };
}
