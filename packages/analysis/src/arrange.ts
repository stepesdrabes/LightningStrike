import {
	BAND_EDGES_HZ,
	BARS_PER_PHRASE,
	NUM_BANDS,
	PHRASE_BARS,
	nearestPhraseBar,
	onPhraseGrid,
	sectionBase,
	type EventTag,
	type SectionKind
} from '@mv/core';
import type { BarFeatures } from './structure.ts';
import type { SegmentGroup } from './structure.ts';
import { sliceBars } from './structure.ts';
import type { Spectrogram } from './dsp/spectrogram.ts';
import { clamp01, mean, median, normalise, quantile } from './dsp/stats.ts';
import { sectionFeatures } from './sectionFeatures.ts';
import { dropMargin } from './sectionModel.ts';

export interface Segment {
	startBar: number;
	endBar: number;
	kind: SectionKind;
	/** Material identity, independent of lighting kind: equal kinds alone do not imply equal passages. */
	group: number;
}

export interface Arrangement {
	segments: Segment[];
	/** count per bar, 0..1, levelled within each movement. */
	energy: Float32Array;
	/** Whole-file energy for cross-movement comparisons; equals energy on a single movement. */
	energyGlobal: Float32Array;
	/** count * NUM_BANDS per bar, 0..1. */
	bands: Float32Array;
	events: EventTag[][];
	phraseAnchorBar: number;
}

/** Mean four-band levels, dB, over time spans shared by beat and bar measurements. */
export function bandLevels(spec: Spectrogram, time: Float64Array, count: number): Float32Array {
	const out = new Float32Array(count * NUM_BANDS);
	const edges: [number, number][] = [];
	for (let k = 0; k < NUM_BANDS; k++) {
		let lo = 0;
		let hi = spec.bands;
		while (lo < spec.bands && spec.centreHz[lo] < BAND_EDGES_HZ[k]) lo++;
		while (hi > lo && spec.centreHz[hi - 1] > BAND_EDGES_HZ[k + 1]) hi--;
		edges.push([lo, Math.max(hi, lo + 1)]);
	}

	for (let b = 0; b < count; b++) {
		const f0 = Math.max(0, Math.round(time[b] * spec.fps));
		const f1 = Math.max(f0 + 1, Math.min(spec.frames, Math.round(time[b + 1] * spec.fps)));
		for (let k = 0; k < NUM_BANDS; k++) {
			const [lo, hi] = edges[k];
			let acc = 0;
			for (let f = f0; f < f1; f++) {
				for (let j = lo; j < hi; j++) acc += spec.mag[f * spec.bands + j];
			}
			const linear = acc / ((f1 - f0) * (hi - lo));
			out[b * NUM_BANDS + k] = 20 * Math.log10(Math.max(linear, 1e-7));
		}
	}
	return out;
}

/** Energy, 0..1 across track, weighted toward bass so a noise riser cannot outrank its drop. */
function barEnergy(bandsN: Float32Array, count: number, loudN: Float32Array): Float32Array {
	const energy = new Float32Array(count);
	for (let b = 0; b < count; b++) {
		energy[b] = clamp01(
			0.34 * loudN[b] +
				0.28 * bandsN[b * NUM_BANDS] +
				0.2 * bandsN[b * NUM_BANDS + 1] +
				0.18 * bandsN[b * NUM_BANDS + 2]
		);
	}
	return energy;
}

/** Normalise per movement only when it spans two phrases; shorter spans amplify their own noise. */
const MIN_MOVEMENT_BARS = 8;
function spansFor(movements: readonly number[], count: number): number[] {
	const starts = [0];
	for (const m of movements) {
		if (m - starts[starts.length - 1] >= MIN_MOVEMENT_BARS && count - m >= MIN_MOVEMENT_BARS) {
			starts.push(m);
		}
	}
	starts.push(count);
	return starts;
}

/** `normalise`, but each movement against its own distribution. */
function normaliseWithin(a: Float32Array, starts: readonly number[]): Float32Array {
	const out = new Float32Array(a.length);
	for (let i = 0; i + 1 < starts.length; i++) {
		out.set(normalise(a.subarray(starts[i], starts[i + 1]), 0.02, 0.98), starts[i]);
	}
	return out;
}

