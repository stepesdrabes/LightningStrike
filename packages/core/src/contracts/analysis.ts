import type { SectionKind } from './frame.ts';

export const ANALYSIS_VERSION = 30;

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
	 * False when the track's tempo moves enough that one period cannot describe it.
	 *
	 * It is a description of the music, not a switch: `barTimes` is the authority either way,
	 * so nothing downstream has to branch on this and nothing downstream may.
	 */
	constant: boolean;
	/** 0..1, separately from `confidence`: the beat grid can be certain and the meter not. */
	meterConfidence: number;
	/**
	 * True when half, double or three-against-two is defensible on the same evidence.
	 *
	 * Metrical level is the one thing neither tracker can be trusted with on this repertoire:
	 * the two disagree on seven of fifteen cached tracks and a listening test split those two
	 * all. This is a well-calibrated flag rather than a defect, and the answer is to ask, which
	 * a listener settles in seconds and the cache then keeps.
	 */
	ambiguous: boolean;
	/** Readings a listener might prefer instead, most plausible first. */
	alternativeBpm: number[];
	/**
	 * Start time of every bar, seconds, plus the end of the last one: length is barCount + 1.
	 *
	 * This is the only thing that says where a bar is. The scalars above reconstruct it exactly
	 * only when the tempo never moves, and a track whose tempo moves by a per cent or two
	 * accumulates whole beats of error over four minutes, which is why they are not used for it.
	 * `bars[].t` is written from this array rather than alongside it, so the two cannot drift
	 * apart.
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
	/**
	 * The final drop-class section arrives a semitone or two above the earlier statements of
	 * the same energy class - the classic pop lift. Tagged on its first bar; the planner
	 * answers it with the one palette move the colour identity sanctions beyond the swap.
	 */
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
	/**
	 * 0..1, the share of the bar under a synced lyric line. Zero wherever no lyrics were
	 * found, so an offline ingest carries a column of zeros rather than a different shape.
	 */
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
	/**
	 * Which material this is. Sections sharing an id are the same passage of the song, so a
	 * show can light every chorus alike without being told which ones those are. Negative when
	 * the section was carved out rather than detected, such as a void.
	 */
	group: number;
	/** Index of the first section carrying this group, or null when this is that one. */
	repeatOf: number | null;
	/**
	 * Which song of a stitched track this section belongs to, indexing `movements`. Absent on
	 * a track that is one song, which is nearly all of them.
	 */
	movement?: number;
}

/**
 * One song of a track that is several: a beat switch, a medley, a suite.
 *
 * Found by the analyser (a tempo step with material that stops recurring, a beatless
 * interlude between two songs, a restarted count into new material in a new key) or marked by
 * the listener; either way the song gets its own count of one, its own energy scale, its own
 * sections, and the show re-stages at its first bar.
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

/**
 * One drum's hits.
 *
 * Times and levels are one object rather than two arrays on the analysis, because the only
 * thing that makes a level meaningful is which hit it belongs to, and two sibling arrays that
 * have to stay index-aligned eventually do not.
 */
export interface OnsetStream {
	/** Onset times, seconds, ascending. */
	times: number[];
	/**
	 * How hard each hit was struck, 0..1 against the track's own strongest, index-aligned with
	 * `times`. A hit completed from the pattern rather than heard carries the pattern's own
	 * confidence, so it is never the loudest thing in the bar.
	 */
	levels: number[];
}

/**
 * Energy and band levels at beat resolution, 0..100, aligned with `TrackAnalysis.beats`.
 *
 * Per bar was too coarse for anything an effect modulates with. Between 12% and 43% of the
 * true band-envelope variance lives inside the bar and was unreachable, and interpolating
 * between per-bar means also led the audio by half a bar, which is a whole second at 120 bpm.
 * The bar table still carries the same fields, because that is the granularity a cue is
 * authored at and a show is read at; this is the granularity the light moves at.
 */
export interface Envelopes {
	/** One per beat. */
	energy: number[];
	/** beats * NUM_BANDS, in the contract's band order. */
	bands: number[];
}

