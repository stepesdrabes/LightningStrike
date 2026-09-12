import { PHRASE_BARS } from '@mv/core';
import type { BeatFeatures } from './beatsync.ts';
import { PITCH_CLASSES } from './chroma.ts';
import { quantile } from './dsp/stats.ts';

/** Sixteen sub-frames retain sixteenth-note pattern timing in 4/4 instead of averaging it away. */
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

/** Keep within-bar timing while aggregating to the grid where structural changes usually occur. */
export function barSynchronous(bf: BeatFeatures, beatsPerBar: number, phase: number): BarFeatures {
	const count = Math.max(0, Math.floor((bf.count - phase) / beatsPerBar));
	const starts = new Array<number>(count + 1);
	for (let b = 0; b <= count; b++) starts[b] = phase + b * beatsPerBar;
	return barSynchronousAt(bf, starts);
}

/**
 * Bar-start beat indices, ascending with an end boundary. Absorb edits as short bars so
 * pre-arrival gestures keep their duration.
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
function sliceSimilarity(sim: Float32Array, n: number, from: number, to: number): Float32Array {
	const m = to - from;
	const out = new Float32Array(m * m);
	for (let i = 0; i < m; i++) out.set(sim.subarray((from + i) * n + from, (from + i) * n + to), i * m);
	return out;
}

/** Allow settling contrast only below decisive physics; a strong arrival needs no extra boost. */
const SETTLE_GATE = 2;
/** Ignore level evidence below six dB dynamic range so a limited master's noise is not amplified. */
const MIN_LEVEL_SPREAD_DB = 6;
/** Level separation as a share of track p10-p90 range beyond which bars no longer match. */
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
	const silent = new Uint8Array(n);
	for (let b = 0; b < n; b++) {
		let content = 0;
		for (let k = 0; k < dim; k++) content += bars.pattern[b * dim + k];
		for (let k = 0; k < PITCH_CLASSES; k++) content += bars.chroma[b * PITCH_CLASSES + k];
		if (content === 0) silent[b] = 1;
	}

	// L2-normalised patterns lose level contrast. Restore it only as a similarity multiplier:
	// level may reject a match, never make different patterns match.
	const db = barLevels(bars);
	const tol = LEVEL_TOL * levelSpread(db);

	for (let i = 0; i < n; i++) {
		sim[i * n + i] = 1;
		for (let j = i + 1; j < n; j++) {
			if (silent[i] && silent[j]) {
				sim[i * n + j] = sim[j * n + i] = 1;
				continue;
			}
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

/** Compare nearby bars within BAND; distant bars in a developing section need not be identical. */
const BAND = 7;
/** Six-phrase maximum; level-aware similarity prevents matching loud and quiet runs of one figure. */
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
 * Subtract track-mean pair similarity before scoring segments. Without that baseline, banded
 * sums saturate with length and reward splitting homogeneous material into tiny sections.
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
 * Convolutive block matching (Marmoret et al.). A phrase-length cost breaks weak ties while
 * allowing strong off-grid changes.
 */
/**
 * Segment movements independently because each has its own similarity baseline; their starts
 * are mandatory boundaries.
 */
export function segmentMovements(sim: Float32Array, bars: BarFeatures, starts: readonly number[], lambda = LAMBDA): number[] {
	const edges = [...new Set([0, ...starts.filter((b) => b > 0 && b < bars.count), bars.count])].sort((a, b) => a - b);
	if (edges.length <= 2) return segmentBars(sim, bars, lambda);
	const bounds: number[] = [];
	for (let k = 0; k + 1 < edges.length; k++) {
		const from = edges[k];
		const to = edges[k + 1];
		const inner = segmentBars(sliceSimilarity(sim, bars.count, from, to), sliceBars(bars, from, to), lambda);
		for (const b of inner) if (b < to - from) bounds.push(from + b);
	}
	bounds.push(bars.count);
	return bounds;
}

export function segmentBars(sim: Float32Array, bars: BarFeatures, lambda = LAMBDA): number[] {
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
			const v = best[start] + segmentScore(sim, n, start, end, baseline) - unit * lambda * penalty;
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
 * Refine arrival placement after cohesion-based segmentation: adjacent drop bars have similar
 * material, so cohesion cannot reliably identify the hit itself.
 */
const REFINE_MARGIN = 1.45;
/** Below this, a bar's arrival is noise and has no business moving a boundary. */
const REFINE_FLOOR = 0.6;
/** How far a boundary may be pulled onto an arrival. One bar is the observed failure class. */
const REFINE_REACH = 1;

/** Arrival score combines level, kit, voice, prior collapse, and pattern novelty in comparable units. */
/** The arrival score taken apart, in the units the score sums them in. */
interface ArrivalParts {
	step: number;
	kit: number;
	/** 0..1, how far the bar before collapses under this one; the score weighs it at 0.8. */
	collapse: number;
	/** 0..1, one minus the pattern dot with the bar before; the score weighs it at 1.5. */
	novelty: number;
	voice: number;
	bass: number;
	/** The kit, the level, the collapse, the novelty and the bass: everything but the voice and the settling. */
	physics: number;
	settling: number;
}

function arrivalParts(
	bars: BarFeatures,
	db: Float32Array,
	tol: number,
	kicksPerBar: Int32Array | null,
	vocal: Float64Array | null,
	hooks: Uint8Array | null,
	b: number,
	settle: Float32Array | null = null,
	settleWeight = 0,
	settleGate = SETTLE_GATE,
	bassWeight = 0,
	kitMinKicks = 1
): ArrivalParts {
	const zero: ArrivalParts = { step: 0, kit: 0, collapse: 0, novelty: 0, voice: 0, bass: 0, physics: 0, settling: 0 };
	if (b <= 0 || b >= bars.count) return zero;
	const step = Math.max(0, db[b] - db[b - 1]) / tol;

	let kit = 0;
	if (kicksPerBar) {
		const now = kicksPerBar[b] ?? 0;
		const before = kicksPerBar[b - 1] ?? 0;
		if (now >= kitMinKicks && before === 0) kit = 1;
		else kit = Math.max(0, now - before) / 8;
	}

	// Lyrics contribute coverage jumps for sparse vocals and repeated-hook starts for continuous
	// vocals. Neither can exceed the refine floor alone; absent lyrics contribute zero.
	const entrance = vocal && vocal[b] >= 0.25 && (vocal[b - 1] ?? 0) < 0.1;
	const voice = entrance || (hooks && hooks[b] === 1) ? 1.2 : 0;

	// The held-breath bar: its quietest beat collapses while the arrival bar slams. Measured
	// against the bar's own mean so a track-wide quiet passage does not read as a dip.
	const collapse = collapseBefore(bars, b);

	let novelty = 0;
	{
		const dim = bars.patternDim;
		let dot = 0;
		let content = 0;
		for (let k = 0; k < dim; k++) {
			dot += bars.pattern[(b - 1) * dim + k] * bars.pattern[b * dim + k];
			content += bars.pattern[b * dim + k];
		}
		// An absent pattern is missing arrival evidence, not maximal novelty.
		if (content > 0) novelty = Math.max(0, 1 - dot);
	}

	// Settling contrast distinguishes a sustained arrival from a fill. Gate it off when physical
	// evidence is decisive so absolute pin, snap, and consolidation thresholds keep their scale.
	const bass = bassWeight > 0 ? bassWeight * Math.max(0, bars.low[b] - bars.low[b - 1]) : 0;
	const physics = step + kit + 0.8 * collapse + 1.5 * novelty + bass;
	const settling =
		settle && settleWeight > 0 && physics < settleGate
			? settleWeight * Math.max(0, settle[b])
			: 0;
	return { step, kit, collapse, novelty, voice, bass, physics, settling };
}

function arrivalStrength(
	bars: BarFeatures,
	db: Float32Array,
	tol: number,
	kicksPerBar: Int32Array | null,
	vocal: Float64Array | null,
	hooks: Uint8Array | null,
	b: number,
	settle: Float32Array | null = null,
	settleWeight = 0,
	settleGate = SETTLE_GATE,
	bassWeight = 0,
	kitMinKicks = 1
): number {
	const p = arrivalParts(bars, db, tol, kicksPerBar, vocal, hooks, b, settle, settleWeight, settleGate, bassWeight, kitMinKicks);
	return p.physics + p.voice + p.settling;
}

/**
 * An off-phrase move needs decisive physics plus kit arrival, pattern break, a sung entrance
 * after a dip, quiet-floor emergence, or a non-periodic collapse. Voice/settling alone cannot
 * pull boundaries onto pickups or a groove's repeating figure.
 */
export const IMPACT_KICKS = 4;
export const IMPACT_KICK_JUMP = 3;
const IMPACT_NOVELTY = 0.5;
const IMPACT_COLLAPSE = 0.625;
/** Quiet-floor share of p10-p90 range. Require two preceding quiet bars to exclude a one-bar dip. */
const QUIET_FLOOR = 0.45;
/** Require depth below loud passages; a compressed verse can be the bottom decile without being silence. */
const QUIET_DEPTH_DB = 8;
/** Similar arrivals two bars apart indicate a repeating groove figure, not a unique collapse. */
const PERIODIC_SHARE = 0.35;
/** Quiet-floor emergence still needs decisive arrival strength; a soft early pad must not shift the boundary. */
const QUIET_PHYSICS = 2.5;
/** Why an off-grid target counts as an impact, or the empty string when it does not. */
function offGridImpact(
	parts: ArrivalParts,
	physicsAt: (b: number) => number,
	kicksPerBar: Int32Array | null,
	/** The two bars before the target, as shares of the track's level range. */
	levelBefore: [number, number],
	/** How far the louder of those two bars sits under the track's p90 level, dB. */
	depthBefore: number,
	c: number,
	count: number,
	kitMinKicks = 1,
	quietPhysics = QUIET_PHYSICS
): string {
	if (parts.physics < 2) return '';
	if (kicksPerBar) {
		const now = kicksPerBar[c] ?? 0;
		const before = kicksPerBar[c - 1] ?? 0;
		if ((now >= IMPACT_KICKS && before <= 1) || now >= before + IMPACT_KICK_JUMP) return 'kit';
		if (before === 0 && now >= kitMinKicks && parts.voice > 0) return 'kit+voice';
	}
	if (parts.novelty >= IMPACT_NOVELTY) return 'novelty';
	if (parts.voice > 0 && parts.collapse >= IMPACT_COLLAPSE) return 'voice';
	if (
		levelBefore[0] <= QUIET_FLOOR &&
		levelBefore[1] <= QUIET_FLOOR &&
		depthBefore >= QUIET_DEPTH_DB &&
		parts.physics >= quietPhysics
	) {
		return 'quiet';
	}
	if (parts.collapse >= IMPACT_COLLAPSE) {
		const own = parts.physics;
		const periodic =
			c - 2 >= 1 && c + 2 < count && physicsAt(c - 2) >= PERIODIC_SHARE * own && physicsAt(c + 2) >= PERIODIC_SHARE * own;
		if (!periodic) return 'collapse';
	}
	return '';
}

/**
 * Apply the refine's physics-only off-grid guard to later moves. Voice cannot vouch for the
 * hook placement being judged.
 */
export function offGridMoveGuard(
	bars: BarFeatures,
	kicksPerBar: Int32Array | null,
	kitMinKicks = 1,
	quietPhysics = QUIET_PHYSICS
): (prevStart: number, from: number, to: number) => boolean {
	const db = barLevels(bars);
	const spread = levelSpread(db);
	const tol = LEVEL_TOL * spread;
	const q10 = quantile(db, 0.1);
	const q90 = quantile(db, 0.9);
	const parts = (b: number) => arrivalParts(bars, db, tol, kicksPerBar, null, null, b, null, 0, SETTLE_GATE, 0, kitMinKicks);
	const physicsAt = (b: number) => parts(b).physics;
	return (prevStart, from, to) => {
		const onGrid = (b: number) => (b - prevStart) % PHRASE_BARS === 0;
		if (!onGrid(from) || onGrid(to) || to < 2 || to >= bars.count) return true;
		const levelBefore: [number, number] = [(db[to - 1] - q10) / spread, (db[to - 2] - q10) / spread];
		const depthBefore = q90 - Math.max(db[to - 1], db[to - 2]);
		return offGridImpact(parts(to), physicsAt, kicksPerBar, levelBefore, depthBefore, to, bars.count, kitMinKicks, quietPhysics) !== '';
	};
}

/** One guard decision, for the bench: what the refine wanted and why it was or was not allowed. */
export interface GuardDecision {
	here: number;
	to: number;
	/** Empty when the move was refused. */
	impact: string;
	physics: number;
	kit: number;
	novelty: number;
	voice: number;
	collapse: number;
	levelBefore: [number, number];
	depthBefore: number;
}

/** Per-bar similarity to the next bar minus the previous; new sustained material scores positively. */
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

/** Bench-sweep structure constants; shipping callers use the measured defaults. */
export interface StructureTuning {
	/** Arrival score below which a boundary does not move at all. */
	refineFloor: number;
	/** Arrival score below which a refined move may not become a phase pin. */
	pinScore: number;
	/**
	 * Unmoved boundaries need a higher physics-only pin threshold because they have not beaten
	 * neighbours in a refine contest. Lyric evidence cannot pre-empt downstream lyric placement.
	 */
	stayPinScore: number;
	/** 0 disables re-phasing entirely. Bars a boundary may be dragged onto the pinned phase. */
	rephaseReach: number;
	/** Fewest pins whose phase agreement is trusted. */
	rephaseMinPins: number;
	/** Share of pins that must share the winning phase. */
	rephaseAgreement: number;
	/** Same-kind seam arrival floor for consolidation; zero disables it. */
	consolidateFloor: number;
	/**
	 * Settling-contrast weight; zero preserves the measured default. A positive weight requires
	 * retuning refineFloor, pinScore, consolidateFloor, and hook-snap decisive/noise thresholds.
	 */
	settleWeight: number;
	/** Bars a boundary may be pulled onto an arrival by the refine pass. */
	refineReach: number;
	/** How much more a neighbouring arrival must score than the boundary's own bar to take it. */
	refineMargin: number;
	/** Physics score under which the settling term may vote; Infinity lets it vote everywhere. */
	settleGate: number;
	/** Low-band arrival weight; distinguishes the floor landing from the preceding crash/fill. Zero disables it. */
	bassWeight: number;
	/** Minimum kicks establishing kit return after silence; one detected kick may be only a pickup. */
	kitMinKicks: number;
	/** Phrase-grid physical arrival floor for splitting long sections; zero disables splits. */
	splitAtArrival: number;
	/** Weight of the DP's phrase-length prior, in bars-worth of banded evidence. */
	lambda: number;
	/** Bars the hook snap may pull a chorus-class start back onto a sung hook; 0 disables the snap. */
	hookSnapReach: number;
	/** Protect decisive arrivals from hook snaps, including later restart moves and weaker restart edges. */
	hookSnapStrict: boolean;
	/** Guard off-phrase refine moves so pickups, shouts, or hook riffs cannot displace the following downbeat. */
	pickupGuard: boolean;
	/**
	 * Refinement cannot move onto a fill. A fill already selected by DP may retain its pin because
	 * its material change independently supports the boundary.
	 */
	fillVeto: boolean;
	/** Physical arrival floor needed for a quiet-floor event to move a boundary off-grid. */
	quietImpactPhysics: number;
	/** Collapse two boundaries surrounding a one-bar arrival the DP's two-bar minimum cannot represent. */
	straddle: boolean;
	/** Move a build opening on a fill to the following kit departure; otherwise builds may start under kit. */
	departFromFill: boolean;
	/** Optional song-vocabulary shift onto an agreed sung phase when most boundaries sit one bar before it. */
	sungPhase: boolean;
	/**
	 * Optional hook splits in long verse/chorus sections. Disabled: repeated lines within one
	 * section produced more false seams than recovered boundaries in the judged corpus.
	 */
	hookSplit: boolean;
}

/** Defaults selected by the 60-track Harmonix and 60-track Raveform boundary sweep. */
export const DEFAULT_TUNING: StructureTuning = {
	refineFloor: 2,
	pinScore: 2,
	rephaseReach: 1,
	rephaseMinPins: 3,
	rephaseAgreement: 0.8,
	// Corpus-selected consolidation floor. Material agreement is required so soft real boundaries survive.
	consolidateFloor: 1.6,
	// Keep settling disabled: gated sweeps yielded no boundary gain, while ungated weights moved
	// accepted arrivals. Retain the dial for measured experiments.
	settleWeight: 0,
	refineReach: 1,
	refineMargin: REFINE_MARGIN,
	settleGate: SETTLE_GATE,
	bassWeight: 0,
	kitMinKicks: 1,
	splitAtArrival: 0,
	// Stay-pin floor tuned by bench/mapsweep.ts to preserve accepted physical arrivals.
	stayPinScore: 2,
	lambda: LAMBDA,
	hookSnapReach: 2,
	// Jointly tuned by bench/mapsweep.ts; off-grid guard and quiet-floor depth must be evaluated together.
	hookSnapStrict: true,
	pickupGuard: true,
	fillVeto: true,
	// Jointly tuned with grid changes on the 2026-09-08 maps; optional hook splits remain disabled.
	quietImpactPhysics: QUIET_PHYSICS,
	straddle: true,
	departFromFill: true,
	sungPhase: true,
	hookSplit: false
};

/**
 * A fill is loud, unlike either neighbour, with the next bar settling. Use level-free patterns
 * so loudness cannot bind the fill to the preceding passage.
 */
const FILL_SETTLE = 0.25;
const FILL_LOUDER_DB = 1.5;
export function isFill(bars: BarFeatures, db: Float32Array, b: number): boolean {
	if (b < 1 || b + 4 >= bars.count) return false;
	const dim = bars.patternDim;
	const dot = (x: number, y: number) => {
		let s = 0;
		for (let k = 0; k < dim; k++) s += bars.pattern[x * dim + k] * bars.pattern[y * dim + k];
		return s;
	};
	const ahead = (x: number) => (dot(x, x + 1) + dot(x, x + 2) + dot(x, x + 3)) / 3;
	return ahead(b + 1) - ahead(b) >= FILL_SETTLE && db[b] >= db[b + 1] + FILL_LOUDER_DB;
}

/** The held-breath test the arrival score uses: the bar before collapses into this one. */
function collapseBefore(bars: BarFeatures, b: number): number {
	const dipRef = bars.rms[b];
	if (dipRef <= 1e-6) return 0;
	return Math.max(0, 1 - bars.floor[b - 1] / dipRef);
}

/**
 * Move a tension-bar boundary onto a decisive kit return only when the destination section
 * keeps the kit. Preserve keep/void edges and two-bar minimums. Return target bars so
 * consolidation protects them.
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
/** Or of its level, where the boundary sits a bar before the kit leaves. */
const DEPARTURE_LEVEL = 0.7;

/**
 * Move kit-free section starts back onto kit departure only when the low-band floor also
 * fell. Refine pins may yield; movement/hook/drawn boundaries and two-bar minimums do not.
 */
export function pushOntoDeparture(
	segments: { startBar: number; endBar: number; kind: string }[],
	kicks: Int32Array,
	/** The low band per bar, 0..1. */
	low: ArrayLike<number>,
	/** The level per bar, 0..100, for the forward case: a synth bass can hold the low band through an outro. */
	energy: ArrayLike<number>,
	keep: ReadonlySet<number>,
	/** Bars that read as drum fills; a build opened on one may move forward onto the departure. */
	fills: Uint8Array | null = null
): number[] {
	const moved: number[] = [];
	for (let i = 1; i < segments.length; i++) {
		const here = segments[i];
		const prev = segments[i - 1];
		const b = here.startBar;
		if (keep.has(b) || !KIT_LEFT.has(here.kind) || prev.kind === 'void') continue;
		if (b >= 2 && b - 1 - prev.startBar >= 2 && kicks[b] === 0 && kicks[b - 1] === 0 && kicks[b - 2] > 0 && low[b - 1] <= DEPARTURE_LOW * low[b - 2]) {
			here.startBar = b - 1;
			prev.endBar = b - 1;
			moved.push(b - 1);
			continue;
		}
		// Move outro/breakdown boundaries forward to kit departure. Apply to builds only when they
		// open on a fill; ordinary builds may start while drums still play.
		const falls = low[b + 1] <= DEPARTURE_LOW * low[b] || energy[b + 1] <= DEPARTURE_LEVEL * energy[b];
		const mayLead = here.kind !== 'build' || fills?.[b] === 1;
		if (mayLead && b + 1 < kicks.length && here.endBar - (b + 1) >= 2 && kicks[b] > 0 && kicks[b + 1] <= 1 && falls) {
			here.startBar = b + 1;
			prev.endBar = b + 1;
			moved.push(b + 1);
		}
	}
	return moved;
}

/** Split long segments at decisive physical arrivals on their own phrase grid; return a new table. */
export function splitAtArrivals(bounds: number[], physical: Float32Array, floor: number, minBars = 12): number[] {
	if (floor <= 0) return bounds;
	const out = [...bounds];
	for (let i = 0; i + 1 < bounds.length; i++) {
		const from = bounds[i];
		const to = bounds[i + 1];
		if (to - from < minBars) continue;
		for (let b = from + PHRASE_BARS; b + PHRASE_BARS <= to; b += PHRASE_BARS) {
			if (physical[b] >= floor && !out.includes(b)) out.push(b);
		}
	}
	return out.sort((a, b) => a - b);
}

/** Shared per-bar arrival evidence for refinement, consolidation, and bench probes. */
export function arrivalStrengths(
	bars: BarFeatures,
	kicksPerBar: Int32Array | null,
	vocal: Float64Array | null = null,
	hooks: Uint8Array | null = null,
	settle: Float32Array | null = null,
	settleWeight = 0,
	settleGate = SETTLE_GATE,
	bassWeight = 0,
	kitMinKicks = 1
): Float32Array {
	const db = barLevels(bars);
	const tol = LEVEL_TOL * levelSpread(db);
	const out = new Float32Array(bars.count);
	for (let b = 1; b < bars.count; b++) {
		out[b] = arrivalStrength(bars, db, tol, kicksPerBar, vocal, hooks, b, settle, settleWeight, settleGate, bassWeight, kitMinKicks);
	}
	return out;
}

/** Which bars read as drum fills, for the pin pass and the bench. */
export function fillBars(bars: BarFeatures): Uint8Array {
	const db = barLevels(bars);
	const out = new Uint8Array(bars.count);
	for (let b = 1; b < bars.count; b++) if (isFill(bars, db, b)) out[b] = 1;
	return out;
}

/** Bench output of arrival components in the units used by the combined score. */
export function arrivalComponents(
	bars: BarFeatures,
	kicksPerBar: Int32Array | null,
	vocal: Float64Array | null,
	hooks: Uint8Array | null,
	kitMinKicks = 1
): { step: Float32Array; kit: Float32Array; dip: Float32Array; novelty: Float32Array; voice: Float32Array } {
	const db = barLevels(bars);
	const tol = LEVEL_TOL * levelSpread(db);
	const n = bars.count;
	const step = new Float32Array(n);
	const kit = new Float32Array(n);
	const dip = new Float32Array(n);
	const novelty = new Float32Array(n);
	const voice = new Float32Array(n);
	for (let b = 1; b < n; b++) {
		const p = arrivalParts(bars, db, tol, kicksPerBar, vocal, hooks, b, null, 0, SETTLE_GATE, 0, kitMinKicks);
		step[b] = p.step;
		kit[b] = p.kit;
		dip[b] = 0.8 * p.collapse;
		novelty[b] = 1.5 * p.novelty;
		voice[b] = p.voice;
	}
	return { step, kit, dip, novelty, voice };
}

/**
 * Move boundaries only toward clearly stronger nearby arrivals while retaining minimum section
 * lengths. Soft transitions keep the DP's cohesion-based placement.
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
	fixed: ReadonlySet<number> = new Set(),
	margin = REFINE_MARGIN,
	settleGate = SETTLE_GATE,
	bassWeight = 0,
	kitMinKicks = 1,
	pickupGuard = false,
	fillVeto = false,
	/** A bench sink for the guard's decisions; nothing shipped passes one. */
	guardLog?: GuardDecision[],
	/** Guarded boundaries still have nearby arrival evidence; protect them from later consolidation. */
	held?: number[],
	quietPhysics = QUIET_PHYSICS,
	straddle = false
): number[] {
	const db = barLevels(bars);
	const spread = levelSpread(db);
	const tol = LEVEL_TOL * spread;
	const q10 = quantile(db, 0.1);
	const q90 = quantile(db, 0.9);
	const out = [...bounds];
	const parts = (b: number) =>
		arrivalParts(bars, db, tol, kicksPerBar, vocal, hooks, b, settle, settleWeight, settleGate, bassWeight, kitMinKicks);
	const score = (b: number) => {
		const p = parts(b);
		return p.physics + p.voice + p.settling;
	};
	const physicsAt = (b: number) => parts(b).physics;

	// Collapse a two-bar transition around its stronger middle arrival only when physical
	// evidence clears the margin and floor. The resulting boundary retains its earned pin.
	if (straddle) {
		for (let i = 1; i + 2 < out.length; i++) {
			const a = out[i];
			const b = out[i + 1];
			if (b - a !== 2 || fixed.has(a) || fixed.has(b)) continue;
			const mid = a + 1;
			if (fillVeto && isFill(bars, db, mid)) continue;
			const v = score(mid);
			if (physicsAt(mid) < floor || v <= margin * Math.max(score(a), score(b))) continue;
			out.splice(i, 2, mid);
			moves?.push({ from: a, to: mid, score: v }, { from: b, to: mid, score: v });
		}
	}

	for (let i = 1; i + 1 < out.length; i++) {
		const here = out[i];
		if (fixed.has(here)) continue;
		// Use the previous boundary's phrase grid to distinguish a final-bar pickup from the next downbeat.
		const onGrid = (b: number) => (b - out[i - 1]) % PHRASE_BARS === 0;
		let best = here;
		let bestScore = score(here) * margin;
		for (let c = here - reach; c <= here + reach; c++) {
			if (c === here) continue;
			if (c - out[i - 1] < MIN_SEGMENT_BARS || out[i + 1] - c < MIN_SEGMENT_BARS) continue;
			if (fillVeto && isFill(bars, db, c)) continue;
			if (pickupGuard && onGrid(here) && !onGrid(c)) {
				const p = parts(c);
				const levelBefore: [number, number] = [(db[c - 1] - q10) / spread, (db[Math.max(0, c - 2)] - q10) / spread];
				const depthBefore = q90 - Math.max(db[c - 1], db[Math.max(0, c - 2)]);
				const impact = offGridImpact(p, physicsAt, kicksPerBar, levelBefore, depthBefore, c, bars.count, kitMinKicks, quietPhysics);
				// Logged only where the move would otherwise have been taken, so the log reads as
				// the guard's verdicts and not as every neighbour the refine glanced at.
				const wanted = score(c) > score(here) * margin && score(c) > floor;
				if (guardLog && wanted) {
					guardLog.push({ here, to: c, impact, physics: p.physics, kit: p.kit, novelty: p.novelty, voice: p.voice, collapse: p.collapse, levelBefore, depthBefore });
				}
				if (!impact) {
					if (wanted && held && !held.includes(here)) held.push(here);
					continue;
				}
			}
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
 * Move weak boundaries onto the phrase phase supported by agreeing arrival pins; require
 * enough agreement and limit movement to the ambiguity being corrected.
 */
export function rephaseToPins(
	bounds: number[],
	pinned: Set<number>,
	barCount: number,
	tuning: StructureTuning = DEFAULT_TUNING,
	/**
	 * Use contested moved pins for phase agreement when supplied; stayed pins support only their
	 * own bar and can dilute the shared-phase vote.
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

/** Relative self-cohesion needed for a repeat; below one permits changed vocals and extra layers. */
const SAME_MATERIAL = 0.92;
/** Absolute similarity floor prevents low-cohesion passages from all matching each other. */
const SAME_MATERIAL_FLOOR = 0.62;

export interface SegmentGroup {
	/** Index of the earliest segment this one repeats, or null when it stands alone. */
	repeatOf: (number | null)[];
	/** Group id per segment; segments sharing an id are the same material. */
	group: number[];
}

/** Transitive closure joins repeat groups even when only adjacent reprises directly match. */
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
	 * Compare cross-segment similarity with within-segment cohesion. Pair-distribution quantiles
	 * would force repeats even on tracks without repeated material.
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
			// Reject large length mismatches so transitive repeat links cannot collapse the whole track.
			if (Math.min(aLen, bLen) / Math.max(aLen, bLen) < 0.5) continue;
			if (movementOf(i) !== movementOf(j)) continue;

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