/** Short-term loudness resampled onto a time grid, then normalised within each movement. */
function loudnessOn(
	shortTerm: Float32Array,
	fps: number,
	time: Float64Array,
	count: number,
	starts: readonly number[]
): Float32Array {
	const out = new Float32Array(count);
	for (let b = 0; b < count; b++) {
		const f0 = Math.max(0, Math.round(time[b] * fps));
		const f1 = Math.max(f0 + 1, Math.min(shortTerm.length, Math.round(time[b + 1] * fps)));
		let acc = 0;
		let n = 0;
		for (let f = f0; f < f1; f++) {
			if (Number.isFinite(shortTerm[f])) {
				acc += shortTerm[f];
				n++;
			}
		}
		out[b] = n > 0 ? acc / n : -70;
	}
	return normaliseWithin(out, starts);
}

/** Minimum sustained lift establishing drop behaviour; a track's loudest passage alone is insufficient. */
const DROP_STEP = 0.22;
/** Breakdown depth below the track body. A quantile would force breakdowns onto flat tracks. */
const BREAKDOWN_STEP = 0.2;
/** A breath needs both a quiet beat and a collapsed bar; one gap inside a full bar is insufficient. */
const VOID_RATIO = 0.35;
/** Kit withdrawal distinguishes a filtered breakdown from a groove even when their levels match. */
const BREAKDOWN_KIT = 0.62;
/** Minimum kit return for the track to have drops; the section model assigns individual drop labels. */
const DROP_KICK_STEP = 0.3;
/**
 * Sustained pounding also establishes drop culture when limiting hides energy/kit steps.
 * Require every inner section to retain half its q90 kick level and nearly continuous kit.
 * Genre-gated: constant rock drums and missing metadata do not earn club treatment.
 */
const POUND_KICK = 0.5;
const POUND_KIT = 0.9;
/** A build withdraws kick relative to the drop ahead while snare/noise rise. */
const BUILD_KICK_RATIO = 0.85;
const BUILD_SNARE_RISE = 1.15;

/** Bench-only build walk-back tuning. Defaults come from the 2026-08-12 Harmonix/Raveform sweep. */
export interface LabelTuning {
	/** Longest total walk-back, bars. */
	maxBuildBars: number;
	/** Earlier build segments must rise internally; the one touching the drop may be a flat-loud riser. */
	riseBeyondFirst: boolean;
	/** Second-half air over first-half air that counts as rising within a segment. */
	riseRatio: number;
	/** Stop at existing breakdowns except the touching segment, which may be a kit-free riser. */
	breakOnBreakdown: boolean;
}

/**
 * The corpus sweep favoured a one-phrase cap and preserved breakdowns; requiring internal
 * rise missed EDM builds, so that test stays disabled.
 */
export const DEFAULT_LABEL_TUNING: LabelTuning = {
	maxBuildBars: 8,
	riseBeyondFirst: false,
	riseRatio: 1,
	breakOnBreakdown: true
};
/** The longest a merge may make a section. Four phrases. */
const MAX_MERGED_BARS = 32;
const MAX_VOID_BARS = 2;
/** Silence floor relative to the track median, 30 dB down: arrangement changes should not cross it. */
const SILENT_RATIO = 0.03;

/**
 * Band levels and energy, 0..1 within each movement. Normalise each band independently so a
 * quiet song in a medley is judged against itself.
 */
export function levelEnvelopes(
	bandsDb: Float32Array,
	shortTerm: Float32Array,
	shortTermFps: number,
	time: Float64Array,
	count: number,
	movements: readonly number[] = []
): { energy: Float32Array; energyGlobal: Float32Array; bands: Float32Array } {
	const starts = spansFor(movements, count);
	const whole = [0, count];
	const bands = new Float32Array(count * NUM_BANDS);
	const bandsWhole = new Float32Array(count * NUM_BANDS);
	for (let k = 0; k < NUM_BANDS; k++) {
		const slice = new Float32Array(count);
		for (let b = 0; b < count; b++) slice[b] = bandsDb[b * NUM_BANDS + k];
		const n = normaliseWithin(slice, starts);
		const w = starts.length === 2 ? n : normaliseWithin(slice, whole);
		for (let b = 0; b < count; b++) {
			bands[b * NUM_BANDS + k] = n[b];
			bandsWhole[b * NUM_BANDS + k] = w[b];
		}
	}
	const energy = barEnergy(bands, count, loudnessOn(shortTerm, shortTermFps, time, count, starts));
	return {
		energy,
		// Whole-file normalisation supports peak comparisons between independently levelled movements.
		energyGlobal:
			starts.length === 2
				? energy
				: barEnergy(bandsWhole, count, loudnessOn(shortTerm, shortTermFps, time, count, whole)),
		bands
	};
}