/**
 * A log-spaced spectrum per frame: the whole of what is playing, not a four-band summary.
 *
 * Stored as bytes in one base64 string because this is by far the largest thing in the file. A
 * four-minute track is a quarter of a million values, which as JSON numbers would be a megabyte
 * on its own and, pretty-printed the way the rest of the analysis is, a quarter of a million
 * lines.
 *
 * A fixed 30 dB window against one shared reference per band: 1.0 means "as loud as this track's
 * loud passages get", 0.0 means 30 dB under it. NOT per-band normalised - stretching each band
 * across its own whole-track range made every band read near full whenever it was near its own
 * maximum, so a drop arrived as a flat plateau with nothing left to react with, and it destroyed
 * the relative height between bands that is what makes a spectrum look like music rather than
 * like twenty independent meters. Quiet section kinds are lifted by at most 6 dB, so they keep
 * some articulation of their own without arriving at a drop's.
 *
 * This is therefore NOT the same kind of number as `Envelopes.bands`, which stays normalised per
 * band across the track. The bands say how LOUD; the spectrum says what SHAPE.
 */
export interface SpectrumTrack {
	fps: number;
	bands: number;
	/** Band centre frequencies, Hz, ascending. */
	centreHz: number[];
	/** `frames * bands` bytes, base64. Entry f covers the span [f/fps, (f+1)/fps). */
	data: string;
}

export interface Moment {
	bar: number;
	beat: number;
	t: number;
	kind: EventTag | 'section_start';
	note: string;
}

/**
 * Where the sound sits across the room, over time. Sampled rather than per-bar because the
 * gesture worth reacting to - a vocal thrown hard left and right - moves on every sixteenth.
 */
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
	 * How many sections the segmenter emitted BEFORE same-material consolidation. The
	 * fragmentation trust gate reads this one: a wrong-grid wreck chops into homogeneous
	 * same-kind runs, which is exactly what consolidation merges, and a wreck must not
	 * merge its way past the lounge routing that exists to catch it. Absent on analyses
	 * older than v17.
	 */
	rawSectionCount?: number;
	/**
	 * Fingerprint of the hand-drawn section map this analysis adopted, absent when it read
	 * none. It is what lets a map take effect the moment it is drawn: the analysis is
	 * otherwise kept while its version is current, so a map drawn on a current blob would
	 * wait for the next version bump to be heard - and a map redrawn after a listen would
	 * never be heard at all. Ingest compares this against the judgement beside the cache and
	 * re-analyses on any difference, a map deleted included.
	 */
	handMap?: string;
	/**
	 * The songs of a track that is several stitched together - SICKO MODE's beat switches,
	 * Melanz's three records. Absent on a track that is one song, which is nearly all of
	 * them; present with two or more spans otherwise, tiling the bar table. Each span starts
	 * on a bar line by construction: a movement is a grid cut, so the bar table starts a new
	 * bar exactly there.
	 */
	movements?: MovementSpan[];
	moments: Moment[];
	/** Every tracked beat, seconds. Exact even where the constant grid is only a fit. */
	beats: number[];
	/**
	 * The tracker's own downbeats, seconds, when a model ran; absent when none did.
	 *
	 * A strict subset of `beats` (verified across the cached corpus to the sample), and about
	 * 900 bytes on a four-minute track against the spectrum's 400 KB. Stored because the bar
	 * table is a DECISION made from these, and without them nothing downstream can ask whether
	 * that decision was right, re-run the phase walk at another price, or A/B a grid without
	 * loading a 79 MB graph again.
	 */
	downbeats?: number[];
	/**
	 * The tracker's beats and downbeats before the grid repair wrote over any of them:
	 * what `beats` was made from. A bench or probe that starts from `beats` repairs a repaired
	 * stream and reports a seam the app never has to find.
	 */
	heard?: { beats: number[]; downbeats: number[] };
	envelopes: Envelopes;
	spectrum: SpectrumTrack;
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
	 * Peak minus integrated loudness, LU. Under about 8 the master is heavily limited, so
	 * per-bar level barely moves and a show has to take its dynamics from somewhere else.
	 */
	peakToLoudness: number;
}
