import {
	ANALYSIS_VERSION,
	BARS_PER_PHRASE,
	NUM_BANDS,
	type BarRow,
	type Moment,
	type MovementSpan,
	type OnsetStream,
	type SectionKind,
	type SectionSpan,
	type TrackAnalysis,
	type TrackContext
} from '@mv/core';
import {
	DEFAULT_LABEL_TUNING,
	arrangeMovements,
	bandLevels,
	levelEnvelopes,
	placeEvents,
	type LabelTuning
} from './arrange.ts';
import { spectrumTrack } from './spectrum.ts';
import { levelTrack } from './level.ts';
import { detectBeats, type BeatGrid } from './beats.ts';
import { beatSynchronous } from './beatsync.ts';
import { chromagram, estimateKey, estimateKeySpan } from './chroma.ts';
import {
	detectDrums,
	dropUnconfirmed,
	gateByEvidence,
	mergeStreams,
	modelDeafToHats,
	withModelPeakFrames,
	snapTimesToOnsets,
	type DrumStream
} from './drums.ts';
import { extractFeatures } from './features.ts';
import { detectSeparatedDrums, mergeSeparatedSnare, type SeparatedDrumAudio } from './separatedDrums.ts';
import { detectMeter, type Meter } from './downbeats.ts';
import { barStartsAtCuts, deriveGridCuts, resyncedCuts } from './gridedits.ts';
import { acceptedRestarts, barLinesFrom, openingRun, phaseRuns, phaseSegments, type PhaseRun } from './downbeatPhase.ts';
import { handMapFingerprint, handSectionBars, type HandSection } from './handSections.ts';
import { judgeSeams, proposeSeams, repairGrid, witnessBarLines } from './movements.ts';
import { applyHeadLabels, type SectionPosteriors } from './headLabels.ts';
import { assessMetricalLevel } from './metricalLevel.ts';
import { measureLoudness } from './loudness.ts';
import { barGroups, quantiseOnsets } from './quantise.ts';
import { mergeKickEvidence } from './kickEvidence.ts';
import { analyseStereo } from './stereo.ts';
import { consolidateSections } from './consolidate.ts';
import {
	DEFAULT_TUNING,
	arrivalComponents,
	arrivalStrengths,
	fillBars,
	offGridMoveGuard,
	pullOntoReturn,
	pushOntoDeparture,
	splitAtArrivals,
	barSynchronous,
	barSynchronousAt,
	groupSegments,
	refineBoundaries,
	rephaseToPins,
	segmentMovements,
	settlingContrast,
	similarityMatrix,
	type BoundaryMove,
	type GuardDecision,
	type StructureTuning
} from './structure.ts';
import {
	chorusSpansFromLyrics,
	demoteVersesFromLyrics,
	hookBars,
	hookStarts,
	isClubFamily,
	loudKickRate,
	promoteChorusesFromLyrics,
	snapToHooks,
	speaksClub,
	splitAtHooks,
	sungPhaseShift,
	toSongVocabulary
} from './vocabulary.ts';

interface AnalyzeInput {
	mono: Float32Array;
	/** Both channels, when the caller has them. Without these there is no stereo image. */
	left?: Float32Array;
	right?: Float32Array;
	sampleRate: number;
	duration: number;
	/** Of the decoded audio, so a show can be pinned to the exact bytes it was written for. */
	hash: string;
	trackId: string;
	title: string;
	/** Constrain the tempo search to within 6% of a known value. */
	bpmHint?: number;
	/** Metrical multiplier for either tracker: 2 doubles tempo, 0.5 halves it, 1.5 reads three for two. */
	metricalLevel?: number;
	/** External beat/downbeat times, seconds. Supplied by an async caller; absent uses the DSP tracker. */
	beats?: readonly number[];
	downbeats?: readonly number[];
	/**
	 * Optional model drum streams; absent uses band-flux DSP. Broadband onsets place model hits.
	 * Cymbals join the hat stream as timekeeping; evidence recorded before them has none.
	 */
	drums?: {
		kick: DrumStream;
		snare: DrumStream;
		hat: DrumStream;
		cymbal?: DrumStream;
		snareClicks?: number[];
	};
	/** Optional individual drum sources, resampled to 22050 Hz after two-stage separation. */
	separatedDrums?: SeparatedDrumAudio;
	/** Optional genre family and synced lyrics for section vocabulary and chorus location. */
	context?: TrackContext;
	/** False prevents recursive compound-meter correction after the octave guard fires. */
	octaveGuard?: boolean;
	/** Bench-only structure tuning; shipping callers use the measured defaults. */
	tuning?: StructureTuning;
	/** Labelling-stage dials, same contract as `tuning`. */
	labels?: LabelTuning;
	/** Bench-only phase restart cost. Infinity holds one phase for the whole track. */
	phaseResetCost?: number;
	/**
	 * Optional learned labels replace rules and lyric promotion/demotion. Boundaries, carves,
	 * hook snaps, and the settled-bars gate still apply.
	 */
	sectionPosteriors?: SectionPosteriors;
	/** Listener grid cuts, seconds. Each becomes a short bar ending at the cut. */
	gridCuts?: readonly number[];
	/**
	 * Hand-map internal boundaries, seconds; derive cuts from uniform-grid residues. Explicit
	 * gridCuts take precedence.
	 */
	sectionMapBoundaries?: readonly number[];
	/** Hand-drawn boundaries and kinds, adopted after snapping to the grid. */
	handSections?: readonly HandSection[];
	/**
	 * Listener-marked song starts, seconds; override nearby detections. Each starts a new grid phase,
	 * protected section boundary, and energy-normalisation span.
	 */
	movements?: readonly number[];
	/** Seconds near which the listener refused a detected movement, so it stays refused. */
	movementVetoes?: readonly number[];
	/** Bench-only output sink; analysis never reads it. */
	probe?: {
		arrivals?: Float32Array;
		physical?: Float32Array;
		kicks?: Int32Array;
		settle?: Float32Array | null;
		/** The arrival score taken apart per bar, in the units it sums them in. */
		components?: { step: Float32Array; kit: Float32Array; dip: Float32Array; novelty: Float32Array; voice: Float32Array };
		/** Bars that read as drum fills. */
		fills?: Uint8Array;
		/** The anacrusis guard's verdict on every refine move it was asked about. */
		guard?: GuardDecision[];
		/** The boundary table after each pass that can move one, in order. */
		stages?: { name: string; bounds: number[] }[];
		/** The downbeat phase walk's runs and the restarts the grid took, as beat indices. */
		phase?: { runs: PhaseRun[]; cuts: number[]; opening: number };
		drums?: {
			dsp: { kick: DrumStream; snare: DrumStream; hat: DrumStream };
			detected: { kick: DrumStream; snare: DrumStream; hat: DrumStream };
			quantiseOptions: Parameters<typeof quantiseOnsets>[1];
			final: { kick: ReturnType<typeof quantiseOnsets>; snare: ReturnType<typeof quantiseOnsets>; hat: ReturnType<typeof quantiseOnsets> };
		};
	};
}