/** Kit fullness relative to the track's own busiest bars. */
interface DrumState {
	kick: number;
	snare: number;
	/** Share of the segment's bars with any of the kit in them at all. */
	kit: number;
}

/**
 * Skip kit-based labels when no meaningful percussion is audible; no detections must not
 * turn a string quartet into continuous breakdowns.
 */
function readDrums(
	segments: readonly Segment[],
	kicksPerBar: Int32Array,
	snaresPerBar: Int32Array
): { states: DrumState[]; audible: boolean } {
	const kickRef = quantile(kicksPerBar, 0.9);
	const snareRef = quantile(snaresPerBar, 0.9);
	const states = segments.map((s) => {
		const hi = Math.min(s.endBar, kicksPerBar.length);
		let kicks = 0;
		let snares = 0;
		let played = 0;
		for (let b = s.startBar; b < hi; b++) {
			kicks += kicksPerBar[b];
			snares += snaresPerBar[b];
			if (kicksPerBar[b] > 0 || snaresPerBar[b] > 0) played++;
		}
		const bars = Math.max(1, hi - s.startBar);
		return {
			kick: kickRef > 0 ? kicks / bars / kickRef : 0,
			snare: snareRef > 0 ? snares / bars / snareRef : 0,
			kit: played / bars
		};
	});
	return { states, audible: kickRef > 0 || snareRef > 0 };
}

