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
	/**
	 * Which material this is. Segments sharing an id are the same passage of the song.
	 *
	 * Kept separate from `kind` on purpose. `kind` is a lighting instruction drawn from a
	 * seven-value vocabulary, so a verse and a chorus routinely share one; identity is what
	 * says they are different sections, and merging on `kind` alone is what used to fuse
	 * fifteen segments into a single 116-bar groove.
	 */
	group: number;
}

export interface Arrangement {
	segments: Segment[];
	/** count per bar, 0..1, levelled within each movement. */
	energy: Float32Array;
	/**
	 * The same, levelled across the whole file: the one scale every ACROSS-movement comparison
	 * has to be made on. Identical to `energy` unless a movement is marked.
	 */
	energyGlobal: Float32Array;
	/** count * NUM_BANDS per bar, 0..1. */
	bands: Float32Array;
	events: EventTag[][];
	phraseAnchorBar: number;
}

/**
 * Mean band energies over the contract's four bands, in dB, for a run of time spans.
 *
 * Takes a time array rather than the bar table because the same arithmetic serves both
 * granularities: sections are read per bar and the light moves per beat.
 */
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

/**
 * How much is going on in each bar, 0..1 across the track.
 *
 * Weighted toward the bottom end rather than toward broadband level: a noise riser is loud
 * but is not the peak of the track, and a level-only reading lets it outrank the drop it is
 * announcing.
 */
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

/**
 * The bar ranges a level is measured within: one per movement, or the whole track when it is
 * one song like nearly everything is.
 *
 * A movement shorter than two phrases is not given its own span. Normalising against a
 * handful of bars turns their own noise into full scale, and there is no arrangement in
 * eight bars to be levelled against anyway.
 */
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

/**
 * A drop is a sustained lift that something announced. Below this step across a boundary the
 * track is simply going along, and calling its loudest passage a drop would be an invention.
 */
const DROP_STEP = 0.22;
/**
 * And how far below the body of the track a passage has to sit to be a breakdown.
 *
 * A quantile cannot answer this. Calling the bottom 30% of segments a breakdown gave 98% of a
 * 374-track corpus one however flat it was, which is the same mistake `DROP_STEP` exists to
 * stop at the other end: a label that every track has says nothing about any of them.
 */
const BREAKDOWN_STEP = 0.2;
/**
 * How far below the track's median bar the held breath before a drop has to fall.
 *
 * The quietest beat in the bar is what finds it, but that alone promotes a bar with one gap in
 * an otherwise full arrangement, so the bar's own level has to have gone with it.
 */
const VOID_RATIO = 0.35;
/**
 * How much of the kit has to be missing before a passage is a breakdown rather than a thinner
 * groove.
 *
 * The one test that does not go through level at all, which is the point: a filtered breakdown
 * can be as loud as the groove around it and still be the passage where the drums stopped.
 * Measured across 374 tracks, half the bars of a breakdown carry no kick or snare against all
 * of a groove's, so the two are separated by a wide margin here and not at all by energy.
 */
const BREAKDOWN_KIT = 0.62;
/**
 * How far the kit has to come back across a boundary for the track to have drops at all.
 *
 * Yadati et al. (ISMIR 2014) label the drop as the moment the buildup ends and the bassline is
 * re-introduced. That pairing is now the section model's to find - it reads the kick, snare, kit
 * and sub steps across both neighbours as features - and what is left here is the coarser
 * question this constant is actually good at: does this track do that anywhere, ever.
 */
const DROP_KICK_STEP = 0.3;
/**
 * The pounding arm of `hasDrops`, for the club track both step arms are blind to: a
 * wall-to-wall banger has no energy step (Ponyboy's biggest is 0.11 against DROP_STEP's
 * 0.22) and no kick step (0.125 against 0.3), so it composed as grooves end to end and
 * the room read it as "completely lost its energy". Sustained pounding IS the drop
 * culture's signature, so on a club family it counts as having drops and the peak
 * rescue below decides which group is the one. Every inner section must keep at least
 * half the track's own q90 kick bar with the kit present in nearly every bar - measured
 * over the judged 36, no club track that lacks drops today crosses this (the ambient
 * and ballad sentinels sit far under it), and Ponyboy's quietest groove sits exactly at
 * the half. Family-gated because a rock record with constant drums is not thereby
 * festival material, and OFF without metadata - the survivable direction, same call
 * speaksClub makes.
 */
