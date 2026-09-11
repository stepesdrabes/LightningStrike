/**
 * Optional track identity, genre, tempo and lyrics from keyless services, cached at ingest.
 * Core owns the contract; analysis fills it. Missing metadata must not block the pipeline.
 */

export const CONTEXT_VERSION = 3;

/** Lighting families group genres with shared palette, flash and blackout treatment. */
export type GenreFamily =
	| 'techno'
	| 'house'
	| 'edm'
	| 'trance'
	| 'bass'
	| 'pop'
	| 'rock'
	| 'metal'
	| 'punk'
	| 'hiphop'
	| 'rnb'
	| 'ballad'
	| 'ambient'
	| 'latin'
	| 'disco';

export interface LyricLine {
	/** Seconds from the start of the track. */
	t: number;
	text: string;
}

export interface TrackContext {
	version: number;
	/** Clean identity, or null when nothing could resolve one. */
	artist: string | null;
	title: string | null;
	/** Which step settled the identity: 'ytmeta', 'odesli', 'deezer', 'titleparse'. */
	resolvedBy: string | null;
	isrc: string | null;
	/** Published BPM, used to settle metrical-level ambiguity. */
	publishedBpm: number | null;
	/** Raw genre strings as the sources gave them, for the inspector and for re-mapping. */
	/**
	 * Metadata-only genres. Keep classifier labels in audioGenres so re-votes cannot reuse
	 * the model's own output as independent evidence.
	 */
	genres: string[];
	/** The audio classifier's own top labels, kept apart from the metadata's - see `genres`. */
	audioGenres: string[];
	genreFamily: GenreFamily | null;
	/** 0..1, share of the genre evidence that voted for the winning family. */
	genreConfidence: number;
	/** Line-synced lyrics, ascending by time, or null when none were found. */
	lyrics: LyricLine[] | null;
	/** True when a lyrics source positively says the track has no words. */
	instrumental: boolean | null;
	/** ISO timestamp of the lookup run. An empty `sources` plus an old date invites a retry. */
	fetchedAt: string;
	/** Which services answered at all, e.g. ['ytmeta', 'deezer', 'lrclib']. */
	sources: string[];
}

/** A context that says nothing, for offline ingest and failed lookups. */
export function emptyContext(): TrackContext {
	return {
		version: CONTEXT_VERSION,
		artist: null,
		title: null,
		resolvedBy: null,
		isrc: null,
		publishedBpm: null,
		genres: [],
		audioGenres: [],
		genreFamily: null,
		genreConfidence: 0,
		lyrics: null,
		instrumental: null,
		fetchedAt: new Date(0).toISOString(),
		sources: []
	};
}
