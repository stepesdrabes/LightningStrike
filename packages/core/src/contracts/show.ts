import type { SectionKind } from './frame.ts';
import type { LayerRole, ParamSpec, Params } from './effect.ts';
import type { ShowPalette } from './palette.ts';

export const SHOW_VERSION = 34;

export interface LayerSpec {
	effect: string;
	opacity?: number;
	params?: Params;
}

/** 'swap' exchanges base and accent: the classic one-colour-event drop move. */
export type CuePalette = ShowPalette | 'swap' | 'inherit';

/** Cues use validated bar indices, never model-invented timestamps. */
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
	 * Beat within the bar, 0-indexed, default 0. Enables short pre-drop gestures ending on a
	 * downbeat.
	 */
	beat?: number;
	/** bump is an accent-colour flood, allowing punctuation without another flash. */
	kind: 'slam' | 'strobe' | 'blackout' | 'bump';
	beats: number;
	/** Overrides on the hit's effect, e.g. strobe `perBeat`. The linter reads these. */
	params?: Params;
	note?: string;
}

interface HitRule {
	/** Longest the gesture may hold the room, in bars. */
	maxBars: number;
	/**
	 * Maximum seconds for held gestures. Self-decaying effects omit this because their hit
	 * length reserves the slot rather than defining visible duration.
	 */
	maxSeconds?: number;
}

/**
 * Bound gesture length in bars and seconds so slow tempos cannot prolong punctuation.
 * Flash rate is separately capped by strobePerBeat.
 */
export const HIT_RULES: Record<Hit['kind'], HitRule> = {
	// Keep blackout brief: several seconds of unsoftened darkness reads as a failure.
	blackout: { maxBars: 2, maxSeconds: 2.2 },
	// A bar at most so strobe remains an announcement; the planner uses half.
	strobe: { maxBars: 1, maxSeconds: 2 },
	// Self-decaying gestures: bars reserve the master slot, not the visible light.
	slam: { maxBars: 1 },
	bump: { maxBars: 1 }
};

/**
 * Maximum total flashes/second, a perceptual limit rather than a safety guarantee.
 * Above 6 Hz the room reads as flickering texture; alternating wall pairs each run at
 * half-rate.
 */
export const STROBE_MAX_HZ = 6;

/** Fastest musical subdivision under STROBE_MAX_HZ, shared by planner and linter. */
export function strobePerBeat(tempo: { bpm: number }): number {
	// Pass local bpmAt on variable-tempo tracks; the result is a rate per beat.
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
	/** Plain JavaScript declaring create(g), evaluated with the injected DSL. */
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
	 * Composer backend. Legacy shows omit this and may infer AI authorship from generated
	 * effects.
	 */
	authoredBy?: 'engine' | 'claude' | 'deepseek';
	/**
	 * Engine seed, or seed of the draft AI revised, retained for reproducible rerolls.
	 * Absent on legacy shows; default seed is the analysis hash.
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
