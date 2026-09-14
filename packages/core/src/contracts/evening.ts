import type { GenreFamily } from './context.ts';
import type { LayerRole } from './effect.ts';
import type { SectionKind } from './frame.ts';
import type { ShowPalette } from './palette.ts';
import type { GeneratedEffect, Hit, LayerSpec } from './show.ts';

/**
 * An evening is the owner's script for a whole night, compiled from a TypeScript file into
 * this JSON shape. Every length is seconds; clock times are 'HH:MM' on the night.
 */
export const EVENING_VERSION = 1;

/** Where in the evening file something was written, for findings. */
export interface SourceLine {
	file: string;
	line: number;
}

export type HitKind = Hit['kind'];
/** Punctuation that adds light on a song's first downbeat. */
export type EntryHit = Exclude<HitKind, 'blackout'>;

export interface LookSpec {
	layers: Partial<Record<LayerRole, LayerSpec>>;
	palette?: ShowPalette;
	intensity?: number;
	motion?: number;
	/** House light under the layers, 0..1; absent follows the section. */
	floor?: number;
}

/** Synthetic kit for silent segments, so drum-reactive effects answer without music. */
export type Pulse = 'none' | 'kick' | 'backbeat' | 'four-on-the-floor';

/** The grid a silent segment runs on. */
export interface ClockSpec {
	bpm: number;
	beatsPerBar: number;
	pulse: Pulse;
}

/** From `at` onward the room does this; omitted fields carry over from the previous step. */
export interface StepSpec {
	at: number;
	section?: SectionKind;
	look?: LookSpec;
	palette?: ShowPalette;
	intensity?: number;
	motion?: number;
	/** Beats to fade into this step's look; 0 cuts. */
	fade?: number;
	/** Synthetic passage energy, 0..1, from here on. */
	energy?: number;
	hit?: HitKind;
	/** How long the hit holds, in beats. */
	beats?: number;
	/** A synthetic kick here, 0..1, besides the pulse's and in any section. */
	kick?: number;
}

/** How the room hands over into a segment. */
export interface EntrySpec {
	/** A sting played in a declared silence before the segment. */
	sting?: string;
	/** Silence before the segment; a sting's own length when only a sting is named. */
	gap?: number;
	/** Dissolve seconds; 0 cuts. */
	light?: number;
	hit?: EntryHit;
	/** Songs only: seconds this song overlaps the end of the previous one. */
	crossfade?: number;
}

export type Position =
	| 'start'
	| 'end'
	| 'first-drop'
	| 'last-drop'
	| 'peak'
	| { bar: number }
	| { section: SectionKind; nth?: number };

/** A look that replaces the engine's show for a bar range of one song. */
export interface OverlaySpec {
	from: Position;
	to: Position;
	look: LookSpec;
	/** Punctuation on the downbeat where the engine's show takes back over. */
	end?: EntryHit;
}

export type SongLighting = 'show' | 'calm' | LookSpec;

export interface SongSpec {
	kind: 'song';
	title: string;
	by?: string;
	/** YouTube id, exact and fetchable by a library that lacks the song. */
	id?: string;
	lighting?: SongLighting;
	overlays: OverlaySpec[];
	hit?: EntryHit;
	line?: SourceLine;
}

export interface Criteria {
	families?: GenreFamily[];
	/** Cross-track heat, 1 still to 5 peak, inclusive. */
	heat?: [number, number];
	bpm?: [number, number];
	/** Song length range, minutes. */
	minutes?: [number, number];
	artists?: string[];
	/** Track ids never picked here. */
	exclude?: string[];
}

export type FillOrder = 'rising' | 'falling' | 'steady' | 'shuffle';
export type FillSource = 'library' | 'requests' | 'requests-then-library';

/** An auto-fill slot: whole songs only. Exactly one of count and length. */
export interface FillSpec {
	kind: 'fill';
	count?: number;
	length?: number;
	from: FillSource;
	where: Criteria;
	order: FillOrder;
	lighting?: 'show' | 'calm';
	line?: SourceLine;
}

export type SongItem = SongSpec | FillSpec;