export function arrange(
	bandsDb: Float32Array,
	bars: BarFeatures,
	bounds: readonly number[],
	groups: SegmentGroup,
	shortTerm: Float32Array,
	shortTermFps: number,
	kicksPerBar: Int32Array,
	snaresPerBar: Int32Array,
	/** Boundaries placed on measured arrivals, which the phrase snap must not drag off them. */
	pinned: ReadonlySet<number> = new Set(),
	label: LabelTuning = DEFAULT_LABEL_TUNING,
	/** Genre family is club-side; arms the pounding form of `hasDrops`. */
	clubFamily = false,
	/** Bars where a new song starts, so each is levelled against itself. */
	movements: readonly number[] = [],
	/** Only the final movement may receive an ending outro/ring-out; a song switch can interrupt any section. */
	endsTheRecord = true
): Arrangement {
	const count = bars.count;

	const { energy, energyGlobal, bands: bandsN } = levelEnvelopes(
		bandsDb,
		shortTerm,
		shortTermFps,
		bars.time,
		count,
		movements
	);
	const events: EventTag[][] = Array.from({ length: count }, () => []);

	const segments: Segment[] = [];
	for (let i = 0; i + 1 < bounds.length; i++) {
		segments.push({
			startBar: bounds[i],
			endBar: bounds[i + 1],
			kind: 'groove',
			group: groups.group[i] ?? i
		});
	}
	if (segments.length === 0) {
		return { segments, energy, energyGlobal, bands: bandsN, events, phraseAnchorBar: 0 };
	}

	const segEnergy = segments.map((s) => mean(energy, s.startBar, s.endBar));
	// Every question of the form "which of these is the biggest" is asked on the whole-file
	// scale, because two movements levelled against themselves both reach 1.0 and comparing
	// them on their own scales hands the peak to whichever song has the tighter distribution.
	const segEnergyWhole = segments.map((s) => mean(energyGlobal, s.startBar, s.endBar));
	const { states: kit, audible } = readDrums(segments, kicksPerBar, snaresPerBar);
	const segSub = segments.map((s) => meanBand(bandsN, s.startBar, s.endBar, 0));

	// Choose whether the track has drops before assigning them. Kit returns count even when
	// mastering leaves no energy step.
	let biggestStep = 0;
	let biggestKickStep = 0;
	for (let i = 1; i < segments.length; i++) {
		biggestStep = Math.max(biggestStep, segEnergyWhole[i] - segEnergyWhole[i - 1]);
		biggestKickStep = Math.max(biggestKickStep, kit[i].kick - kit[i - 1].kick);
	}
	// Require audible kit for both drop tests; energy steps alone can be beatless string swells.
	const inner = kit.slice(1, Math.max(1, kit.length - 1));
	const pounds =
		clubFamily &&
		inner.length > 0 &&
		inner.every((k) => k.kick >= POUND_KICK && k.kit >= POUND_KIT);
	const hasDrops =
		audible && (biggestStep >= DROP_STEP || biggestKickStep >= DROP_KICK_STEP || pounds);

	const body = median(segEnergy);
	const loudLevel = Math.max(quantile(segEnergy, 0.7), Math.max(...segEnergy) * 0.82);

	// The fitted model decides groove versus drop only; positional and kit/silence rules decide
	// intro, outro, build, breakdown, and void.
	const features = sectionFeatures({
		energy,
		bands: bandsN,
		kicks: kicksPerBar,
		snares: snaresPerBar,
		segments,
		barCount: count
	});

	// Pool margins by repeat group before labelling so the same material cannot straddle zero
	// due to small section differences.
	const margin = new Map<number, number>();
	const undecided: number[] = [];
	for (let i = 0; i < segments.length; i++) {
		const e = segEnergy[i];
		if (audible && kit[i].kit < BREAKDOWN_KIT && e < loudLevel) {
			// Kit withdrawal detects filtered breakdowns even when loudness stays constant.
			segments[i].kind = 'breakdown';
			continue;
		}
		if (e <= body - BREAKDOWN_STEP) {
			segments[i].kind = 'breakdown';
			continue;
		}
		margin.set(i, dropMargin(features[i]));
		undecided.push(i);
	}

	const groupMargin = new Map<number, { acc: number; weight: number }>();
	for (const i of undecided) {
		const g = segments[i].group;
		if (g < 0) continue;
		const len = segments[i].endBar - segments[i].startBar;
		const cell = groupMargin.get(g) ?? { acc: 0, weight: 0 };
		cell.acc += (margin.get(i) ?? 0) * len;
		cell.weight += len;
		groupMargin.set(g, cell);
	}

	for (const i of undecided) {
		const g = segments[i].group;
		const pooled = g >= 0 ? groupMargin.get(g) : undefined;
		const z = pooled && pooled.weight > 0 ? pooled.acc / pooled.weight : (margin.get(i) ?? 0);

		// Require drop culture and two establishing phrases before allowing model drop labels.
		const settled = segments[i].startBar >= 2 * PHRASE_BARS;
		segments[i].kind = z > 0 && hasDrops && settled ? 'drop' : 'groove';
	}

	// Near-zero model margins must not let a small boundary change demote the track's loudest passage.
	if (hasDrops) {
		let peak = -1;
		for (const i of undecided) {
			if (segments[i].kind !== 'groove') continue;
			if (segments[i].startBar < 2 * PHRASE_BARS) continue;
			if (peak < 0 || segEnergyWhole[i] > segEnergyWhole[peak]) peak = i;
		}
		const loudest = Math.max(...segEnergyWhole);
		if (peak >= 0 && segEnergyWhole[peak] >= loudest - 1e-9) {
			const g = segments[peak].group;
			const pooled = g >= 0 ? groupMargin.get(g) : undefined;
			const z = pooled && pooled.weight > 0 ? pooled.acc / pooled.weight : (margin.get(peak) ?? 0);
			if (z > -0.6) {
				for (const i of undecided) {
					if (
						segments[i].group === g &&
						segments[i].kind === 'groove' &&
						segments[i].startBar >= 2 * PHRASE_BARS
					) {
						segments[i].kind = 'drop';
					}
				}
			}
		}
	}

	// A track with dynamics has a peak whether or not the step test caught it.
	if (hasDrops && !segments.some((s) => s.kind === 'drop')) {
		let best = 0;
		for (let i = 1; i < segments.length; i++) if (segEnergyWhole[i] > segEnergyWhole[best]) best = i;
		segments[best].kind = 'drop';
	}

	// Classify silence before neighbour rules; relative energy alone would label and light it as a breakdown.
	const silenceFloor = median(bars.rms) * SILENT_RATIO;
	for (const s of segments) {
		let silent = true;
		for (let b = s.startBar; b < s.endBar && silent; b++) silent = bars.rms[b] < silenceFloor;
		if (!silent) continue;
		// Opening silence is intro; the void instruction belongs inside an established show.
		if (s.startBar < 16) {
			s.kind = 'intro';
			continue;
		}
		// Carved rather than played, so it belongs to no group and can never be a repeat target.
		s.kind = 'void';
		s.group = -1;
	}

	// Read builds backward from the drop they prepare.
	const looksLikeBuild = (p: number, drop: number): boolean => {
		const prev = segments[p];
		const airBefore = meanBand(bandsN, prev.startBar, prev.endBar, 3);
		const airEarlier = meanBand(bandsN, Math.max(0, prev.startBar - 8), prev.startBar, 3);
		const climbing = airBefore > airEarlier * 1.08;
		const withdrawn = segSub[p] < segSub[drop] * 0.8;
		// Require withdrawn kick and climbing snare; lower energy alone does not establish a build.
		const kickHeld = audible && kit[p].kick < kit[drop].kick * BUILD_KICK_RATIO;
		const snareClimbing =
			audible && p > 0 && kit[p].snare > kit[p - 1].snare * BUILD_SNARE_RISE;
		return climbing || withdrawn || (kickHeld && snareClimbing);
	};

	// Earlier builds need internal rise; being loud relative to neighbours does not establish a climb.
	const risesWithin = (p: number): boolean => {
		const s = segments[p];
		const mid = (s.startBar + s.endBar) >> 1;
		if (mid <= s.startBar || s.endBar - s.startBar < 2) return false;
		const airRise =
			meanBand(bandsN, mid, s.endBar, 3) >
			meanBand(bandsN, s.startBar, mid, 3) * label.riseRatio;
		let snFirst = 0;
		let snSecond = 0;
		for (let b = s.startBar; b < mid; b++) snFirst += snaresPerBar[b];
		for (let b = mid; b < Math.min(s.endBar, snaresPerBar.length); b++) snSecond += snaresPerBar[b];
		const snareRise = audible && snSecond > snFirst * BUILD_SNARE_RISE && snSecond > 0;
		return airRise || snareRise;
	};

	for (let i = 1; i < segments.length; i++) {
		if (segments[i].kind !== 'drop') continue;
		// Walk past a void to find the build that sets up its drop.
		let p = i - 1;
		while (p > 0 && segments[p].kind === 'void') p--;

		// Walked back rather than tested once. A segmenter that split a riser in two leaves
		// only its second half touching the drop, and stopping at the first segment calls the
		// rest of the climb a groove. Bounded in bars, so the walk cannot swallow the verse.
		let bars = 0;
		let walked = 0;
		while (p >= 0) {
			const prev = segments[p];
			if (prev.kind === 'drop' || prev.kind === 'void' || prev.kind === 'build') break;
			// Only a breakdown touching the drop can be a kit-free riser; earlier rests remain rests.
			if (label.breakOnBreakdown && prev.kind === 'breakdown' && walked > 0) break;
			bars += prev.endBar - prev.startBar;
			if (bars > label.maxBuildBars) break;
			if (!looksLikeBuild(p, i)) break;
			if (label.riseBeyondFirst && walked > 0 && !risesWithin(p)) break;
			prev.kind = 'build';
			p--;
			walked++;
		}
	}

	const midEnergy = median(segEnergy);
	if (segments[0].kind !== 'void' && segEnergy[0] < midEnergy) segments[0].kind = 'intro';
	const last = segments.length - 1;
	if (endsTheRecord && last > 0 && segments[last].kind !== 'void' && segEnergy[last] < midEnergy) {
		segments[last].kind = 'outro';
	}

	const anchor = fitAnchor(segments.map((s) => s.startBar), count);
	snapToPhrases(segments, count, anchor, pinned, new Set(movements));

	// Carve breaths only before drops, after bar 16, with a seconds cap so slow bars cannot
	// produce fault-like blackouts.
	const floorMedian = median(bars.floor);
	const voidCeiling = median(bars.rms) * VOID_RATIO;
	const MAX_VOID_SECONDS = 2.6;
	for (let i = 1; i < segments.length; i++) {
		if (segments[i].kind !== 'drop') continue;
		if (segments[i].startBar < 16) continue;
		const prev = segments[i - 1];
		if (prev.kind === 'void' || prev.endBar - prev.startBar < 3) continue;
		let voidBars = 0;
		while (
			voidBars < MAX_VOID_BARS &&
			prev.endBar - voidBars - 1 > prev.startBar &&
			bars.floor[prev.endBar - voidBars - 1] < floorMedian * 0.3 &&
			bars.rms[prev.endBar - voidBars - 1] < voidCeiling &&
			bars.time[prev.endBar] - bars.time[prev.endBar - voidBars - 1] <= MAX_VOID_SECONDS
		) {
			voidBars++;
		}
		if (voidBars === 0) continue;
		const start = prev.endBar - voidBars;
		prev.endBar = start;
		// A void is carved out rather than detected, so it belongs to no group and can only
		// ever merge with another void.
		segments.splice(i, 0, { startBar: start, endBar: start + voidBars, kind: 'void', group: -1 });
		i++;
	}

	if (endsTheRecord) carveRingOut(segments, energy, kicksPerBar, count);

	// Final silence is outro. Relabel after phrase snapping to preserve the measured void edges.
	const tail = segments[segments.length - 1];
	if (tail?.kind === 'void') tail.kind = 'outro';

	placeEvents(segments, bandsN, kicksPerBar, snaresPerBar, count, events);

	return { segments, energy, energyGlobal, bands: bandsN, events, phraseAnchorBar: anchor };
}

