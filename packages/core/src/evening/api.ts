import type { GenreFamily } from '../contracts/context.ts';
import type { LayerRole, Params, RenderCtx } from '../contracts/effect.ts';
import type {
	EntryHit,
	FillOrder,
	FillSource,
	HitKind,
	NarrationEnd,
	Position,
	Pulse,
	SegmentKind,
	SourceLine
} from '../contracts/evening.ts';
import type { SectionKind } from '../contracts/frame.ts';
import type { ShowPalette } from '../contracts/palette.ts';
import type { Geometry } from '../contracts/room.ts';
import type { Clock, Length } from './time.ts';
import type { EffectsByRole, PaletteName, Scene } from './vocabulary.ts';

export type Palette = PaletteName | ShowPalette;

// ---- Custom effects ------------------------------------------------------------------------

export interface ParamInput {
	default: number;
	min?: number;
	max?: number;
	step?: number;
	label?: string;
}

export interface EffectContext<V> extends Omit<RenderCtx, 'p'> {
	p: V;
}

export interface EffectInstance<V> {
	reset?(): void;
	render(out: Float32Array, ctx: EffectContext<V>): void;
}

export interface CustomEffect<R extends LayerRole = LayerRole> {
	readonly kind: 'effect';
	readonly id: string;
	readonly name: string;
	readonly role: R;
	readonly blurb: string;
	readonly params: Readonly<Record<string, number | ParamInput>>;
	readonly create: (g: Geometry) => EffectInstance<Record<string, number>>;
	readonly line?: SourceLine;
}

/**
 * Your own effect, written as real code. `create` runs in the effect sandbox: only the names
 * this module exports for effects (clamp, Follower, SLOT, setSample...) and its own locals are
 * in scope there, so keep constants inside `create`.
 */
export function effect<
	const R extends LayerRole,
	const P extends Record<string, number | ParamInput> = Record<never, number>
>(def: {
	id: string;
	name?: string;
	role: R;
	blurb?: string;
	params?: P;
	create(g: Geometry): EffectInstance<{ [K in keyof P]: number }>;
}): CustomEffect<R> {
	return {
		kind: 'effect',
		id: def.id,
		name: def.name ?? def.id,
		role: def.role,
		blurb: def.blurb ?? '',
		params: def.params ?? {},
		create: def.create as CustomEffect<R>['create'],
		line: callSite()
	};
}

// ---- Looks ---------------------------------------------------------------------------------

export type LayerChoice<R extends LayerRole> =
	| EffectsByRole[R]
	| CustomEffect<R>
	| { effect: EffectsByRole[R] | CustomEffect<R>; opacity?: number; params?: Params };

export interface LookInput {
	bed?: LayerChoice<'bed'>;
	rhythm?: LayerChoice<'rhythm'>;
	transient?: LayerChoice<'transient'>;
	accent?: LayerChoice<'accent'>;
	master?: LayerChoice<'master'>;
	palette?: Palette;
	/** 0..1, the cue ceiling. */
	intensity?: number;
	/** Speed scale effects multiply their own speeds by. */
	motion?: number;
	/**
	 * House light the room keeps under the layers, 0..1, in the palette's base colour. Most
	 * sections keep about 0.35 so quiet built-in effects never leave the room dark; 0 lets your
	 * own effects decide every pixel.
	 */
	floor?: number;
}

export interface Look {
	readonly kind: 'look';
	readonly spec: LookInput;
	readonly line?: SourceLine;
}

export function look(spec: LookInput): Look {
	return { kind: 'look', spec, line: callSite() };
}

export type LookChoice = Look | Scene;

// ---- Timelines and clocks ------------------------------------------------------------------

/** From `at` onward the room does this. Omitted fields carry over from the previous step. */
export interface Step {
	/** Seconds from the segment's start ('0:12' or 12), or a bar on its own clock. */
	at: Length | { bar: number };
	/** Shapes the frame effects read: energy, build progress towards the next drop, floors. */
	section?: SectionKind;
	look?: LookChoice;
	palette?: Palette;
	intensity?: number;
	motion?: number;
	/** Beats to fade into this step's look; 0 cuts. */
	fade?: number;
	/** Passage energy effects read, 0..1, from here on. */
	energy?: number;
	hit?: HitKind;
	/** How long the hit holds, in beats. */
	beats?: number;
	/**
	 * A kick at exactly this moment, for drum-reactive effects and the Bounce Lamp: true, or its
	 * strength up to 1. It sounds besides the pulse and in any section, so a rhythm off the grid,
	 * a racing heartbeat, still lands.
	 */
	kick?: boolean | number;
}

/** A silent segment's own grid, so beats, bars and phrases exist without audio. */
export interface OwnClock {
	/** Default 120. */
	bpm?: number;
	/** Default 4. */
	beatsPerBar?: number;
	/** A synthetic kit for drum-reactive effects. Default none. */
	pulse?: Pulse;
}

