import type { AmbientSettings, ColourSource } from '@mv/core';
import type { WireProtocol } from '$lib/hardware.ts';

/**
 * Mirror @mv/analysis TrackMeta: SvelteKit blocks client imports from server modules, even for
 * types.
 */
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

/** Shared author attribution for queue rows, search candidates and library entries. */
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

type Phase =
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
}

/** Mirrors @mv/author-ai BackendId. */
type AuthorBackend = 'claude' | 'deepseek';

/** Mirrors @mv/author-ai EffortLevel. */
export type AuthorEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Mirror the AuthorModel shape; model choices arrive from the server catalogue. */
interface AuthorModelInfo {
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
	/** AmbientSettings is shared with the renderer that also runs in this browser. */
	ambient: AmbientSettings;
}

/**
 * Mirror the settings route whitelist. Flat patches let one slider update without replacing
 * ambient settings.
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