/**
 * Arrange each movement against its own levels, kit, and positions. Preserve whole-file energy
 * for the cross-movement peak ranking.
 */
export function arrangeMovements(
	bandsDb: Float32Array,
	bars: BarFeatures,
	bounds: readonly number[],
	groups: SegmentGroup,
	shortTerm: Float32Array,
	shortTermFps: number,
	kicksPerBar: Int32Array,
	snaresPerBar: Int32Array,
	pinned: ReadonlySet<number>,
	label: LabelTuning,
	clubFamily: boolean,
	movements: readonly number[]
): Arrangement {
	const count = bars.count;
	const starts = spansFor(movements, count);
	if (starts.length <= 2) {
		return arrange(bandsDb, bars, bounds, groups, shortTerm, shortTermFps, kicksPerBar, snaresPerBar, pinned, label, clubFamily, movements);
	}
	const whole = levelEnvelopes(bandsDb, shortTerm, shortTermFps, bars.time, count, movements);
	const segments: Segment[] = [];
	const energy = new Float32Array(count);
	const bands = new Float32Array(count * NUM_BANDS);
	const events: EventTag[][] = [];
	let phraseAnchorBar = 0;
	for (let k = 0; k + 1 < starts.length; k++) {
		const from = starts[k];
		const to = starts[k + 1];
		const local: number[] = [0];
		const localGroups: SegmentGroup = { repeatOf: [], group: [] };
		for (let i = 0; i + 1 < bounds.length; i++) {
			if (bounds[i] < from || bounds[i] >= to) continue;
			if (bounds[i] > from) local.push(bounds[i] - from);
			localGroups.group.push(groups.group[i]);
			localGroups.repeatOf.push(groups.repeatOf[i]);
		}
		local.push(to - from);
		const localPinned = new Set([...pinned].filter((b) => b > from && b < to).map((b) => b - from));
		const part = arrange(
			bandsDb.subarray(from * NUM_BANDS, to * NUM_BANDS),
			sliceBars(bars, from, to),
			local,
			localGroups,
			shortTerm,
			shortTermFps,
			kicksPerBar.subarray(from, to),
			snaresPerBar.subarray(from, to),
			localPinned,
			label,
			clubFamily,
			[],
			k + 2 === starts.length
		);
		for (const seg of part.segments) {
			segments.push({ ...seg, startBar: seg.startBar + from, endBar: seg.endBar + from });
		}
		energy.set(part.energy, from);
		bands.set(part.bands, from * NUM_BANDS);
		events.push(...part.events);
		if (k === 0) phraseAnchorBar = part.phraseAnchorBar;
	}
	return { segments, energy, energyGlobal: whole.energyGlobal, bands, events, phraseAnchorBar };
}