/** Pattern-completion floors per class; see quantiseOptions. */
const KICK_PROMOTE_FLOOR = 0.4;
const SNARE_DEMOTE_FLOOR = 0.9;
/**
 * A model hat needs some flux in the DSP hat band within this window: a sidechain swell
 * raises the class without a transient. Cymbals then join as timekeeping.
 */
const HAT_EVIDENCE_S = 0.03;
const HAT_EVIDENCE_FLOOR = 0.05;
const CYMBAL_MERGE_S = 0.03;
/**
 * A snare the model half-hears under a hat click stays only with this much DSP snare-band
 * flux: a count-in click reads about 0.2 there, a clap under an open hat 0.3 and above.
 */
const CLICK_SNARE_EVIDENCE = 0.3;

/** A detection within this of a mark defers to the mark; within this of a veto it is refused. */
const MARK_REACH_S = 8;
const VETO_REACH_S = 5;

const TARGET_LUFS = -14;
/** What a silent track reports rather than negative infinity, which is not JSON. */
const SILENCE_LUFS = -70;

export function analyzeTrack(input: AnalyzeInput): TrackAnalysis {
	const { sampleRate, duration } = input;

	// Loudness is measured on the mono stream that is actually analysed. Measuring the stereo
	// original instead, which is what asking ffmpeg would give, is up to 3 dB out depending on
	// how correlated the channels are.
	const loudness = measureLoudness(input.mono, sampleRate);

	// Normalise first so detector thresholds transfer across mastering levels.
	const mono = Float32Array.from(input.mono);
	const gain = Math.pow(10, (TARGET_LUFS - loudness.integrated) / 20);
	if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
		const g = Math.min(gain, 40);
		for (let i = 0; i < mono.length; i++) mono[i] *= g;
	}

	const stereo =
		input.left && input.right
			? analyseStereo(input.left, input.right, sampleRate)
			: { fps: 25, pan: new Float32Array(0), width: new Float32Array(0) };

	const features = extractFeatures(mono, sampleRate);
	const chroma = chromagram(mono, sampleRate);
	let grid =
		input.beats && input.beats.length > 8
			? gridFromBeats(input.beats, features.odf, features.curves.fps)
			: detectBeats(features.odf, features.curves.fps, duration, { bpmHint: input.bpmHint });

	if (input.metricalLevel && Math.abs(input.metricalLevel - 1) > 1e-6) {
		relevel(grid, input.metricalLevel);
	}

	// Repair level flips and beatless stretches before building bars; retain repair evidence for seams.
	const repair = repairGrid(grid.beats, input.downbeats ?? []);
	if (repair.repairedSeconds > 0) {
		grid = gridFromBeats(Array.from(repair.beats), features.odf, features.curves.fps);
	}
	const downbeats = repair.downbeats;

	const beatFeatures = beatSynchronous(
		features.spec,
		chroma,
		features.curves,
		features.odf,
		grid.beats,
		duration
	);
	// Prefer model downbeats when available; use DSP meter as fallback.
	const meter =
		(downbeats.length > 2 ? meterFromDownbeats(grid.beats, downbeats) : null) ??
		detectMeter(beatFeatures);

	// Uncorrected 3-beat meter above 130 bpm may be compound time counted in eighths. Re-read
	// once at the dotted-quarter pulse unless a listener or published tempo already set the level.
	if (
		(input.octaveGuard ?? true) &&
		input.metricalLevel === undefined &&
		meter.beatsPerBar === 3 &&
		grid.bpm >= 130
	) {
		return analyzeTrack({ ...input, metricalLevel: 1 / 3, octaveGuard: false });
	}
	// Listener cuts absorb inserted beats as short bars. Broadband onset votes cannot establish
	// half-bar changes because the backbeat is symmetric under that shift.
	let barPhase = meter.phase;

	let bars = null as ReturnType<typeof barSynchronous> | null;
	const beatAt = (t: number): number => {
		let best = 0;
		for (let i = 1; i < grid.beats.length; i++) {
			if (Math.abs(grid.beats[i] - t) < Math.abs(grid.beats[best] - t)) best = i;
		}
		return best;
	};
	const mapCuts =
		input.gridCuts && input.gridCuts.length > 0
			? input.gridCuts.map(beatAt)
			: input.sectionMapBoundaries && input.sectionMapBoundaries.length > 0
				? deriveGridCuts(
						input.sectionMapBoundaries,
						grid.beats,
						meter.beatsPerBar,
						barPhase
					).map(beatAt)
				: [];
	// Movement marks identify a bar, not its exact beat: reaction lag makes sub-bar timing unreliable.
	// Use nearby model downbeat restarts for the beat, and retain the new phase after the switch.
	// Automatic seams use material measured on the phase-walk grid; nearby marks win and vetoes refuse.
	const marks = (input.movements ?? []).filter((t) => Number.isFinite(t) && t > 0 && t < duration);
	const vetoes = input.movementVetoes ?? [];
	const witness = barSynchronousAt(beatFeatures, witnessBarLines(grid.beats, downbeats, meter.beatsPerBar));
	const found = judgeSeams(
		proposeSeams(repair, meter.beatsPerBar, duration),
		{ bars: witness, sim: similarityMatrix(witness), chroma },
		duration
	).filter(
		(m) => !marks.some((t) => Math.abs(t - m.t) < MARK_REACH_S) && !vetoes.some((t) => Math.abs(t - m.t) < VETO_REACH_S)
	);
	const movementTimes: { t: number; source: 'auto' | 'mark'; note: string; exact: boolean }[] = [
		...marks.map((t) => ({ t, source: 'mark' as const, note: '', exact: false })),
		...found
	].sort((a, b) => a.t - b.t);

	const phasing =
		downbeats.length > 2
			? phaseSegments(grid.beats, downbeats, meter.beatsPerBar, input.phaseResetCost)
			: null;
	const runs = phasing ? phaseRuns(phasing, grid.beats, downbeats, meter.beatsPerBar) : [];
	if (phasing && movementTimes.length > 0) {
		// Anchor a medley's first song on its first steady phase run; spoken intros may hallucinate downbeats.
		const firstSong = repair.songs.find((song) => song.seconds >= 20 && song.steady >= 0.7);
		const at = firstSong ? firstSong.fromBeat + Math.floor((firstSong.toBeat - firstSong.fromBeat) / 2) : 0;
		const covering = [...phasing].reverse().find((seg) => seg.startBeat <= at) ?? phasing[0];
		barPhase = covering.phase;
	} else if (runs.length > 0) {
		// Use the first supported phase run so a track's later modal phase cannot displace its opening.
		barPhase = openingRun(runs)?.phase ?? barPhase;
	}
	const phaseLines = phasing
		? barLinesFrom(phasing, grid.beats.length, meter.beatsPerBar)
		: [];
	const movementCuts = movementTimes.flatMap(({ t, exact }) => {
		const mark = beatAt(t);
		if (exact) {
			// After a repaired pause, a nearby incoming downbeat starts the song. Absorb preceding pickup
			// beats as a short bar rather than inheriting an early phase.
			const line = phaseLines.find((b) => b > mark && b - mark < meter.beatsPerBar);
			return line !== undefined && !phaseLines.includes(mark) ? [mark, line] : [mark];
		}
		const inReach = phaseLines.filter((b) => Math.abs(b - mark) <= meter.beatsPerBar);
		if (inReach.length === 0) return [mark];
		return [inReach.reduce((best, b) => (Math.abs(b - mark) < Math.abs(best - mark) ? b : best))];
	});
	// Accept supported within-song phase restarts unless a hand map already defines grid cuts.
	const walkCuts = input.handSections ? [] : acceptedRestarts(runs, meter.beatsPerBar, movementCuts);
	if (input.probe) input.probe.phase = { runs, cuts: walkCuts, opening: barPhase };
	const drawn = (input.handSections ?? []).slice(1);
	const cuts = resyncedCuts(
		[...mapCuts, ...movementCuts, ...walkCuts],
		drawn.filter((s) => s.offGrid).map((s) => beatAt(s.startTime)),
		drawn.map((s) => beatAt(s.startTime)),
		grid.beats.length,
		meter.beatsPerBar,
		barPhase
	);
	if (cuts.length > 0) {
		bars = barSynchronousAt(
			beatFeatures,
			barStartsAtCuts(grid.beats.length, meter.beatsPerBar, barPhase, cuts)
		);
	}
	bars ??= barSynchronous(beatFeatures, meter.beatsPerBar, barPhase);

	// Detect drums before refining boundaries; quantisation waits for repeat groups.
	const dspDrums = detectDrums(features.spec, { beatPeriod: grid.beatPeriod, odf: features.odf });
	const primaryDrums = input.drums
		? {
				kick: snapStream(withModelPeakFrames(input.drums.kick), features.odf, features.curves.fps, grid.beatPeriod),
				snare: snapStream(
					withModelPeakFrames(
						dropUnconfirmed(
							input.drums.snare,
							input.drums.snareClicks ?? [],
							dspDrums.snare,
							HAT_EVIDENCE_S,
							CLICK_SNARE_EVIDENCE
						)
					),
					features.odf,
					features.curves.fps,
					grid.beatPeriod
				),
				hat: snapStream(
					hatStream(input.drums, dspDrums.hat, grid.beats.length),
					features.odf,
					features.curves.fps,
					grid.beatPeriod
				)
			}
		: dspDrums;
	const separated = input.separatedDrums
		? detectSeparatedDrums(input.separatedDrums, input.mono, sampleRate, features.odf, features.curves.fps, primaryDrums,
			input.drums ? dspDrums.snare : undefined)
		: undefined;
	// Kick source evidence is merged after pattern correction with independent model support.
	const detected = separated ? { ...primaryDrums, snare: separated.snare } : primaryDrums;
	const rawKicks = countPerBar(detected.kick.times, bars.time, bars.count);

	// Compute lyric coverage before structure so voice entrances can contribute boundary evidence.
	const vocal = new Float64Array(bars.count);
	const lyricLines = input.context?.instrumental ? null : (input.context?.lyrics ?? null);
	if (lyricLines && lyricLines.length > 0) {
		const barAt = (t: number) => {
			let b = 0;
			while (b < bars.count - 1 && bars.time[b + 1] <= t) b++;
			return b;
		};
		for (let i = 0; i < lyricLines.length; i++) {
			const start = lyricLines[i].t;
			// A line carries only its start; it lasts until the next one, capped at a sung
			// phrase's worth so an instrumental gap stays a gap.
			const end = Math.min(lyricLines[i + 1]?.t ?? start + 4, start + 4, duration);
			for (let b = barAt(start); b < bars.count && bars.time[b] < end; b++) {
				const len = bars.time[b + 1] - bars.time[b];
				if (len <= 0) continue;
				const overlap = Math.min(end, bars.time[b + 1]) - Math.max(start, bars.time[b]);
				if (overlap > 0) vocal[b] += overlap / len;
			}
		}
	}

	const hooks =
		lyricLines && lyricLines.length > 0
			? hookBars(lyricLines, duration, bars.time, bars.count)
			: new Uint8Array(bars.count);

	const movementAt = movementTimes
		.map((m) => {
			let best = 0;
			for (let b = 1; b <= bars.count; b++) {
				if (Math.abs(bars.time[b] - m.t) < Math.abs(bars.time[best] - m.t)) best = b;
			}
			return { ...m, bar: best };
		})
		.filter((m) => m.bar > 0 && m.bar < bars.count)
		.sort((a, b) => a.bar - b.bar)
		.filter((m, i, all) => i === 0 || m.bar !== all[i - 1].bar);
	const movementBars = movementAt.map((m) => m.bar);
	const fixed = new Set(movementBars);
	const tuning = input.tuning ?? DEFAULT_TUNING;
	const sim = similarityMatrix(bars);
	const settle = settlingContrast(sim, bars.count);
	const moves: BoundaryMove[] = [];
	const stage = (name: string, bounds: readonly number[]) => input.probe?.stages?.push({ name, bounds: [...bounds] });
	// Segmented song by song: a movement start is a wall the DP segments up to, never a
	// boundary it may weigh, and no arrival may move it.
	const segmented = segmentMovements(sim, bars, movementBars, tuning.lambda);
	stage('dp', segmented);
	const held: number[] = [];
	const rough = refineBoundaries(
		segmented,
		bars,
		rawKicks,
		moves,
		tuning.refineFloor,
		vocal,
		hooks,
		settle,
		tuning.settleWeight,
		tuning.refineReach,
		fixed,
		tuning.refineMargin,
		tuning.settleGate,
		tuning.bassWeight,
		tuning.kitMinKicks,
		tuning.pickupGuard,
		tuning.fillVeto,
		input.probe?.guard,
		held,
		tuning.quietImpactPhysics,
		tuning.straddle
	);
	stage('refined', rough);
	// Only the decisive arrivals earn pin status; a marginal move may correct its own
	// boundary without getting a vote over everyone else's.
	const movePinned = new Set(moves.filter((m) => m.score >= tuning.pinScore).map((m) => m.to));
	stage('pins', [...movePinned]);
	// Pin decisive boundaries even if the segmenter placed them correctly; otherwise phrase
	// snapping could move an unmodified arrival.
	const physical = arrivalStrengths(bars, rawKicks, null, null, settle, tuning.settleWeight, tuning.settleGate, tuning.bassWeight, tuning.kitMinKicks);
	// A decisive arrival inside a long segment is a restatement the segmenter cannot see.
	const roughSplit = splitAtArrivals(rough, physical, tuning.splitAtArrival);
	if (roughSplit.length !== rough.length) rough.splice(0, rough.length, ...roughSplit);
	const pinned = new Set(movePinned);
	for (const b of rough) if (b > 0 && b < bars.count && physical[b] >= tuning.stayPinScore) pinned.add(b);
	// A boundary the guard kept on the grid has an arrival next door, so it pins as a stay
	// does: it votes for no phase, and no merge may read it as a seam nothing arrives on.
	for (const b of held) if (rough.includes(b)) pinned.add(b);
	// Rephase weak boundaries from arrival pins. A hand map replaces this output; repeat groups
	// are still measured against its adopted boundaries.
	const hand = input.handSections
		? handSectionBars(input.handSections, bars.time, bars.count)
		: null;
	// Movement starts are forced, pinned boundaries on the DP path. Prefer exact bar matches
	// from grid cuts, with nearest-bar fallback if mark and grid disagree.
	for (const b of movementBars) pinned.add(b);
	const dpBounds = rephaseToPins(rough, pinned, bars.count, tuning, movePinned);
	// The singer's phrase grid, where the lyrics prove one and the table sits a bar ahead of
	// it. After the pins and the re-phasing, because it overrides stays: a stay pin is decisive
	// about its own bar and says nothing about which bar the owner draws the section on.
	if (tuning.sungPhase && !hand && !isClubFamily(input.context?.genreFamily ?? null)) {
		for (const b of sungPhaseShift(dpBounds, hooks, rawKicks, bars.count, new Set([...movePinned, ...movementBars]))) {
			pinned.add(b);
		}
	}
	stage('sung', dpBounds);
	const bounds =
		hand?.bounds ?? [...new Set([...dpBounds, ...movementBars])].sort((a, b) => a - b);
	const groups = groupSegments(sim, bars.count, bounds, movementBars);
	const barGroup = barGroups(bounds, groups.group, bars.count);

	const quantiseOptions = {
		beats: grid.beats,
		beatsPerBar: meter.beatsPerBar,
		downbeatPhase: barPhase,
		barGroup,
		barTimes: bars.time,
		duration
	};
	// Measured on MDB Drums: kick completion in cohorts under 0.4 is mostly false, snare
	// thinning outside near-certain cohorts mostly removes real ghost notes.
	const legacySnare = quantiseOnsets(primaryDrums.snare, { ...quantiseOptions, demoteFloor: SNARE_DEMOTE_FLOOR });
	const legacyKick = quantiseOnsets(detected.kick, { ...quantiseOptions, promoteFloor: KICK_PROMOTE_FLOOR });
	const drums = {
		kick: input.drums && input.separatedDrums?.sampleRate === sampleRate
			? mergeKickEvidence(legacyKick, dspDrums.kick, input.separatedDrums.kick, input.mono,
				input.drums.kick, sampleRate)
			: legacyKick,
		snare: input.separatedDrums
			? mergeSeparatedSnare(legacySnare, detected.snare, input.separatedDrums, input.mono, sampleRate,
				input.drums ? dspDrums.snare : undefined)
			: legacySnare,
		hat: quantiseOnsets(detected.hat, quantiseOptions)
	};
	if (input.probe) input.probe.drums = { dsp: dspDrums, detected, quantiseOptions, final: drums };
	const kicks = countPerBar(drums.kick.times, bars.time, bars.count);
	const snares = countPerBar(drums.snare.times, bars.time, bars.count);
	const hats = countPerBar(drums.hat.times, bars.time, bars.count);

	const barsDb = bandLevels(features.spec, bars.time, bars.count);
	const plan = arrangeMovements(
		barsDb,
		bars,
		bounds,
		groups,
		loudness.shortTerm,
		loudness.shortTermFps,
		kicks,
		snares,
		pinned,
		input.labels ?? DEFAULT_LABEL_TUNING,
		isClubFamily(input.context?.genreFamily ?? null),
		movementBars
	);
	stage('arranged', plan.segments.map((seg) => seg.startBar));
	/** The movement a bar belongs to, indexing `movementAt` plus one; 0 before any. */
	const movementOf = (bar: number) => movementBars.filter((m) => m <= bar).length;
	/** Bar spans of each movement, [from, to). */
	const movementSpans: [number, number][] = [];
	{
		const edges = [0, ...movementBars, bars.count];
		for (let k = 0; k + 1 < edges.length; k++) movementSpans.push([edges[k], edges[k + 1]]);
	}

	// A mapped track takes its table from the map, here rather than instead of arrange():
	// everything else arrange() measures - the level envelopes, the bands, the phrase anchor -
	// is about the bars, and the bars are untouched by who drew the sections.
	if (hand) {
		plan.segments.length = 0;
		for (let i = 0; i < hand.kinds.length; i++) {
			plan.segments.push({
				startBar: bounds[i],
				endBar: bounds[i + 1],
				kind: hand.kinds[i],
				group: groups.group[i] ?? i
			});
		}
	}

	// Choose vocabulary per movement after labelling; genre selects club/song and lyrics locate hooks.
	// A hand map already supplies both labels and boundaries.
	if (!hand) {
		const spans = input.context?.lyrics?.length ? chorusSpansFromLyrics(input.context.lyrics, duration) : [];
		const barTime = (bar: number) => bars.time[Math.max(0, Math.min(bars.count, bar))];
		for (const [from, to] of movementSpans) {
			const own = plan.segments.filter((s) => s.startBar >= from && s.startBar < to);
			const club = speaksClub(
				input.context?.genreFamily ?? null,
				loudKickRate(kicks.subarray(from, to), plan.energy.subarray(from, to), meter.beatsPerBar)
			);
			if (input.sectionPosteriors) {
				if (!club) toSongVocabulary(own);
				applyHeadLabels(own, input.sectionPosteriors, bars.time, bars.count, club);
			} else if (!club) {
				toSongVocabulary(own);
				if (spans.length > 0) {
					const segEnergy = own.map((s) => {
						let acc = 0;
						for (let b = s.startBar; b < Math.min(s.endBar, bars.count); b++) acc += plan.energy[b];
						return acc / Math.max(1, Math.min(s.endBar, bars.count) - s.startBar);
					});
					promoteChorusesFromLyrics(own, segEnergy, barTime, spans);
					demoteVersesFromLyrics(own, barTime, spans);
				}
			}
		}
	}

	// Place hooks after vocabulary, then regenerate events so each fires in its final section.
	const arrivals = arrivalStrengths(bars, rawKicks, vocal, hooks, settle, tuning.settleWeight, tuning.settleGate, tuning.bassWeight, tuning.kitMinKicks);
	const fills = fillBars(bars);
	if (input.probe) {
		Object.assign(input.probe, {
			arrivals,
			physical,
			kicks,
			settle,
			components: arrivalComponents(bars, rawKicks, vocal, hooks, tuning.kitMinKicks),
			fills
		});
	}
	// Where a sung block starts a phrase or more inside a long chorus or verse, that is a
	// section the material-reading DP could not see; split first, so the snap below reads the
	// finished table.
	const sungStarts = lyricLines && lyricLines.length > 0 ? hookStarts(lyricLines) : [];
	const hookSplits =
		!hand && tuning.hookSplit && sungStarts.length > 0
			? splitAtHooks(plan.segments, sungStarts, bars.time, bars.count)
			: [];
	// The snap's veto reads the physics-only arrivals computed above: the sung evidence is
	// the very thing under adjudication, and with it in the score a hook bar can never read
	// as "nothing arrives here" - which is exactly what a pickup sung over silence is.
	const snapMoves =
		!hand && sungStarts.length > 0
			? snapToHooks(
					plan.segments,
					sungStarts,
					bars.time,
					bars.count,
					2,
					physical,
					fixed,
					tuning.hookSnapReach,
					tuning.hookSnapStrict,
					tuning.pickupGuard ? offGridMoveGuard(bars, rawKicks, tuning.kitMinKicks, tuning.quietImpactPhysics) : undefined
				)
			: [];
	// Consolidate only after every boundary and vocabulary pass. Pins, hook placements, and drawn
	// seams survive even when adjacent sections have the same kind.
	stage('hooks', plan.segments.map((seg) => seg.startBar));
	const rawSectionCount = plan.segments.length;
	const preConsolidation = plan.segments.map((s) => ({ ...s }));
	if (!hand) {
		const drawn = new Set([...movementBars, ...snapMoves.map((m) => m.to), ...hookSplits, ...fixed]);
		const keep = new Set([...pinned, ...drawn]);
		for (const b of pullOntoReturn(plan.segments, arrivals, kicks, tuning.refineFloor, keep)) keep.add(b);
		const lowBand = Float32Array.from({ length: bars.count }, (_, b) => plan.bands[b * NUM_BANDS + 1]);
		for (const b of pushOntoDeparture(plan.segments, kicks, lowBand, plan.energy, drawn, tuning.departFromFill ? fills : null)) keep.add(b);
		stage('pulled', plan.segments.map((seg) => seg.startBar));
		consolidateSections(plan.segments, arrivals, sim, bars.count, tuning.consolidateFloor, plan.energy, keep);
	}
	stage('final', plan.segments.map((seg) => seg.startBar));
	placeEvents(plan.segments, plan.bands, kicks, snares, bars.count, plan.events);

	// Use one timing array for both tempo.barTimes and bars[].t to prevent grid disagreement.
	const barTimes = Array.from(bars.time.subarray(0, bars.count + 1), round3);

	const vocalIn = new Set<number>();
	if (lyricLines && lyricLines.length > 0) {
		let silentBars = 2;
		for (let b = 0; b < bars.count; b++) {
			if (vocal[b] >= 0.05) {
				if (silentBars >= 2) vocalIn.add(b);
				silentBars = 0;
			} else {
				silentBars++;
			}
		}
	}

	// Detect final-chorus modulation against earlier drop-class material with confident keys.
	// Use pre-consolidation spans so a merge across the key change cannot dilute its correlation.
	const keyChangeBars = new Set<number>();
	for (const [from, to] of movementSpans) {
		const dropish = preConsolidation.filter(
			(s) => (s.kind === 'drop' || s.kind === 'chorus') && s.startBar >= from && s.startBar < to
		);
		const last = dropish[dropish.length - 1];
		if (dropish.length >= 2 && last) {
			const earlier = dropish.slice(0, -1);
			const spanKey = (fromBar: number, toBar: number) =>
				estimateKeySpan(chroma, bars.time[fromBar], bars.time[Math.min(toBar, bars.count)]);
			const lastKey = spanKey(last.startBar, last.endBar);
			// Pooled by taking the longest earlier statement: pooling disjoint spans through
			// one correlation would need a stitched chromagram, and the longest member is the
			// best-evidenced single reading of what the material was in.
			const anchor = earlier.reduce((a, b) =>
				b.endBar - b.startBar > a.endBar - a.startBar ? b : a
			);
			const anchorKey = spanKey(anchor.startBar, anchor.endBar);
			const shift = (lastKey.tonic - anchorKey.tonic + 12) % 12;
			if (
				(shift === 1 || shift === 2) &&
				lastKey.confidence >= 0.55 &&
				anchorKey.confidence >= 0.55
			) {
				keyChangeBars.add(last.startBar);
			}
		}
	}

	const barRows: BarRow[] = [];
	for (let b = 0; b < bars.count; b++) {
		const segment = plan.segments.find((s) => b >= s.startBar && b < s.endBar);
		barRows.push({
			bar: b,
			t: barTimes[b],
			section: segment?.kind ?? 'groove',
			energy: pct(plan.energy[b]),
			sub: pct(plan.bands[b * NUM_BANDS]),
			low: pct(plan.bands[b * NUM_BANDS + 1]),
			mid: pct(plan.bands[b * NUM_BANDS + 2]),
			air: pct(plan.bands[b * NUM_BANDS + 3]),
			kicks: kicks[b],
			snares: snares[b],
			hats: hats[b],
			vocal: Math.round(Math.min(1, vocal[b]) * 100) / 100,
			events: [
				...plan.events[b],
				...(vocalIn.has(b) ? (['vocal_in'] as const) : []),
				...(keyChangeBars.has(b) ? (['key_change'] as const) : [])
			]
		});
	}

	// Rank energy across movements on the whole-file scale; independently normalised songs each
	// reach 1.0 and cannot establish the overall peak.
	const sections: SectionSpan[] = plan.segments.map((s, index) => {
		let sum = 0;
		let peak = 0;
		for (let b = s.startBar; b < s.endBar; b++) {
			sum += plan.energyGlobal[b];
			if (plan.energyGlobal[b] > peak) peak = plan.energyGlobal[b];
		}
		const len = Math.max(1, s.endBar - s.startBar);
		return {
			index,
			kind: s.kind,
			startBar: s.startBar,
			endBar: s.endBar,
			startTime: barTimes[s.startBar],
			endTime: barTimes[Math.min(s.endBar, bars.count)],
			lengthBars: len,
			meanEnergy: pct(sum / len),
			peakEnergy: pct(peak),
			energyRank: 0,
			group: s.group,
			// Derived here from the group rather than carried through arrange(), because every
			// fold, merge and void splice shifts the indices and the old stored value silently
			// came to point at a different section.
			repeatOf: null,
			...(movementBars.length > 0 ? { movement: movementOf(s.startBar) } : {})
		};
	});

	const firstOfGroup = new Map<number, number>();
	for (const s of sections) {
		if (s.group < 0) continue;
		const first = firstOfGroup.get(s.group);
		if (first === undefined) firstOfGroup.set(s.group, s.index);
		else s.repeatOf = first;
	}

	// Ranked by mean, not peak: a long mid-energy verse containing one loud bar would
	// otherwise outrank a short chorus that is loud the whole way through.
	[...sections]
		.sort((a, b) => b.meanEnergy - a.meanEnergy || b.peakEnergy - a.peakEnergy)
		.forEach((s, i) => {
			sections[s.index].energyRank = i + 1;
		});

	// Beat envelopes preserve within-bar variance; interpolating bar means also leads audio by half a bar.
	const beatCount = Math.max(0, beatFeatures.count);
	const beatDb = bandLevels(features.spec, beatFeatures.time, beatCount);
	// Normalise beat envelopes within the same movements as bar energy so cue planning and
	// rendering agree on relative level. These span coordinates are beats.
	const movementBeats = movementBars.map((b) => {
		const t = bars.time[b];
		let best = 0;
		for (let i = 1; i < beatCount; i++) {
			if (Math.abs(beatFeatures.time[i] - t) < Math.abs(beatFeatures.time[best] - t)) best = i;
		}
		return best;
	});
	const beat = levelEnvelopes(
		beatDb,
		loudness.shortTerm,
		loudness.shortTermFps,
		beatFeatures.time,
		beatCount,
		movementBeats
	);

	// Assess the final grid so accepted metrical corrections are not offered again.
	const level = assessMetricalLevel(
		Array.from(grid.beats),
		features.odf,
		features.curves.fps
	);

	const key = estimateKey(chroma);

	// One span per song, tiling the bar table. The first song's seam is the track's start.
	const movements: MovementSpan[] | undefined =
		movementBars.length > 0
			? movementSpans.map(([from, to], k) => {
					const startTime = barTimes[from];
					const endTime = barTimes[to];
					const mark = k > 0 ? movementAt[k - 1] : null;
					const spanKey = estimateKeySpan(chroma, startTime, endTime);
					return {
						startBar: from,
						endBar: to,
						startTime,
						endTime,
						bpm: round3(endTime - startTime > 1e-6 ? ((to - from) * meter.beatsPerBar * 60) / (endTime - startTime) : grid.bpm),
						key: { tonic: spanKey.tonic, name: spanKey.name, mode: spanKey.mode, confidence: round2(spanKey.confidence) },
						source: mark?.source ?? 'auto',
						note: mark?.note ?? ''
					};
				})
			: undefined;

	const sectionAt = (t: number): SectionKind => {
		for (const s of sections) if (t >= s.startTime && t < s.endTime) return s.kind;
		return 'groove';
	};
	return {
		version: ANALYSIS_VERSION,
		hash: input.hash,
		trackId: input.trackId,
		title: input.title,
		duration: round3(duration),
		sampleRate,
		tempo: {
			bpm: round3(grid.bpm),
			confidence: round2(grid.confidence),
			// Six decimals, not three. The player multiplies the period by the bar index, so a
			// millisecond of rounding is eighty by the end of a four-minute track, which is a
			// visible desync arriving gradually enough that nothing looks obviously broken.
			firstBeat: round6(grid.firstBeat),
			beatPeriod: round6(grid.beatPeriod),
			beatsPerBar: meter.beatsPerBar,
			downbeatPhase: barPhase,
			phraseAnchorBar: plan.phraseAnchorBar,
			barsPerPhrase: BARS_PER_PHRASE,
			constant: grid.constant,
			meterConfidence: round2(meter.confidence),
			ambiguous: level.ambiguous,
			alternativeBpm: level.alternatives,
			barTimes
		},
		key: {
			tonic: key.tonic,
			name: key.name,
			mode: key.mode,
			confidence: round2(key.confidence)
		},
		bars: barRows,
		sections,
		rawSectionCount,
		// Stamped from the map that was READ, not the table that was adopted: a map too
		// degenerate to adopt has still been seen, and a stamp that only recorded successes
		// would have ingest re-analysing that track on every play, forever.
		handMap: input.handSections ? handMapFingerprint(input.handSections) : undefined,
		movements,
		moments: buildMoments(barRows, sections, movementBars),
		beats: Array.from(grid.beats, round3),
		downbeats: input.downbeats ? downbeats.map(round3) : undefined,
		heard: input.beats && input.downbeats ? { beats: Array.from(input.beats, round3), downbeats: input.downbeats.map(round3) } : undefined,
		envelopes: {
			energy: Array.from(beat.energy, pct),
			bands: Array.from(beat.bands, pct)
		},
		spectrum: spectrumTrack(features.spec, input.duration, sectionAt),
		level: levelTrack(mono, sampleRate, input.duration, sectionAt),
		stereo: {
			fps: round3(stereo.fps),
			pan: Array.from(stereo.pan, round2),
			width: Array.from(stereo.width, round2)
		},
		onsets: {
			kick: roundStream(drums.kick),
			snare: roundStream(drums.snare),
			hat: roundStream(drums.hat)
		},
		integratedLufs: round1(Math.max(loudness.integrated, SILENCE_LUFS)),
		loudnessRange: round1(loudness.range),
		peakToLoudness: round1(Number.isFinite(loudness.peakToLoudness) ? loudness.peakToLoudness : 0)
	};
}

