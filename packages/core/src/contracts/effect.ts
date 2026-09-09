import type { Geometry } from './room.ts';
import type { SectionKind, ShowFrame } from './frame.ts';
import type { Palette } from './palette.ts';

export type LayerRole = 'bed' | 'rhythm' | 'transient' | 'accent' | 'master';

export const LAYER_ROLES: readonly LayerRole[] = [
	'bed',
	'rhythm',
	'transient',
	'accent',
	'master'
];

export type BlendMode = 'over' | 'add' | 'screen' | 'max' | 'multiply';

export interface ParamSpec {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
	default: number;
}

export type Params = Record<string, number>;

export interface RenderCtx {
	g: Geometry;
	f: ShowFrame;
	/** This layer's parameter values. */
	p: Params;
	/** Already cross-faded by the player. */
	palette: Palette;
	hueShift: number;
	/** Cue-level speed scale. Effects multiply their own speeds by this. */
	motion: number;
}

/**
 * `out` is the effect's own scratch buffer, persistent across frames and never cleared
 * by the mixer, which is what lets trails and decay work. Stateless spatial effects must
 * therefore write every pixel every frame.
 *
 * Never allocate in `render`. Read only from `ctx`: no Date.now, no Math.random, so
 * recordings and exports reproduce exactly.
 */
export interface Effect {
	reset(): void;
	render(out: Float32Array, ctx: RenderCtx): void;
}

/** Metadata that makes restraint structural rather than something the author must remember. */
export interface EffectTaste {
	/** 1 = ambient, 5 = peak-of-the-track. */
	energy: 1 | 2 | 3 | 4 | 5;
	sections: readonly SectionKind[];
	minBars: number;
	maxBars: number;
	/** Usable at most once per show. */
	peakReserved: boolean;
	/**
	 * False when this cannot hold a room on its own.
	 *
	 * A bed is the floor of a cue, and most beds are written to sit under something: some are
	 * spatially sparse, some scale themselves by the very energy the cue's intensity is already
	 * scaling. Either way they emit almost nothing in a quiet passage, and gamma 2.2 sends
	 * anything under 0.08 to byte zero, so a cue whose only substantial layer is one of these
	 * comes out black rather than dim. Absent means it carries.
	 *
	 * The quiet probe cannot decide this: it rewards bytes of movement, and a flash moves the
	 * most bytes of anything while being dark most of every bar. Any effect that is an event
	 * with darkness between - a slam, a burst, a strobe - declares `carries: false` however
	 * high its measured `quiet` comes out.
	 */
	carries?: boolean;
	/**
	 * True for a master that renders black until the player arms `trigger` from a hit.
	 *
	 * These are punctuation, not looks: placed in a cue's master layer with no hit behind
	 * them they are a no-op, so the planner's reserved-peak choice must never land on one.
	 */
	hitOnly?: boolean;
	/**
	 * What kind of gesture this is, declared only where a genre may need to refuse it.
	 *
	 * `flash` is light as interruption - strobes and shutters, dark between frames. `impact`
	 * is light as a blow - slams, blinders, bursts. The families whose flash allowance is
	 * zero forbid both as effects exactly as they forbid them as hits; everything else is
	 * ungoverned and leaves this absent.
	 */
	character?: 'flash' | 'impact';
	/**
	 * Which peak treatment a master serves, absent when it serves either. A slam peak is
	 * an impact and a bloom peak is a lift, and the reserved-master draw is a seed-broken
	 * tie - without this, adding any master reshuffles the ties and a bloom look can land
	 * on a rap climax, which the room reads as the punch going missing. Only read for the
	 * peak-master choice; ordinary layers never consult it.
	 */
	peakStyle?: 'slam' | 'bloom';
	/**
	 * The drum stream this effect IS the answer to, declared only where that is the whole
	 * gesture: an effect that spawns on `f.kick` renders black in a passage with no kicks,
	 * and a grid pulse that reads as the kit keeps pounding through a sung verse the drums
	 * sat out. The picker refuses both where the slot's stream is silent - dead layers and
	 * lying ones are the same mistake from the room's side.
	 *
	 * `any` means kick or snare. Effects that merely season themselves with an envelope -
	 * a bed with a kick bump in it - leave this absent and degrade gracefully.
	 */
	kit?: 'kick' | 'snare' | 'hat' | 'any';
	/**
	 * How much this moves over a quiet passage, as a share of its own mean level.
	 *
	 * Bytes of delivered movement, measured by substituting the effect into the quiet cues of a
	 * cached corpus and rendering them. NOT a synthetic journey's `quiet` column: that spreads a
	 * wandering peak across every band where a real sparse intro has content in a handful and
	 * silence in the rest, and it reverses the ranking. Chosen by the synthetic number, `nebula`
	 * leads the beds and delivers 1.02 on real tracks; chosen by this one, `spectrumBed` leads
	 * and delivers 4.41. Only the beds and accents that can appear in a quiet section declare it;
	 * absent means it has never been asked to hold one.
	 *
	 * These are stored measurements from `bench/quietprobe.ts`, and nothing asserts them
	 * because measuring needs the audio cache and a test may not depend on it. Changing an
	 * effect in the quiet pool, the spectrum or the house floor invalidates whatever it
	 * declares here; re-run the probe and paste its numbers back.
	 *
	 * The planner prefers a high one where there is nothing else happening. Measured on a real
	 * intro, the pair the picker chose delivered 1.27 bytes of movement where the two most
	 * spectrum-led candidates in the same pool delivered 2.24 across 2.7x the spatial spread. The
	 * catalog already had the answer; nothing was choosing it.
	 */
	quiet?: number;
	/**
	 * How much of the room's light moves at frame scale while this plays, 0 to 1.
	 *
	 * 1 is a whole-room strike on every hit with darkness between (moshSlam, stageBlinders,
	 * a strobe); 0.6 to 0.7 a partial strike, one wall or one wave per hit; 0.4 to 0.5 a
	 * twinkle or a hard-edged pattern; 0.2 to 0.3 smooth motion; a field that holds or
	 * breathes is 0. Absent means 0.
	 *
	 * The picker spends a budget of this per cue (`activityBudget` in select.ts), which is
	 * what keeps three layers from all striking on the same kick. Measured over the corpus,
	 * the cues the owner heard as "way too flickery" were exactly those: a unison slam under a
	 * half-room gatling under a snare bloom, each defensible alone. Every console source says
	 * the same thing structurally - one hit layer over a stable base - and the eye agrees:
	 * modulation from independent layers adds, and the sum lands in the 8 to 10 Hz band where
	 * a flashing room reads brightest and busiest.
	 *
	 * Rated by hand from the gesture, not measured: a per-pixel movement metric cannot tell a
	 * chase from a flicker, and a chase is what a rhythm layer is for.
	 */
	activity?: number;
}

export interface EffectDef {
	readonly id: string;
	readonly name: string;
	readonly role: LayerRole;
	readonly blurb: string;
	readonly taste: EffectTaste;
	readonly params: readonly ParamSpec[];
	create(g: Geometry): Effect;
}