// ---- Transitions and timing ----------------------------------------------------------------

export interface Entry {
	/** Played in a declared silence before the segment. */
	sting?: Sting;
	/** Silence before the segment; the sting's length when only a sting is given. */
	gap?: Length;
	/** Dissolve length into the segment (default 1.5 s), or a cut. */
	light?: Length | 'cut';
	/** Punctuation on the first downbeat of the segment's first song. */
	hit?: EntryHit;
	/** Songs only: overlap with the previous song. */
	crossfade?: Length;
}

export interface Timing {
	/** Start at this time on the night. */
	at?: Clock;
	/** Start no earlier than this time. */
	notBefore?: Clock;
}

// ---- Songs ---------------------------------------------------------------------------------

export interface Overlay {
	from: Position;
	to: Position;
	look: Look;
	/** Punctuation on the downbeat where the engine's show takes back over. */
	end?: EntryHit;
}

export interface SongOptions {
	/** Artist, when the title alone is ambiguous. */
	by?: string;
	/** YouTube id: exact, and lets a library that lacks the song fetch it. */
	id?: string;
	/** The engine's show (default), calm scenes that follow the music, or your look throughout. */
	lighting?: 'show' | 'calm' | Look;
	/** Your look over a bar range, reacting to this song, before the engine's show resumes. */
	overlays?: Overlay[];
	/** Punctuation on the song's first downbeat. */
	hit?: EntryHit;
}

export interface Song {
	readonly kind: 'song';
	readonly title: string;
	readonly options: SongOptions;
	readonly line?: SourceLine;
}

export function song(title: string, options: SongOptions = {}): Song {
	return { kind: 'song', title, options, line: callSite() };
}

export interface FillCriteria {
	families?: GenreFamily[];
	/** Cross-track heat, 1 still to 5 peak: one value or an inclusive range. */
	heat?: number | [number, number];
	bpm?: [number, number];
	/** Song length, minutes. */
	minutes?: [number, number];
	artists?: string[];
	/** Track ids never picked here. */
	exclude?: string[];
}

export interface FillInput {
	/** Exactly this many songs. An open block's last fill takes this many at least, then keeps going. */
	count?: number;
	/** A target; songs stay whole. Needed unless there is a count, or the fill ends an open block. */
	length?: Length;
	/** Default library. */
	from?: FillSource;
	where?: FillCriteria;
	/** Default rising. */
	order?: FillOrder;
	lighting?: 'show' | 'calm';
}

export interface Fill {
	readonly kind: 'fill';
	readonly spec: FillInput;
	readonly line?: SourceLine;
}

/** Songs chosen for you by criteria, around the songs you name. */
export function fill(spec: FillInput): Fill {
	return { kind: 'fill', spec, line: callSite() };
}

// ---- Segments ------------------------------------------------------------------------------

interface SegmentInput extends Timing {
	/** Stable id; derived from the name when absent. */
	id?: string;
	enter?: Entry;
}

export interface BlockInput extends SegmentInput {
	songs: (Song | Fill)[];
	between?: { light?: Length | 'cut'; crossfade?: Length };
	/** Tints the block's songs: each colour turns toward the nearest of these without changing its light. */
	palette?: Palette;
	/** A look replaces the engine's effects but keeps each song's section levels. */
	lighting?: 'show' | 'calm' | Look;
	/** The last block only: keep choosing songs until you stop the evening. */
	open?: boolean;
}

export interface PauseInput extends SegmentInput {
	/** Fixed length. Without it, the music's own length. */
	length?: Length;
	/** End at this time instead. */
	until?: Clock;
	/** Default 'resting'. */
	look?: LookChoice;
	palette?: Palette;
	/** Songs lit calmly; the last one fades out at the pause's end. */
	music?: (Song | Fill)[];
	/** Default 6 s. */
	fadeOut?: Length;
}

export interface HoldInput extends SegmentInput {
	look?: LookChoice;
	palette?: Palette;
	/** For planning only: how long the hold usually takes. */
	expect?: Length;
	/** For planning only: the time it usually ends. */
	expectEnd?: Clock;
	/** Shown on the rail while holding. */
	note?: string;
}

export interface MomentInput extends SegmentInput, OwnClock {
	length: Length;
	palette?: Palette;
	timeline: Step[];
}

export interface NarrationInput extends SegmentInput, OwnClock {
	/** Path to the audio file, relative to the evening file. */
	audio: string;
	look?: LookChoice;
	palette?: Palette;
	timeline?: Step[];
	/** 0..1, default 1. */
	volume?: number;
	/**
	 * How the light ends with the audio: 'ease' (default) fades the last half second as a song
	 * does; 'hold' keeps the look as it is for the next row to take over.
	 */
	end?: NarrationEnd;
}

