import type { SectionKind } from './frame.ts';

export const ANALYSIS_VERSION = 33;

export interface TempoGrid {
	/** Median over the track. For display and for a default time constant, never for timing. */
	bpm: number;
	/** 0..1. How much of the track's onset energy the grid actually lands on. */
	confidence: number;
	/** Time of beat 0, seconds. */
	firstBeat: number;
	/** Median beat period. See `bpm`: this describes the track, it does not locate anything. */
	beatPeriod: number;
	beatsPerBar: number;
	/** Which beat index mod beatsPerBar is the downbeat. */
	downbeatPhase: number;
	phraseAnchorBar: number;
	barsPerPhrase: number;
	/**
	 * False when tempo variation exceeds one-period fit. Descriptive only; barTimes is always
	 * authoritative.
	 */
	constant: boolean;
	/** 0..1, separately from `confidence`: the beat grid can be certain and the meter not. */
	meterConfidence: number;
	/** True when another metrical level is similarly plausible; listener review can settle it. */
	ambiguous: boolean;
	/** Readings a listener might prefer instead, most plausible first. */
	alternativeBpm: number[];
	/**
	 * Authoritative bar start times in seconds plus the final end, length barCount + 1.
	 * bars[].t is derived from this array so the two cannot drift.
	 */
	barTimes: number[];
}

export interface KeyEstimate {
	/** Pitch class of the tonic, 0 = C. */
	tonic: number;
	/** Human-readable, e.g. "F# minor". */
	name: string;
	mode: 'major' | 'minor';
	/** 0..1. Below about 0.6 the reading is a guess. */
	confidence: number;
}

export type EventTag =
	| 'drop_downbeat'
	| 'crash'
	| 'riser'
	| 'snare_roll'
	| 'silence'
	| 'kick_in'
	| 'kick_out'
	| 'bass_in'
	| 'bass_out'
	| 'filter_sweep'
	| 'vocal_in'
	/** Final drop-class return lifts by one or two semitones; tagged on its first bar. */
	| 'key_change';

/** One row per bar. This is the granularity every cue is authored at. */
export interface BarRow {
	bar: number;
	t: number;
	section: SectionKind;
	/** 0..100, normalised across the whole track so relative judgement is trivial. */
	energy: number;
	sub: number;
	low: number;
	mid: number;
	air: number;
	kicks: number;
	snares: number;
	hats: number;
	/** Lyric coverage, 0..1. Zero when no synced lyrics were found. */
	vocal: number;
	events: EventTag[];
}

export interface SectionSpan {
	index: number;
	kind: SectionKind;
	startBar: number;
	endBar: number;
	startTime: number;
	endTime: number;
	lengthBars: number;
	meanEnergy: number;
	peakEnergy: number;
	/** 1 = the biggest section in the track. Makes "which moment is the peak" a fact. */
	energyRank: number;
	/** Same-material group ID; negative for carved sections such as voids. */
	group: number;
	/** Index of the first section carrying this group, or null when this is that one. */
	repeatOf: number | null;
	/** Index into movements for stitched tracks; absent for one-song tracks. */
	movement?: number;
}

/**
 * One movement of a stitched track, detected or listener-marked.
 * Each has its own count, energy scale and sections; the show re-stages at its first bar.
 */
export interface MovementSpan {
	startBar: number;
	endBar: number;
	startTime: number;
	endTime: number;
	/** Tempo of this song from its own bars, not the track median. */
	bpm: number;
	key: KeyEstimate;
	source: 'auto' | 'mark';
	/** What convinced the detector, for the panel; empty for a mark. */
	note: string;
}

/** One drum's aligned onset times and strengths. */
export interface OnsetStream {
	/** Onset times, seconds, ascending. */
	times: number[];
	/**
	 * Strength, 0..1 against the track's strongest, constrained by detector confidence.
	 * Aligned with times.
	 * Pattern-completed hits carry pattern confidence.
	 */
	levels: number[];
}

/** Energy and band levels, 0..100 at beat resolution, aligned with TrackAnalysis.beats. */
export interface Envelopes {
	/** One per beat. */
	energy: number[];
	/** beats * NUM_BANDS, in the contract's band order. */
	bands: number[];
}

/**
 * Log-spaced per-frame spectrum, byte-encoded in Base64 to keep the analysis compact.
 * A fixed 30 dB window preserves relative band heights; quiet sections gain at most 6 dB.
 * Unlike Envelopes.bands, individual bands are not stretched across their own track-wide range.
 */
export interface SpectrumTrack {
	fps: number;
	bands: number;
	/** Band centre frequencies, Hz, ascending. */
	centreHz: number[];
	/** `frames * bands` bytes, base64. Entry f covers the span [f/fps, (f+1)/fps). */
	data: string;
}

/**
 * Short-term K-weighted level at `fps`, one byte per frame, base64. 255 is the loud reference
 * (q95 of drop/groove frames); each byte is 48/255 dB and 0 is 48 dB below or silence.
 * Unlike Envelopes.energy this follows attacks and rests inside a beat.
 */
export interface LevelTrack {
	fps: number;
	/** `frames` bytes, base64. Entry f is centred on (f + 0.5) / fps. */
	data: string;
}

export interface Moment {
	bar: number;
	beat: number;
	t: number;
	kind: EventTag | 'section_start';
	note: string;
}

/** Frame-sampled stereo image so between-beat pan gestures survive. */
export interface StereoImage {
	fps: number;
	/** -1 hard left, +1 hard right. */
	pan: number[];
	/** 0 when the channels are identical, 1 when they share nothing. */
	width: number[];
}

export interface TrackAnalysis {
	version: number;
	/** Of the decoded audio. A show pinned to a stale hash is rejected. */
	hash: string;
	trackId: string;
	title: string;
	duration: number;
	sampleRate: number;
	tempo: TempoGrid;
	key: KeyEstimate;
	bars: BarRow[];
	sections: SectionSpan[];
	/**
	 * Section count before same-material consolidation, used by gridTrust so merges cannot hide
	 * fragmentation. Absent before analysis v17.
	 */
	rawSectionCount?: number;
	/** Adopted hand-map fingerprint. Ingest reanalyses on any difference, including deletion. */
	handMap?: string;
	/**
	 * Two or more movement spans tiling the bar table; absent for one-song tracks.
	 * Each movement starts on a bar line.
	 */
	movements?: MovementSpan[];
	moments: Moment[];
	/** Every tracked beat, seconds. Exact even where the constant grid is only a fit. */
	beats: number[];
	/**
	 * Model downbeats in seconds, a strict subset of beats. Retained for grid review without
	 * rerunning the model; absent when no model ran.
	 */
	downbeats?: number[];
	/** Unrepaired tracker beats/downbeats, retained so probes test the same input as the app. */
	heard?: { beats: number[]; downbeats: number[] };
	envelopes: Envelopes;
	spectrum: SpectrumTrack;
	/** Absent before analysis v33; the frame's level reads zero without it. */
	level?: LevelTrack;
	stereo: StereoImage;
	onsets: {
		kick: OnsetStream;
		snare: OnsetStream;
		hat: OnsetStream;
	};
	integratedLufs: number;
	/** EBU R128 loudness range, LU. */
	loudnessRange: number;
	/**
	 * Peak minus integrated loudness, LU. Below ~8, limiting leaves little per-bar level
	 * variation.
	 */
	peakToLoudness: number;
}