/** Re-place events after labels or boundaries move; sectionBase gives chorus/drop identical timing. */
export function placeEvents(
	segments: readonly Segment[],
	bandsN: Float32Array,
	kicksPerBar: Int32Array,
	snaresPerBar: Int32Array,
	count: number,
	into?: EventTag[][]
): EventTag[][] {
	const events = into ?? Array.from({ length: count }, (): EventTag[] => []);
	for (const row of events) row.length = 0;

	const air = (b: number) => bandsN[b * NUM_BANDS + 3];
	const sub = (b: number) => bandsN[b * NUM_BANDS];

	for (const s of segments) {
		if (sectionBase(s.kind) === 'drop') {
			events[s.startBar].push('drop_downbeat');
			if (air(s.startBar) > 0.62) events[s.startBar].push('crash');
		}
		if (s.kind === 'void') {
			for (let b = s.startBar; b < s.endBar; b++) events[b].push('silence');
		}
		if (s.kind === 'build') {
			const base = meanBand(bandsN, Math.max(0, s.startBar - 8), s.startBar, 3);
			for (let b = s.startBar; b < s.endBar; b++) {
				if (air(b) > base * 1.05) events[b].push('riser');
				if (b > 0 && snaresPerBar[b] > Math.max(2, snaresPerBar[b - 1] * 2)) {
					events[b].push('snare_roll');
				}
			}
		}
	}

	for (let b = 1; b < count; b++) {
		// Detect crashes independently of section labels so the event records audible cymbals.
		if (air(b) > 0.62 && air(b) - air(b - 1) > 0.25 && !events[b].includes('crash')) {
			events[b].push('crash');
		}
		if (kicksPerBar[b] > 0 && kicksPerBar[b - 1] === 0) events[b].push('kick_in');
		if (kicksPerBar[b] === 0 && kicksPerBar[b - 1] > 0) events[b].push('kick_out');
		if (sub(b) > 0.45 && sub(b - 1) < 0.2) events[b].push('bass_in');
		if (sub(b) < 0.2 && sub(b - 1) > 0.45) events[b].push('bass_out');

		// A sweep is brightness climbing for several bars while the bottom stays put, which is
		// what a filter opening sounds like and what a crescendo does not.
		if (b >= 4) {
			let rising = true;
			for (let k = b - 3; k <= b; k++) if (air(k) <= air(k - 1)) rising = false;
			if (rising && air(b) - air(b - 4) > 0.25 && Math.abs(sub(b) - sub(b - 4)) < 0.15) {
				events[b].push('filter_sweep');
			}
		}
	}
	return events;
}

