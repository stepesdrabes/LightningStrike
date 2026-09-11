/**
 * void is a bounded near-silence section. verse/chorus are song readings of groove/drop;
 * sectionBase maps them back when only energy class matters.
 */
export type SectionKind =
	| 'intro'
	| 'groove'
	| 'verse'
	| 'breakdown'
	| 'build'
	| 'void'
	| 'drop'
	| 'chorus'
	| 'outro';

export const SECTION_KINDS: readonly SectionKind[] = [
	'intro',
	'groove',
	'verse',
	'breakdown',
	'build',
	'void',
	'drop',
	'chorus',
	'outro'
];

/** Map song kinds to club energy classes for shared effect eligibility. */
export function sectionBase(kind: SectionKind): SectionKind {
	return kind === 'verse' ? 'groove' : kind === 'chorus' ? 'drop' : kind;
}

/** Sub: chest thump. Low: kick body and bass. Mid: vocals and leads. Air: hats and risers. */
export const Band = { Sub: 0, Low: 1, Mid: 2, Air: 3 } as const;
export type Band = (typeof Band)[keyof typeof Band];

export const NUM_BANDS = 4;
export const BAND_EDGES_HZ = [20, 100, 400, 2600, 16000] as const;

/**
 * Twenty log-spaced bands give about two per octave. Effects use bandAt to stay independent
 * of the analyser's band count.
 */
export const SPECTRUM_BANDS = 20;

/** Mutated in place by the player. Never retain a reference across frames. */
export interface ShowFrame {
	t: number;
	/** Always use this; never assume 1/60. */
	dt: number;

	/** Edge-detected by index change, so they never double-fire. */
	beat: boolean;
	downbeat: boolean;
	phraseStart: boolean;

	beatIndex: number;
	/** The number every cue is addressed by. */
	barIndex: number;

	beatPhase: number;
	barPhase: number;
	phrasePhase: number;

	/** Effects derive time constants from this, never from bpm. */
	beatPeriod: number;
	bpm: number;

	section: SectionKind;
	sectionProgress: number;
	/** 0 outside builds; reaches exactly 1.0 on the drop downbeat. */
	buildProgress: number;
	/** Infinity when there is no next/previous drop. */
	timeToDrop: number;
	timeSinceDrop: number;

	/** Normalised across the whole track, so a breakdown reads dark. */
	energy: number;
	/** Length NUM_BANDS. Index with `Band`. */
	bands: Float32Array;
	/**
	 * Current spectrum: SPECTRUM_BANDS log-spaced values, 0..1, lowest first.
	 * Use bandAt(f, u) so effects tolerate band-count changes. See SpectrumTrack for scaling.
	 */
	spectrum: Float32Array;

	/**
	 * Pan: -1 left to +1 right; panWidth: 0 mono to 1 decorrelated.
	 * Bias positions rather than mapping directly, to avoid lurching with wide mixes.
	 */
	pan: number;
	panWidth: number;

	kick: boolean;
	snare: boolean;
	hat: boolean;

	/**
	 * Held hit envelopes. Drive brightness from these; one-frame booleans are shorter than
	 * the eye's integration window and make brightness depend on frame timing.
	 */
	kickEnv: number;
	snareEnv: number;
	hatEnv: number;
}

export function createShowFrame(): ShowFrame {
	return {
		t: 0,
		dt: 0,
		beat: false,
		downbeat: false,
		phraseStart: false,
		beatIndex: 0,
		barIndex: 0,
		beatPhase: 0,
		barPhase: 0,
		phrasePhase: 0,
		beatPeriod: 0.5,
		bpm: 120,
		section: 'intro',
		sectionProgress: 0,
		buildProgress: 0,
		timeToDrop: Infinity,
		timeSinceDrop: Infinity,
		energy: 0,
		bands: new Float32Array(NUM_BANDS),
		spectrum: new Float32Array(SPECTRUM_BANDS),
		pan: 0,
		panWidth: 0,
		kick: false,
		snare: false,
		hat: false,
		kickEnv: 0,
		snareEnv: 0,
		hatEnv: 0
	};
}