/** Resample in beat-index space to preserve tracker phase at half, double, or 2:3 metrical levels. */
function relevel(grid: BeatGrid, level: number): void {
	const source = grid.beats;
	const last = source.length - 1;
	if (last < 1 || !(level > 0)) return;

	const out: number[] = [];
	for (let k = 0; ; k++) {
		const x = k / level;
		if (x > last) break;
		const i = Math.floor(x);
		const f = x - i;
		out.push(i >= last ? source[last] : source[i] + (source[i + 1] - source[i]) * f);
	}
	if (out.length < 2) return;

	grid.beats = Float64Array.from(out);
	grid.beatPeriod = (out[out.length - 1] - out[0]) / (out.length - 1);
	grid.bpm = grid.beatPeriod > 1e-6 ? 60 / grid.beatPeriod : grid.bpm;
	grid.firstBeat = out[0];
}

/**
 * barTimes remains authoritative even when constant is true. Allow tracked-beat jitter when
 * reporting whether one period describes the track.
 */
function gridFromBeats(beats: readonly number[], odf: Float32Array, fps: number): BeatGrid {
	const times = Float64Array.from(beats);
	const assessment = assessMetricalLevel(beats, odf, fps);
	const period = assessment.bpm > 0 ? 60 / assessment.bpm : 0.5;

	const local: number[] = [];
	for (let i = 0; i + 16 < times.length; i += 16) local.push((60 * 16) / (times[i + 16] - times[i]));
	local.sort((a, b) => a - b);
	const spread =
		local.length >= 4
			? (local[Math.floor(local.length * 0.9)] - local[Math.floor(local.length * 0.1)]) /
				local[local.length >> 1]
			: 0;

	return {
		bpm: assessment.bpm,
		beatPeriod: period,
		firstBeat: times[0] ?? 0,
		beats: times,
		constant: spread <= 0.01,
		// The level is the doubtful part, not the phase, so the assessment is what this reports.
		confidence: assessment.confidence
	};
}

