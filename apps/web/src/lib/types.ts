import type { AmbientSettings, ColourSource } from '@mv/core';
import type { WireProtocol } from '$lib/hardware.ts';

/** Mirrors @mv/analysis TrackMeta. Duplicated because SvelteKit blocks server imports on
    the client, even for types. */
export interface TrackMeta {
	id: string;
	title: string;
	uploader: string;
	thumbnail: string;
	/** Dominant hue of the cover, degrees, or null when it has none worth taking. */
	artHue?: number | null;
	webpageUrl: string;
	source: string;
	/** Seconds. Absent on tracks analysed before the field existed. */
	duration?: number;
}

/**
 * Which author a track already has, if any.
 *
 * One definition rather than one per consumer: the queue row, the search candidate and the
 * library entry all carry it, and when DeepSeek was added only two of the three learned about
 * it. The backends are named individually for the reason `Show.authoredBy` gives.
 */
export type Authored = 'none' | 'engine' | 'claude' | 'deepseek';

/** Mirrors @mv/analysis LibraryEntry. The family is one of GenreFamily, or null until enriched. */
export interface LibraryEntry extends TrackMeta {
	analysed: boolean;
	/** The cached blobs are this build's versions, so the track plays without preparing again. */
	current: boolean;
	authored: Authored;
	/** Fetches already spent on this row, while a transient failure is being retried. */
	attempts?: number;
	genreFamily: string | null;
	updatedAt: number;
}

/** Mirrors @mv/analysis Song, plus the watch URL the search route attaches. */
export interface SearchResult {
	id: string;
	/** The track alone. YouTube Music keeps the artist out of it, unlike an upload title. */
	title: string;
	artist: string;
	album: string | null;
	/** Seconds. */
	duration: number;
	thumbnail: string;
	webpageUrl: string;
}

export type Phase =
	| 'idle'
	| 'resolving'
	| 'downloading'
	| 'analysing'
	| 'authoring'
	| 'ready'
	| 'error';

export interface LoadState {
	phase: Phase;
	message: string;
	/** 0..1 when known, otherwise null for an indeterminate bar. */
	progress: number | null;
}

/** Mirrors @mv/author-ai BackendId. */
export type AuthorBackend = 'claude' | 'deepseek';

/** Mirrors @mv/author-ai EffortLevel. */
export type AuthorEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Mirrors @mv/author-ai AuthorModel.
 *
 * The shape is mirrored, the list is not: the models themselves arrive with the settings, so
 * adding one to the catalogue does not need an edit here as well.
 */
export interface AuthorModelInfo {
	id: string;
	label: string;
	note: string;
	backend: AuthorBackend;
}

/** Mirrors PublicSettings from the server. The key itself never crosses this boundary. */
export interface Settings {
	hasDeepseekKey: boolean;
	authorBackend: AuthorBackend;
	authorModel: string;
	authorEffort: AuthorEffort;
	authorModels: readonly AuthorModelInfo[];
	/** How far ahead of the audio the strips run, milliseconds. Positive is early. */
	outputOffsetMs: number;
	/** Frames a second on the wire. One of `OUTPUT_FPS_CHOICES`. */
	outputFps: number;
	/** Master dimmer, `OUTPUT_BRIGHTNESS_MIN`..1. After gamma, so it costs no contrast. */
	outputBrightness: number;
	/** The tone curve's exponent, `CONTRAST_MIN`..`CONTRAST_MAX`. */
	outputContrast: number;
	/** The lamp's own dimmer, same range as the room's. */
	outputLampBrightness: number;
	/** Which wire the fixture is addressed on. */
	outputProtocol: WireProtocol;
	/** Whether the radio keeps the queue from running out. */
	autopilot: boolean;
	/** Calm scenes instead of the authored show, while a track is playing. */
	lounge: boolean;
	/** Whether the room drifts into ambient when nothing is playing, rather than freezing. */
	rest: boolean;
	/**
	 * How the resting room looks. `AmbientSettings` is a `core` type rather than a mirror: it is
	 * the shape the renderer is driven with, and the browser runs its own copy of the renderer.
	 */
	ambient: AmbientSettings;
}

/**
 * What `PUT /api/settings` accepts, which is flat where `Settings` is nested.
 *
 * Mirrors the route's own whitelist by hand, like everything else across this boundary. It is flat
 * because a patch names the fields it is changing, and a nested object would mean sending the whole
 * ambient block to move one slider.
 */
export interface SettingsPatch {
	deepseekApiKey?: string;
	authorModel?: string;
	authorEffort?: AuthorEffort;
	outputOffsetMs?: number;
	outputFps?: number;
	outputBrightness?: number;
	outputContrast?: number;
	outputLampBrightness?: number;
	outputProtocol?: WireProtocol;
	autopilot?: boolean;
	lounge?: boolean;
	rest?: boolean;
	ambientColour?: ColourSource;
	ambientHue?: number;
	ambientSat?: number;
	ambientDrift?: number;
	ambientDwell?: number;
}

/** One line in the authoring activity feed. */
export interface Step {
	id: string;
	kind: 'phase' | 'tool' | 'think' | 'note';
	label: string;
	detail?: string;
	result?: string;
	state: 'pending' | 'done' | 'failed';
}

/** Mirrors @mv/author AuthorEvent. Duplicated so the client does not import the server. */
export type AuthorEvent =
	| { type: 'phase'; phase: string; label: string }
	| { type: 'thinking'; text: string }
	| { type: 'tool'; id: string; name: string; detail: string }
	| { type: 'result'; id: string; name: string; summary: string; ok: boolean }
	| { type: 'brief'; brief: string }
	| { type: 'analysis'; analysis: unknown; reason: string }
	| { type: 'note'; text: string };

/** Mirrors $lib/server/judge MomentNote. Duplicated so the client does not import the server. */
export interface MomentNote {
	t: number;
	bar: number | null;
	hit?: 'strobe' | 'slam' | 'blackout' | null;
	text: string;
}

/** Mirrors $lib/server/judge JudgedSection. Times are authoritative; bars are fractional. */
export interface JudgedSection {
	kind: string;
	startTime: number;
	endTime: number;
	startBar: number;
	endBar: number;
	/** Placed between bar lines on purpose, by the editor's fine drag. */
	offGrid?: boolean;
}

/** A judgement write carries only the fields its writer owns; the server merges the rest. */
export type JudgementPatch = Partial<Judgement> & { trackId: string };

/** Mirrors $lib/server/judge Judgement. */
export interface Judgement {
	trackId: string;
	title: string;
	rating: number | null;
	tags: string[];
	notes: MomentNote[];
	comment: string;
	sections?: JudgedSection[] | null;
	/** Seconds where a new song starts inside this one. */
	movements?: number[] | null;
	/** Seconds near which a detected movement was refused. */
	movementVetoes?: number[] | null;
	analysisHash: string | null;
	showSeed: number | null;
	authoredBy: string | null;
	updatedAt: number;
}