interface SegmentBase {
	/** Stable across edits: explicit, or derived from the name. */
	id: string;
	name: string;
	/** Start at this clock time. */
	at?: string;
	/** Start no earlier than this clock time. */
	notBefore?: string;
	enter?: EntrySpec;
	line?: SourceLine;
}

export interface BlockSpec extends SegmentBase {
	kind: 'block';
	items: SongItem[];
	between: { light?: number; crossfade?: number };
	palette?: ShowPalette;
	lighting?: SongLighting;
	/** The last block may keep choosing songs until the host stops the evening. */
	open: boolean;
}

export interface PauseSpec extends SegmentBase {
	kind: 'pause';
	/** Fixed length; absent means the music's own length. */
	length?: number;
	/** End at this clock time instead. */
	until?: string;
	/** The room while silent, and over the music when given; without one the music gets lounge. */
	look?: LookSpec;
	music: SongItem[];
	fadeOut: number;
}

export interface HoldSpec extends SegmentBase {
	kind: 'hold';
	look: LookSpec;
	/** Planning only: seconds the hold is expected to last, or the clock time it should end. */
	expect?: number;
	expectAt?: string;
	note?: string;
}

export interface MomentSpec extends SegmentBase {
	kind: 'moment';
	length: number;
	clock: ClockSpec;
	timeline: StepSpec[];
	palette?: ShowPalette;
}

/** How a narration's light ends with its audio: eased out as a song's, or held for the next row. */
export type NarrationEnd = 'ease' | 'hold';

export interface NarrationSpec extends SegmentBase {
	kind: 'narration';
	/** Absolute path to the audio file. */
	audio: string;
	clock: ClockSpec;
	timeline: StepSpec[];
	palette?: ShowPalette;
	volume: number;
	end: NarrationEnd;
}

export interface StingSpec {
	id: string;
	name: string;
	length: number;
	clock: ClockSpec;
	timeline: StepSpec[];
	palette?: ShowPalette;
	line?: SourceLine;
}

export type SegmentSpec = BlockSpec | PauseSpec | HoldSpec | MomentSpec | NarrationSpec;
export type SegmentKind = SegmentSpec['kind'];

export interface EveningScript {
	version: number;
	name: string;
	palette?: ShowPalette;
	/** Per-track heat the owner set, by track id. */
	heat: Record<string, number>;
	/** Every custom effect, admitted through the effect gate. */
	effects: GeneratedEffect[];
	stings: StingSpec[];
	segments: SegmentSpec[];
}

export interface Finding {
	severity: 'error' | 'warning' | 'info';
	message: string;
	/** Segment id, when the finding belongs to one. */
	segment?: string;
	line?: SourceLine;
}

/** What a silent row plays: a grid on its own clock and a timeline of looks. */
export interface SilentPlan {
	kind: 'silent';
	title: string;
	/** Seconds; null for a hold, which lasts until Go. */
	length: number | null;
	clock: ClockSpec;
	timeline: StepSpec[];
	palette: ShowPalette;
	/** Calm looks default to the resting room's level and motion. */
	calm: boolean;
	effects: GeneratedEffect[];
}

/** What a song row plays over the engine's show. */
export interface SongPlan {
	kind: 'song';
	trackId: string;
	/** Calm levels; with no look, lounge scenes follow the music instead of the show. */
	calm: boolean;
	look?: LookSpec;
	/** A chapter palette the song's show turns to. */
	palette?: ShowPalette;
	overlays: OverlaySpec[];
	hit?: EntryHit;
	/** Seconds into the track where the row fades out, and over how long. */
	fade?: { at: number; seconds: number };
	crossfade?: number;
	effects: GeneratedEffect[];
}

export interface NarrationPlan {
	kind: 'narration';
	title: string;
	length: number;
	clock: ClockSpec;
	timeline: StepSpec[];
	palette: ShowPalette;
	volume: number;
	end: NarrationEnd;
	effects: GeneratedEffect[];
}

export type RowPlan = SilentPlan | SongPlan | NarrationPlan;

/** Everything a player needs for one evening row, whichever side renders it. */
export interface RowLighting {
	plan: RowPlan;
	/** Dissolve seconds into this row; 0 cuts. */
	light: number;
}