/**
 * Infer meter/phase from modal downbeat spacing. Degenerate spacing after metrical resampling
 * returns null so the caller can use DSP meter evidence.
 */
function meterFromDownbeats(beats: Float64Array, downbeats: readonly number[]): Meter | null {
	const indexOf = (t: number): number => {
		let lo = 0;
		let hi = beats.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (beats[mid] <= t) lo = mid;
			else hi = mid;
		}
		return Math.abs(beats[lo] - t) <= Math.abs(beats[hi] - t) ? lo : hi;
	};

	const indices = downbeats.map(indexOf).sort((a, b) => a - b);
	const gaps = new Map<number, number>();
	for (let i = 1; i < indices.length; i++) {
		const g = indices[i] - indices[i - 1];
		if (g >= 2 && g <= 12) gaps.set(g, (gaps.get(g) ?? 0) + 1);
	}
	let beatsPerBar = 4;
	let best = 0;
	for (const [g, n] of gaps) {
		if (n > best) {
			best = n;
			beatsPerBar = g;
		}
	}
	if (best === 0) return null;
	// Fold 8/6-beat downbeat gaps to 4/3 after metrical correction. Read 2-beat gaps in four: slow
	// records often alternate 2 and 4, and a two-beat bar would halve every authored phrase.
	if (beatsPerBar === 8 || beatsPerBar === 12) beatsPerBar = 4;
	else if (beatsPerBar === 6) beatsPerBar = 3;
	else if (beatsPerBar === 2) beatsPerBar = 4;

	const votes = new Int32Array(beatsPerBar);
	for (const i of indices) votes[((i % beatsPerBar) + beatsPerBar) % beatsPerBar]++;
	let phase = 0;
	for (let p = 1; p < beatsPerBar; p++) if (votes[p] > votes[phase]) phase = p;

	const total = indices.length || 1;
	return { beatsPerBar, phase, confidence: Math.max(0, Math.min(1, votes[phase] / total)) };
}