const POUND_KICK = 0.5;
const POUND_KIT = 0.9;
/**
 * How far the kick has to sit below the drop it leads into for the passage to be a build.
 *
 * A build is the one section defined by where it is going rather than by what it contains, and
 * withdrawing the kick under a climbing snare and noise floor is the form that takes. Its
 * measured kick density is a quarter below a groove's while its snare is not.
 */
const BUILD_KICK_RATIO = 0.85;
const BUILD_SNARE_RISE = 1.15;

/**
 * The build walk-back's dials, sweepable by the bench against annotated ground truth the same
 * way `StructureTuning` is. Shipping code never passes them; the defaults ARE the winner of
 * the 2026-08-12 sweep over Harmonix (prechorus) and Raveform (buildup).
 *
 * They exist because the previous rules over-called builds three to one: 17.0% of corpus bars
 * against 6.1% annotated in pop and 9.6% in EDM, with eighty consecutive build-build
 * boundaries. An OR of three weak tests, walking sixteen bars, eating breakdowns on the way,
 * turns most verses before choruses into two-phrase climbs - and a room that is climbing a
 * fifth of the night has no rest left to make the real climbs read.
 */
export interface LabelTuning {
	/** Longest total walk-back, bars. */
	maxBuildBars: number;
	/**
	 * Segments beyond the one touching the drop must also RISE within themselves. The
	 * touching segment keeps the softer test: a one-phrase riser is often flat-loud with the
	 * lift living in its last bar, but a claim that the walk should continue backwards is a
	 * claim the climb was already under way, which is checkable.
	 */
	riseBeyondFirst: boolean;
	/** Second-half air over first-half air that counts as rising within a segment. */
	riseRatio: number;
	/**
	 * The walk stops at a segment already labelled breakdown instead of eating it. The
	 * touching segment is exempt: a riser with the kit out measures as a breakdown and is
	 * still the build when it passes the build test. This is where the EDM deficit lived -
	 * annotated EDM is 29% breakdown and the walk was relabelling the rests before drops.
	 */
	breakOnBreakdown: boolean;
}

/**
 * The 2026-08-12 sweep's verdict (bench/structscore.ts, 60 Harmonix + 60 Raveform):
 * capping the walk at one phrase and refusing to eat breakdowns is worth +2.6 points of
 * seven-way agreement on Harmonix (50.5 -> 53.1) with build share landing on the
 * annotated rate (6.9% vs 5.6%); the within-segment rise test scored the same on pop and
 * cost most of EDM's real builds (Raveform build recall 7.0 -> 1.6), so it stays off.
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
/**
 * How far below the track's own median bar a bar has to sit to count as nothing playing.
 * Thirty dB down, which no arrangement choice reaches and only an actual gap does.
 */
const SILENT_RATIO = 0.03;

/**
 * Band levels and overall energy on a time grid, both 0..1 within each movement.
 *
 * Each band is normalised against its own distribution, so "sub is high" means high for this
 * track's sub rather than high compared with its mids - and on a track that is several songs
 * stitched together, high for THIS song rather than for the loudest of them. Without that, a
 * quiet opening movement reads as one long intro to the loud one after it, and the loud one
 * reads as drop from end to end.
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
		// The same measurement levelled across the whole file. Two movements each levelled
		// against themselves both reach 1.0, so any comparison BETWEEN them is arithmetic on
		// two different scales - and "which passage is the peak of this show" is exactly such
		// a comparison. Identical to `energy` on the single-span track, which is nearly all of
		// them, so nothing without a mark can tell the two apart.
		energyGlobal:
			starts.length === 2
				? energy
				: barEnergy(bandsWhole, count, loudnessOn(shortTerm, shortTermFps, time, count, whole)),
		bands
	};
}

/**
 * What the kit is doing across a segment, each measured against the track's own busiest bars.
 *
 * Within-track rather than absolute, because "the drums are full" means full for THIS track: a
 * drum and bass drop and a folk chorus are each at their own ceiling, and reading one against
 * the other says nothing about either.
 */