export type SegmentInputOf = {
	block: BlockInput;
	pause: PauseInput;
	hold: HoldInput;
	moment: MomentInput;
	narration: NarrationInput;
};

export interface Segment<K extends SegmentKind = SegmentKind> {
	readonly kind: 'segment';
	readonly type: K;
	readonly name: string;
	readonly spec: SegmentInputOf[K];
	readonly line?: SourceLine;
}

/** Songs: named ones where you put them, fill slots around them. */
export function block(name: string, spec: BlockInput): Segment<'block'> {
	return { kind: 'segment', type: 'block', name, spec, line: callSite() };
}

/** A calm stretch: silence or its own music, with a look. */
export function pause(name: string, spec: PauseInput): Segment<'pause'> {
	return { kind: 'segment', type: 'pause', name, spec, line: callSite() };
}

/** Waits in a look until you press Go. */
export function hold(name: string, spec: HoldInput = {}): Segment<'hold'> {
	return { kind: 'segment', type: 'hold', name, spec, line: callSite() };
}

/** A silent light moment on its own clock. */
export function moment(name: string, spec: MomentInput): Segment<'moment'> {
	return { kind: 'segment', type: 'moment', name, spec, line: callSite() };
}

/** Your own audio with the room authored under it. */
export function narration(name: string, spec: NarrationInput): Segment<'narration'> {
	return { kind: 'segment', type: 'narration', name, spec, line: callSite() };
}

// ---- Stings and the evening ----------------------------------------------------------------

export interface StingInput extends OwnClock {
	id?: string;
	length: Length;
	palette?: Palette;
	timeline: Step[];
}

export interface Sting {
	readonly kind: 'sting';
	readonly name: string;
	readonly spec: StingInput;
	readonly line?: SourceLine;
}

/** A short silent moment between segments, reusable by any `enter`. */
export function sting(name: string, spec: StingInput): Sting {
	return { kind: 'sting', name, spec, line: callSite() };
}

/** Silence in a dark room. */
export function blackout(length: Length = '2s'): Sting {
	return sting('Blackout', {
		id: `blackout-${length}`,
		length,
		timeline: [{ at: 0, section: 'void', look: look({ bed: 'blackout' }) }]
	});
}

/** The room fills toward white through the silence and lands on the next segment. */
export function riser(length: Length = '4s', palette?: Palette): Sting {
	return sting('Riser', {
		id: `riser-${length}`,
		length,
		bpm: 128,
		...(palette ? { palette } : {}),
		timeline: [
			{ at: 0, section: 'build', look: look({ rhythm: 'riser', accent: 'buildStrobe' }) },
			{ at: length, section: 'drop' }
		]
	});
}

/** A dark breath, then a burst of strobe as the next segment arrives. */
export function strobeHit(length: Length = '1.5s'): Sting {
	return sting('Strobe hit', {
		id: `strobe-${length}`,
		length,
		bpm: 150,
		timeline: [
			{ at: 0, section: 'void', look: look({ bed: 'blackout' }) },
			{ at: { bar: 0.25 }, section: 'drop', hit: 'strobe', beats: 2 }
		]
	});
}

/** A wave of colour crosses the ceiling in the dark. */
export function colourSweep(length: Length = '2s', palette?: Palette): Sting {
	return sting('Colour sweep', {
		id: `sweep-${length}`,
		length,
		bpm: 60,
		...(palette ? { palette } : {}),
		timeline: [
			{
				at: 0,
				section: 'build',
				look: look({ rhythm: { effect: 'sweep', opacity: 1, params: { bars: 0.5, width: 0.07, turn: 0 } }, intensity: 1, floor: 0 })
			}
		]
	});
}

export interface EveningInput {
	/** Default palette for looks and moments that name none. */
	palette?: Palette;
	/** Your heat for particular tracks, by id, overriding the measured one. */
	heat?: Record<string, number>;
	segments: Segment[];
}

export interface Evening {
	readonly kind: 'evening';
	readonly name: string;
	readonly spec: EveningInput;
	readonly line?: SourceLine;
}

/** The evening, as the file's default export. */
export function evening(name: string, spec: EveningInput): Evening {
	return { kind: 'evening', name, spec, line: callSite() };
}

/** The loader marks evening module URLs with `?v=`, which is how their frames are found. */
function callSite(): SourceLine | undefined {
	const stack = new Error().stack;
	if (!stack) return undefined;
	for (const frame of stack.split('\n')) {
		const match = /(file:\/\/[^\s)]+?)\?v=[^:\s)]*:(\d+):\d+/.exec(frame);
		if (!match) continue;
		const url = decodeURIComponent(match[1]);
		const file = /^file:\/\/\/[A-Za-z]:\//.test(url) ? url.slice(8) : url.slice(7);
		return { file, line: Number(match[2]) };
	}
	return undefined;
}