/**
 * Carve at most four kickless, collapsed tail bars into an outro after phrase snapping.
 * The DP rarely splits a short ring-out, but holding its drop stack would pound through the decay.
 */
export function carveRingOut(
	segments: Segment[],
	energy: Float32Array,
	kicksPerBar: Int32Array,
	count: number
): void {
	const last = segments[segments.length - 1];
	if (!last) return;
	const base = sectionBase(last.kind);
	if (base !== 'drop' && base !== 'groove') return;
	const len = last.endBar - last.startBar;
	if (len < 4) return;

	// The section's own body, read off its first half so the tail being judged cannot
	// dilute the reference it is judged against.
	const body = mean(energy, last.startBar, last.startBar + Math.max(2, len >> 1));
	let carve = 0;
	while (carve < 4 && last.endBar - carve - 1 >= last.startBar + 2) {
		const b = last.endBar - carve - 1;
		if (kicksPerBar[b] > 0) break;
		if (energy[b] > body * 0.6) break;
		carve++;
	}
	if (carve === 0) return;

	const start = last.endBar - carve;
	last.endBar = start;
	// Carved rather than detected, so it belongs to no group - the same contract a void has.
	segments.push({ startBar: start, endBar: count, kind: 'outro', group: -1 });
}

function meanBand(bandsN: Float32Array, from: number, to: number, band: number): number {
	const lo = Math.max(0, from);
	const hi = Math.min(bandsN.length / NUM_BANDS, to);
	if (hi <= lo) return 0;
	let acc = 0;
	for (let b = lo; b < hi; b++) acc += bandsN[b * NUM_BANDS + band];
	return acc / (hi - lo);
}