interface DrumState {
	kick: number;
	snare: number;
	/** Share of the segment's bars with any of the kit in them at all. */
	kit: number;
}

/**
 * Percussion per segment, and whether there is enough of it to be worth reading.
 *
 * `audible` is the guard that keeps a string quartet out of this entirely: with no kit detected
 * every drum test below is skipped and labelling falls back to the energy it always used. A
 * detector that fires nowhere would otherwise report the whole track as a breakdown.
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
	/**
	 * Whether these bars end where the record does. An outro is the record leaving; a song
	 * that ends because the next one starts ends on whatever it was playing - the owner's
	 * maps put a breakdown before SICKO MODE's second switch and a chorus before Melanz's
	 * first - so the position rule and the ring-out carve are the last song's alone.
	 */
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

	// --- what kind of track is this ------------------------------------------------------
	// Rekordbox picks a label vocabulary per track before labelling anything, and the reason
	// is sound: a ballad has no drop, and a track with a drop has no verse. Deciding first
	// stops the loudest eight bars of a folk song being announced as the drop of the night.
	//
	// The kit gets a vote here too. A track whose drums come back all at once has drops whether
	// or not the master left any level step to see it by, and on this repertoire that is most of
	// them: everything is limited to within a couple of dB of everything else.
	let biggestStep = 0;
	let biggestKickStep = 0;
	for (let i = 1; i < segments.length; i++) {
		biggestStep = Math.max(biggestStep, segEnergyWhole[i] - segEnergyWhole[i - 1]);
		biggestKickStep = Math.max(biggestKickStep, kit[i].kick - kit[i - 1].kick);
	}
	// Both arms behind `audible`, not just the kick one: a drop is a rhythmic impact, and
	// a track the drum detector heard NOTHING in cannot have one however its strings swell
	// - a beatless ambient piece with 18 energy-stepped "drops" was the judged failure.
	// `audible` is the q90-based reading above; a single hallucinated onset stays false.
	const inner = kit.slice(1, Math.max(1, kit.length - 1));
	const pounds =
		clubFamily &&
		inner.length > 0 &&
		inner.every((k) => k.kick >= POUND_KICK && k.kit >= POUND_KIT);
	const hasDrops =
		audible && (biggestStep >= DROP_STEP || biggestKickStep >= DROP_KICK_STEP || pounds);

	const body = median(segEnergy);
	const loudLevel = Math.max(quantile(segEnergy, 0.7), Math.max(...segEnergy) * 0.82);

	// Groove against drop is the one call a fitted model makes better than a threshold, and it is
	// most of every track. Scored against annotated function over 115 Harmonix tracks, five-fold
	// cross-validated BY TRACK, the thresholds this replaces reach F1 47.2 on groove and 53.6 on
	// drop where the model reaches 62.0 and 67.2.
	//
	// It decides that and nothing else, because the rules beat it everywhere they are still used:
	// the build walk-back scores 15.3 F1 against the model's 0.0, since a build is defined by
	// where it is GOING and no summary of what a section contains can see that. Silence and a
	// stopped kit are facts rather than predictions, and intro and outro are positions.
	const features = sectionFeatures({
		energy,
		bands: bandsN,
		kicks: kicksPerBar,
		snares: snaresPerBar,
		segments,
		barCount: count
	});

	// The model's margin per undecided segment, then pooled per repeat group before anything
	// is labelled. Two passages of the same material must not land on opposite sides of zero:
	// that is how the passage the user calls "the first drop" came out groove while its
	// reprise came out drop. Pooling decides the group once, on length-weighted evidence -
	// unlike the deleted repeat-propagation pass, no single member's label is copied anywhere.
	const margin = new Map<number, number>();
	const undecided: number[] = [];
	for (let i = 0; i < segments.length; i++) {
		const e = segEnergy[i];
		if (audible && kit[i].kit < BREAKDOWN_KIT && e < loudLevel) {
			// The kit stopped. Not a level test at all, which is the point: a filtered breakdown
			// sits at the same loudness as the groove around it and the energy quantile that used
			// to decide this cannot see it.
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

		// A loud passage is a drop only when something set it up, and only once the track has had
		// room to establish what it is dropping from. Nothing drops in its first two phrases; a
		// loud passage there is the groove arriving, which is a different thing to light. Both
		// gates stay in front of the model because they are taste rather than accuracy: a ballad
		// has no drop however loud its last chorus is, and a corpus of pop cannot teach that.
		const settled = segments[i].startBar >= 2 * PHRASE_BARS;
		segments[i].kind = z > 0 && hasDrops && settled ? 'drop' : 'groove';
	}

	// The peak of a track that has drops is one of them, unless the model is emphatic that
	// it is not. The pooled margin sits within noise of zero on exactly the biggest garage
	// and festival grooves, so a one-bar boundary shift was flipping the loudest passage of
	// the night between drop and groove from one analysis to the next. A coin toss must not
	// decide the section the whole show is built around.
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

	// --- repeats ---------------------------------------------------------------------------
	// There is deliberately no repeat propagation here any more.
	//
	// It existed to recover the second chorus, which the threshold labeller lost whenever the
	// passage before it was loud enough to erase the step. The section model does not lose it:
	// with the pass still in place `drop` came out 58.7% of frames against an annotated 42.1%
	// and half of all annotated groove was called drop, because one member of a group being
	// called drop dragged every repeat of it across. Removing it moved frame agreement 47.7% to
	// 50.9% and the drop share to 42.8% against that annotated 42.1%.
	//
	// Same shape as the SECTION_FLOOR reduction: a compensation left in place after its cause is
	// fixed is contrast spent for nothing. `SectionSpan.group` still ships, and a show is still
	// free to light every member of a group alike; what no longer happens is the arrangement
	// deciding that for it.

	// A track with dynamics has a peak whether or not the step test caught it.
	if (hasDrops && !segments.some((s) => s.kind === 'drop')) {
		let best = 0;
		for (let i = 1; i < segments.length; i++) if (segEnergyWhole[i] > segEnergyWhole[best]) best = i;
		segments[best].kind = 'drop';
	}

	// --- nothing playing -------------------------------------------------------------------
	// Before anything else reads a neighbour, because an energy quantile has no absolute floor:
	// silence lands in the bottom bucket of every track and comes out labelled breakdown, or
	// outro when it is at the end, and either one gets lit. A void is the only instruction that
	// means "there is nothing here", and it is the only honest label for a gap.
	const silenceFloor = median(bars.rms) * SILENT_RATIO;
	for (const s of segments) {
		let silent = true;
		for (let b = s.startBar; b < s.endBar && silent; b++) silent = bars.rms[b] < silenceFloor;
		if (!silent) continue;
		// Silence at the top of a track is a pickup or a breath before the song, and cutting
		// a room that has not lit yet reads as the app failing to start. The void instruction
		// is for darkness inside an established show.
		if (s.startBar < 16) {
			s.kind = 'intro';
			continue;
		}
		// Carved rather than played, so it belongs to no group and can never be a repeat target.
		s.kind = 'void';
		s.group = -1;
	}

	// --- builds --------------------------------------------------------------------------
	// The one section defined by where it is going rather than by what it contains, so it is
	// read backwards from the drop it points at and nowhere else.
	const looksLikeBuild = (p: number, drop: number): boolean => {
		const prev = segments[p];
		const airBefore = meanBand(bandsN, prev.startBar, prev.endBar, 3);
		const airEarlier = meanBand(bandsN, Math.max(0, prev.startBar - 8), prev.startBar, 3);
		const climbing = airBefore > airEarlier * 1.08;
		const withdrawn = segSub[p] < segSub[drop] * 0.8;
		// What the kit says about the same passage: the kick pulls out under the drop it is
		// leading into while the snare climbs into it, which is the roll every genre uses. Both
		// halves are required, because a segment merely quieter than the drop is most segments.
		const kickHeld = audible && kit[p].kick < kit[drop].kick * BUILD_KICK_RATIO;
		const snareClimbing =
			audible && p > 0 && kit[p].snare > kit[p - 1].snare * BUILD_SNARE_RISE;
		return climbing || withdrawn || (kickHeld && snareClimbing);
	};

	// Rising WITHIN the segment: its own second half over its own first. The soft tests above
	// compare a segment against its surroundings, which any loud verse passes; a claim that
	// the climb was already under way two phrases before the drop is a claim about the
	// segment's own shape, and that is checkable.
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
		// Past a void, because a gap between the build and the drop is the oldest arrangement
		// there is and the build is the passage before it, not the silence.
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
			// The rest before the climb stays a rest. Only the segment touching the drop may
			// be a kit-out riser wearing a breakdown label; further back, a breakdown is the
			// passage the build exists to rise OUT of.
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

	// --- intro and outro -----------------------------------------------------------------
	const midEnergy = median(segEnergy);
	if (segments[0].kind !== 'void' && segEnergy[0] < midEnergy) segments[0].kind = 'intro';
	const last = segments.length - 1;
	if (endsTheRecord && last > 0 && segments[last].kind !== 'void' && segEnergy[last] < midEnergy) {
		segments[last].kind = 'outro';
	}

	// --- phrase grid ---------------------------------------------------------------------
	const anchor = fitAnchor(segments.map((s) => s.startBar), count);
	snapToPhrases(segments, count, anchor, pinned, new Set(movements));

	// --- the void ------------------------------------------------------------------------
	// Carved out of the bar before a drop rather than detected on its own, because that is
	// the only place it means anything: a held breath somewhere else is just a quiet bar.
	// Two vetoes beyond the level tests: nothing before bar 16, because a room that has
	// barely lit has no light worth cutting; and never longer than a breath in SECONDS -
	// two bars at 80 bpm is six seconds of black, which reads as a fault at any tempo the
	// bar count alone cannot see.
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

	// --- the ring-out ----------------------------------------------------------------------
	if (endsTheRecord) carveRingOut(segments, energy, kicksPerBar, count);

	// A void at the END of the track sets up nothing: the void instruction is the held breath
	// before a drop, and silence after the last note is the record being over. Same reasoning
	// as opening silence relabelling to intro, and placed here rather than in the silence pass
	// so the segment keeps a void's protections through the phrase snap - its edges are where
	// the sound stopped, and dragging them lights silence or cuts a played bar.
	const tail = segments[segments.length - 1];
	if (tail?.kind === 'void') tail.kind = 'outro';

	placeEvents(segments, bandsN, kicksPerBar, snaresPerBar, count, events);

	return { segments, energy, energyGlobal, bands: bandsN, events, phraseAnchorBar: anchor };
}