/**
 * The shipped hat stream: model hats with an air transient, or the DSP hats where the model
 * is deaf to the kit's sampled hats, plus ride and crash strikes either way.
 */
function hatStream(
	drums: NonNullable<AnalyzeInput['drums']>,
	dspHat: DrumStream,
	beats: number
): DrumStream {
	// A ride or crash keeping time counts as the model hearing the top kit.
	const heard = drums.cymbal ? mergeStreams(drums.hat, drums.cymbal, CYMBAL_MERGE_S) : drums.hat;
	const hats = modelDeafToHats(heard, dspHat, beats).deaf
		? dspHat
		: gateByEvidence(drums.hat, dspHat, HAT_EVIDENCE_S, HAT_EVIDENCE_FLOOR);
	return drums.cymbal ? mergeStreams(hats, drums.cymbal, CYMBAL_MERGE_S) : hats;
}

/** Align model hits to broadband onsets, removing the low-band window's timing bias. */
function snapStream(
	stream: DrumStream,
	odf: Float32Array,
	fps: number,
	beatPeriod: number
): DrumStream {
	return {
		...stream,
		times: snapTimesToOnsets(stream.times, odf, fps, Math.min(0.05, beatPeriod / 8))
	};
}

function countPerBar(times: readonly number[], barTime: Float64Array, count: number): Int32Array {
	const out = new Int32Array(count);
	let i = 0;
	for (let b = 0; b < count; b++) {
		const to = barTime[b + 1];
		while (i < times.length && times[i] < barTime[b]) i++;
		let n = 0;
		while (i + n < times.length && times[i + n] < to) n++;
		out[b] = n;
	}
	return out;
}