/** Fit the 4-bar phase first, then use the 8-bar phase to resolve its two possible phrase anchors. */
function fitAnchor(starts: readonly number[], barCount: number): number {
	const inside = starts.filter((b) => b > 0 && b < barCount);
	let best = 0;
	let bestScore = -1;
	for (let anchor = 0; anchor < BARS_PER_PHRASE; anchor++) {
		let quarter = 0;
		let whole = 0;
		for (const b of inside) {
			if (!onPhraseGrid(b, anchor)) continue;
			quarter++;
			if ((((b - anchor) % BARS_PER_PHRASE) + BARS_PER_PHRASE) % BARS_PER_PHRASE === 0) whole++;
		}
		const score = quarter * (inside.length + 1) + whole;
		if (score > bestScore) {
			bestScore = score;
			best = anchor;
		}
	}
	return best;
}

/** Limit phrase snaps to one bar: a two-bar move can erase a correct arrival rather than fix rounding. */
const MAX_SNAP_BARS = 1;

/** Snap nearby changes to phrase lines and fold sections below the linter's two-bar minimum. */
export function snapToPhrases(
	segments: Segment[],
	barCount: number,
	anchor: number,
	pinned: ReadonlySet<number>,
	/** Seams that are never merged away, whatever the material says: movement starts. */
	keep: ReadonlySet<number> = new Set()
): void {
	for (let i = 1; i < segments.length; i++) {
		// A void's edges are where the sound stopped and started, which is a measurement rather
		// than a rounding: moving one by a bar either lights a silent bar or blacks out a played
		// one, and both are visible in the room.
		if (segments[i].kind === 'void' || segments[i - 1].kind === 'void') continue;
		// A pinned boundary sits on a measured arrival - the bar the kit came back, the bar the
		// sub slammed - and dragging it onto a majority-fitted grid is exactly how a drop came
		// to land a bar late on a track whose phrase phase moves mid-song.
		if (pinned.has(segments[i].startBar)) continue;
		const from = segments[i].startBar;
		const target = Math.max(1, Math.min(barCount - 1, nearestPhraseBar(from, anchor)));
		if (Math.abs(target - from) > MAX_SNAP_BARS) continue;
		segments[i].startBar = target;
		segments[i - 1].endBar = target;
	}
	segments[0].startBar = 0;
	segments[segments.length - 1].endBar = barCount;

	// Anything the snapping emptied out, or that never had two bars to begin with, is folded
	// into whichever neighbour is better evidenced, which is the longer one.
	for (let i = segments.length - 1; i >= 0; i--) {
		const len = segments[i].endBar - segments[i].startBar;
		// One bar of nothing is a legitimate void; one bar of anything else is a rounding artefact.
		if (len >= 2 || segments[i].kind === 'void' || segments.length === 1) continue;
		const prev = segments[i - 1];
		const next = segments[i + 1];
		// Do not fold forward across a pinned arrival unless the previous neighbour is a void: growing
		// a void over played audio is worse than moving the pin.
		if (next && prev && prev.kind !== 'void' && pinned.has(next.startBar)) {
			prev.endBar = segments[i].endBar;
		} else if (next && (!prev || next.endBar - next.startBar >= prev.endBar - prev.startBar)) {
			next.startBar = segments[i].startBar;
		} else if (prev) {
			prev.endBar = segments[i].endBar;
		} else {
			continue;
		}
		segments.splice(i, 1);
	}

	// Merge only matching material and kind; a small lighting vocabulary cannot establish identity.
	for (let i = segments.length - 1; i > 0; i--) {
		if (segments[i].kind !== segments[i - 1].kind) continue;
		if (segments[i].group !== segments[i - 1].group) continue;
		// Never merge across movement starts or pinned arrivals, even when material matches.
		if (keep.has(segments[i].startBar) || pinned.has(segments[i].startBar)) continue;

		// Early merges only reunite repeat-group halves under the cap. Final consolidation has
		// arrival/material evidence needed to admit longer sections.
		if (segments[i].endBar - segments[i - 1].startBar > MAX_MERGED_BARS) continue;
		segments[i - 1].endBar = segments[i].endBar;
		segments.splice(i, 1);
	}

	segments[0].startBar = 0;
	segments[segments.length - 1].endBar = barCount;
}