/**
 * The arrangement of a track that is several songs: `arrange` run on each song's bars as a
 * track of its own, and the tables joined.
 *
 * Everything `arrange` decides is relative to the passage it reads - the body level a
 * breakdown sits under, the loudest passage a drop is judged against, the two settling
 * phrases nothing drops in, the intro and outro by position - and on a medley every one of
 * those is a fact about one song, not the file. Only the whole-file energy column survives
 * the join, because "which of these is the peak" is the one question asked across songs.
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

/**
 * Per-bar events from a finished section table, into `into`.
 *
 * Exported so the caller can re-place them after the vocabulary and hook-snap stages move
 * boundaries: an event emitted at a bar a boundary has since left is a cue firing in the
 * wrong section. Reads section kinds through `sectionBase`, so a chorus carries the same
 * downbeat a drop does whichever vocabulary named it.
 */
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
		// A crash is a cymbal, not a section marker. Tagging it only on a drop downbeat meant the
		// tag described the arrangement the labeller had already decided on rather than anything
		// heard, so the one event that says "the track just did something" fired nowhere else.
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
 * A track that ends inside its loudest section still ENDS: the last kick leaves, the level
 * collapses, and the file rings out - and a show that reads the section table alone holds
 * the full drop stack pounding through the decay. The DP rarely splits a two-bar tail off
 * an eight-bar drop (a boundary there costs more than the tail's difference buys), so the
 * outro-by-position rule above never sees one. Carved here instead, the same way the void
 * is: walked back from the last bar while the kick is gone and the level has clearly left
 * the section's own body.
 *
 * Capped at four bars because this is a ring-out, not a structure rewrite: a longer decay
 * is a real outro and the DP's to find. Runs after the phrase snap so the boundary stays
 * where it was measured, exactly like a void's edges.
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

/**
 * The phrase offset that the most section changes already agree with.
 *
 * Searched over a whole phrase but scored on the 4-bar grid first, so the answer is still the
 * best available anchor for the grid the linter holds cues to, and the mod-8 phase is decided
 * by evidence rather than left to whichever half the search happened to reach first. Without
 * the second term only 47% of section starts fired `phraseStart`, against 97% sitting on the
 * 4-bar grid the anchor was fitted to.
 */
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

/**
 * How far a boundary may be dragged to reach the phrase grid.
 *
 * Snapping unconditionally was costing more than it bought. With a four-bar grid the worst
 * move is two bars, which is four seconds at 120 bpm: outside the half-second window the
 * boundary metric calls a hit, and outside the three-second one as well. A boundary that is
 * one bar off the grid is a rounding error worth correcting; one that is two bars off is
 * evidence the grid is wrong there, and moving it destroys a boundary that was right.
 */
const MAX_SNAP_BARS = 1;

/**
 * Pull section changes that are nearly on the phrase grid onto it, and guarantee nothing is
 * shorter than two bars, because the linter rejects an off-phrase cue outright and the
 * sections are what the cues are written against.
 */
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
		// Folding forward moves the next section's start onto the sliver's bars, and when
		// that start is pinned it drags a measured arrival onto bars nothing arrived at -
		// the pin outranks the length heuristic here the way it outranks the grid above.
		// Unless the previous neighbour is a void: growing a void over a played bar blacks
		// out sound in the room, which is worse than a one-bar pin shift.
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

	// Neighbours that are the same material AND carry the same instruction say nothing twice;
	// merge only those. Merging on `kind` alone deleted 47% of the boundaries the segmenter
	// found, because a four-value energy vocabulary makes most neighbours look alike.
	for (let i = segments.length - 1; i > 0; i--) {
		if (segments[i].kind !== segments[i - 1].kind) continue;
		if (segments[i].group !== segments[i - 1].group) continue;
		// Two songs are never one passage saying itself twice, however alike the material
		// measures across the join. Without this the whole movement machinery is inert: the
		// seam was reaching the table and being merged out again one pass later.
		if (keep.has(segments[i].startBar)) continue;


		// And never past this here: this early merge runs before the vocabulary settles, so
		// it only reunites confident repeat-group halves. The consolidation pass at the end
		// of the pipeline is the one allowed to read a longer run as one section, because it
		// weighs seam arrivals and cross-seam material, which do not exist yet at this point.
		if (segments[i].endBar - segments[i - 1].startBar > MAX_MERGED_BARS) continue;
		segments[i - 1].endBar = segments[i].endBar;
		segments.splice(i, 1);
	}

	segments[0].startBar = 0;
	segments[segments.length - 1].endBar = barCount;
}