function buildMoments(rows: BarRow[], sections: SectionSpan[], movementBars: readonly number[] = []): Moment[] {
	const out: Moment[] = [];

	for (const s of sections) {
		out.push({
			bar: s.startBar,
			beat: 0,
			t: s.startTime,
			kind: 'section_start',
			note: `${movementBars.includes(s.startBar) ? 'a new song: ' : ''}${s.kind} begins, ${s.lengthBars} bars, energy ${s.meanEnergy}${
				s.energyRank === 1 ? ', the peak of the track' : ''
			}${s.repeatOf !== null ? `, repeats section ${s.repeatOf}` : ''}`
		});
	}

	// Risers and snare rolls are per-bar colour inside a build, not moments in their own
	// right; listing every one of them buries the handful that are worth a cue.
	for (const row of rows) {
		for (const ev of row.events) {
			if (ev === 'riser' || ev === 'snare_roll') continue;
			out.push({ bar: row.bar, beat: 0, t: row.t, kind: ev, note: describe(ev, row) });
		}
	}

	out.sort((a, b) => a.t - b.t || a.bar - b.bar);
	return out;
}

function describe(ev: string, row: BarRow): string {
	switch (ev) {
		case 'drop_downbeat':
			return `energy ${row.energy}, sub ${row.sub}`;
		case 'silence':
			return 'near-silence: the void before the drop';
		case 'crash':
			return `cymbal crash, air ${row.air}`;
		case 'kick_in':
			return 'the kick arrives';
		case 'kick_out':
			return 'the kick drops out';
		case 'bass_in':
			return 'bass enters';
		case 'bass_out':
			return 'bass withdraws';
		case 'filter_sweep':
			return `brightness opening, air ${row.air}`;
		case 'vocal_in':
			return 'the voice comes in';
		case 'key_change':
			return 'the last chorus lifts a key';
		default:
			return '';
	}
}

function roundStream(stream: { times: number[]; levels: number[] }): OnsetStream {
	return { times: stream.times.map(round3), levels: stream.levels.map(round2) };
}

function pct(v: number): number {
	return Math.round(v * 100);
}

function round6(v: number): number {
	return Math.round(v * 1e6) / 1e6;
}

function round3(v: number): number {
	return Math.round(v * 1000) / 1000;
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

function round1(v: number): number {
	return Math.round(v * 10) / 10;
}
