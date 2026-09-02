import type { SectionKind } from './frame.ts';
import type { LayerRole, ParamSpec, Params } from './effect.ts';
import type { ShowPalette } from './palette.ts';

export const SHOW_VERSION = 22;

export interface LayerSpec {
	effect: string;
	opacity?: number;
	params?: Params;
}

/** 'swap' exchanges base and accent: the classic one-colour-event drop move. */
export type CuePalette = ShowPalette | 'swap' | 'inherit';

/**
 * Cues are addressed by bar, never by time. A model asked for wall-clock times reliably
 * answers "the drop is at 1:00"; a bar index either exists in the analysed grid or the
 * linter rejects it.
 */
export interface Cue {
	bar: number;
	section: SectionKind;
	layers: Partial<Record<LayerRole, LayerSpec>>;
	palette?: CuePalette;
	intensity?: number;
	motion?: number;
	/** Fade completes ON this cue's downbeat. 0 snaps, which is what voids and drops want. */
	fadeBeats?: number;
	note: string;
}

export interface Hit {
	bar: number;
	/**
	 * Beat within the bar, 0-indexed. Defaults to 0.
	 *
	 * Non-zero only for a gesture whose job is to END on a downbeat: the held breath before a
	 * drop has to be short enough to read as a breath and still finish exactly on the thing it
	 * is setting up, and at four beats it cannot be both.
	 */
	beat?: number;
	/**
	 * `bump` is the one that is not a flash: an accent-colour flood, so a loud passage can be
	 * punctuated a second and third time without spending the same card twice.
	 */
	kind: 'slam' | 'strobe' | 'blackout' | 'bump';
	beats: number;
	/** Overrides on the hit's effect, e.g. strobe `perBeat`. The linter reads these. */
	params?: Params;
	note?: string;
}

export interface HitRule {
	/** Longest the gesture may hold the room, in bars. */
	maxBars: number;
	/**
	 * Longest in seconds, for the gestures that are lit for exactly as long as they are held.
	 *
	 * Absent for the ones that decay on their own: their hit length decides how long the master
	 * slot is reserved, not how long the room sees anything, so capping it in seconds would
	 * measure the wrong thing.
	 */
	maxSeconds?: number;
}

/**
 * How long each gesture may hold the room.
 *
 * In bars because punctuation is addressed on the grid like everything else, and in seconds
 * because a bar is 1.4 s at 175 bpm and 3 s at 80: two bars of strobe is a flourish at one
 * tempo and an ordeal at the other, and how long it FEELS is what anyone in the room judges.
 *
 * This caps length only. Flash RATE has its own ceiling in `strobePerBeat` below; there is
 * still no minimum gap between flashes - see the note in `lint.ts`.
 */
export const HIT_RULES: Record<Hit['kind'], HitRule> = {
	// Black is the one gesture no envelope can soften, and an unintended black stage reads as
	// failure. A whole bar is four beats, which at the tempos this repertoire actually sits at
	// is three seconds of nothing: long enough to read as a fault rather than as a breath.
	blackout: { maxBars: 2, maxSeconds: 2.2 },
	strobe: { maxBars: 2, maxSeconds: 3 },
	// Both decay inside a beat or two whatever window they are given, so the bar count here is
	// how long the slot is reserved rather than how long the room is lit.
	slam: { maxBars: 1 },
	bump: { maxBars: 1 }
};

/**
 * The fastest a strobe may flash, in total flashes per second.
 *
 * Taste, not safety: past this the flashes fuse into a texture and stop reading as events -
 * measured in the room at 9.4 Hz on a 140 bpm track, where the same gesture at 4.7 Hz still
 * punctuates. Eight keeps the sixteenth-note strobe up to 120 bpm, which is where the genres
 * that actually strobe in sixteenths sit, and drops everything faster to eighths. The strobe
 * effect alternates wall pairs, so any one wall runs at half this.
 */
export const STROBE_MAX_HZ = 8;

/**
 * The fastest musical subdivision that fits under `STROBE_MAX_HZ` at this track's tempo.
 *
 * One function imported by the planner that writes strobe hits and the linter that checks
 * them, because two implementations of the same ceiling is how they come to disagree - the
 * lesson `hitSeconds` and `allowedFlashes` already carry. Read off the median bpm: the burst
 * is judged over its whole length, not per drifting bar.
 */
export function strobePerBeat(tempo: { bpm: number }): number {
	// Callers on a track that changes tempo must pass the LOCAL bpm (`bpmAt`), not the
	// track median: this returns a rate per beat, and a beat is only as long as its bar.
	const beatHz = tempo.bpm / 60;
	for (const per of [4, 2]) {
		if (per * beatHz <= STROBE_MAX_HZ + 1e-9) return per;
	}
	return 1;
}

/** Song-specific effect authored for this track, admitted only after passing the gate. */
export interface GeneratedEffect {
	id: string;
	name: string;
	role: LayerRole;
	blurb: string;
	params: ParamSpec[];
	/** ES module source exporting `create(g)`. Runs sandboxed. */
	source: string;
}

export interface Show {
	version: number;
	trackId: string;
	title: string;
	/** Must match TrackAnalysis.hash. */
	analysisHash: string;
	/** The design rationale, in prose. Read by humans, not the engine. */
	brief: string;
	/**
	 * Who composed it. Optional so shows written before this field still load; a reader
	 * without it can fall back to whether the show has effects of its own, which only the
	 * agent produces.
	 *
	 * The model backends are named individually rather than lumped together as "ai": which one
	 * wrote a show is the only way to tell, months later, whether a night that looked good was
	 * worth what it cost.
	 */
	authoredBy?: 'engine' | 'claude' | 'deepseek';
	/**
	 * Which roll of the engine produced this, or the draft an agent revised.
	 *
	 * The seed defaults to the analysis hash, so a track composes to one show forever unless
	 * something asks for another. Once it can, the hash no longer identifies the composition and
	 * this is the only thing that does: without it, a show that looked good is unreachable the
	 * moment the next roll overwrites it. Optional so shows written before the field still load.
	 */
	seed?: number;
	palette: ShowPalette;
	defaults: {
		intensity: number;
		motion: number;
		fadeBeats: number;
	};
	generatedEffects: GeneratedEffect[];
	cues: Cue[];
	hits: Hit[];
}
