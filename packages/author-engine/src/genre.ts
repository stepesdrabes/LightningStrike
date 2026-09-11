import type { GenreFamily, TrackAnalysis, TrackContext } from '@mv/core';

/**
 * Genre-specific palette, motion and punctuation policy; structural restraint is shared by all
 * families.
 */
export interface GenreProfile {
	/** Added to the tempo-derived palette heat before a palette is drawn. */
	heatBias: number;
	/** Width of the palette lottery around that heat. Narrow means the family has a colour. */
	heatWidth: number;
	/** Multiplies palette saturation. Above 1 forbids pastels; below 1 invites them. */
	satScale: number;
	/** Collapse the third hue onto the base; preserve the accent for the inversion event. */
	monochrome: boolean;
	/** Combined strobe/blackout budget at full track intensity. Zero forbids either gesture. */
	flashBudget: number;
	/** What marks the arrival of the biggest section. */
	peak: 'slam' | 'bloom' | 'swell';
	/** Whether a breakdown may sit near-black, or must stay a lit room playing quietly. */
	darkBreakdowns: boolean;
	/** Multiplies every cue's motion. The clock of the genre. */
	motionScale: number;
	/** Every Nth groove/verse cue carries the drum layer; 0 leaves it out entirely. */
	transientEvery: number;
	/** Phrase multiples between colour bumps in loud sections; 0 disables punctuation. */
	bumpEvery: number;
	/** Preferred non-master effect IDs. Weighting never overrides eligibility. */
	signatures: readonly string[];
	/** Disfavored effect IDs, weighted like signatures without removing them from the pool. */
	avoid: readonly string[];
	/** Excluded while any alternative fits; stronger than the avoid weight. */
	exclude: readonly string[];
	/** Keep bed/rhythm through interior cues, changing transient/accent only every second cue. */
	holdLooks: boolean;
	/** Dim builds toward the drop instead of climbing. */
	buildDims: boolean;
}

const PROFILES: Record<GenreFamily, GenreProfile> = {
	// Held, monochrome looks and kick-return punctuation, from Berghain/Tresor/Awakenings
	// lighting accounts.
	techno: { heatBias: -0.05, heatWidth: 0.3, satScale: 1.05, monochrome: true, flashBudget: 3, peak: 'slam', darkBreakdowns: true, motionScale: 1.05, transientEvery: 2, bumpEvery: 4, signatures: ['impulseSpin', 'glitchScan', 'pump', 'subThrob', 'flexStrobe'], avoid: ['moshSlam', 'headbang', 'stageBlinders', 'chorusBloom'], exclude: ['confetti', 'discoBall', 'mirrorBall', 'emberStorm', 'crownSpill', 'sparkle', 'vocalGlow', 'hueCarousel'], holdLooks: true, buildDims: true },
	// Warmer and rounder: wash blooms rather than assaults, gentle punctuation.
	house: { heatBias: 0, heatWidth: 0.24, satScale: 0.95, monochrome: false, flashBudget: 2, peak: 'bloom', darkBreakdowns: false, motionScale: 1, transientEvery: 2, bumpEvery: 2, signatures: ['impulseSpin', 'rippleTank'], avoid: ['moshSlam', 'headbang', 'doubleKickGatling'], exclude: [], holdLooks: false, buildDims: false },
	// Big-room: saturated, loud, the drop is the product.
	edm: { heatBias: 0.06, heatWidth: 0.3, satScale: 1, monochrome: false, flashBudget: 3, peak: 'slam', darkBreakdowns: true, motionScale: 1.05, transientEvery: 2, bumpEvery: 1, signatures: ['blockChase', 'snapSplit'], avoid: ['moshSlam', 'headbang'], exclude: [], holdLooks: false, buildDims: false },
	// Long builds, euphoric blooms, the longest quiet valleys of any dance genre.
	trance: { heatBias: -0.12, heatWidth: 0.2, satScale: 1, monochrome: false, flashBudget: 2, peak: 'bloom', darkBreakdowns: true, motionScale: 0.9, transientEvery: 3, bumpEvery: 2, signatures: ['pitchRibbon'], avoid: ['moshSlam', 'headbang', 'doubleKickGatling'], exclude: [], holdLooks: false, buildDims: false },
	// Bimodal: dark simmer between drops, everything at once on them.
	bass: { heatBias: -0.1, heatWidth: 0.26, satScale: 1.05, monochrome: false, flashBudget: 4, peak: 'slam', darkBreakdowns: true, motionScale: 1.1, transientEvery: 1, bumpEvery: 1, signatures: ['rollerChase'], avoid: ['confetti', 'discoBall', 'mirrorBall'], exclude: [], holdLooks: false, buildDims: false },
	// Bright, clean, chorus-driven; pastels are legal here and nowhere else.
	pop: { heatBias: 0.1, heatWidth: 0.34, satScale: 0.88, monochrome: false, flashBudget: 1, peak: 'bloom', darkBreakdowns: false, motionScale: 1, transientEvery: 2, bumpEvery: 2, signatures: ['confetti', 'blockChase', 'backbeatBloom'], avoid: ['moshSlam', 'doubleKickGatling', 'glitchScan'], exclude: [], holdLooks: false, buildDims: false },
	// High contrast, warm, blinder-shaped hits on the last chorus.
	rock: { heatBias: 0.18, heatWidth: 0.24, satScale: 1, monochrome: false, flashBudget: 1, peak: 'slam', darkBreakdowns: false, motionScale: 1.1, transientEvery: 1, bumpEvery: 2, signatures: ['stageBlinders', 'headbang', 'blockChase'], avoid: ['discoBall', 'mirrorBall'], exclude: [], holdLooks: false, buildDims: false },
	// Aggressive, snap cues, the strobe saved for the heaviest passage.
	metal: { heatBias: 0.22, heatWidth: 0.3, satScale: 1.05, monochrome: false, flashBudget: 3, peak: 'slam', darkBreakdowns: true, motionScale: 1.2, transientEvery: 1, bumpEvery: 1, signatures: ['moshSlam', 'stageBlinders'], avoid: ['confetti', 'discoBall', 'mirrorBall', 'laidbackWave'], exclude: [], holdLooks: false, buildDims: false },
	// Rock with the subtlety removed: loud, fast, undramatic.
	punk: { heatBias: 0.2, heatWidth: 0.2, satScale: 1.05, monochrome: false, flashBudget: 2, peak: 'slam', darkBreakdowns: false, motionScale: 1.3, transientEvery: 1, bumpEvery: 1, signatures: ['moshSlam', 'stageBlinders'], avoid: ['confetti', 'discoBall', 'mirrorBall', 'laidbackWave'], exclude: [], holdLooks: false, buildDims: false },
	// Held moody looks, sparse hard accents, the stop-time cut as the signature. The club
	// floor and the techno scanner are foreign: a rap chorus lit by undertow under glitchScan
	// read as "entirely blue, nothing moves and very bright" (Hovorili mi ze's last chorus).
	hiphop: { heatBias: 0.12, heatWidth: 0.22, satScale: 0.95, monochrome: false, flashBudget: 2, peak: 'slam', darkBreakdowns: false, motionScale: 0.8, transientEvery: 2, bumpEvery: 2, signatures: ['halftimeBounce', 'kitStage', 'stopTime', 'snapSplit', 'backbeatBloom'], avoid: ['moshSlam', 'headbang', 'rollerChase', 'doubleKickGatling', 'undertow', 'glitchScan'], exclude: [], holdLooks: false, buildDims: false },
	// Rich, low, smooth; swells, never hits; no flash has any business here.
	rnb: { heatBias: 0.1, heatWidth: 0.2, satScale: 0.95, monochrome: false, flashBudget: 0, peak: 'swell', darkBreakdowns: false, motionScale: 0.65, transientEvery: 3, bumpEvery: 3, signatures: [], avoid: ['moshSlam', 'headbang', 'rollerChase', 'glitchScan', 'doubleKickGatling', 'undertow'], exclude: [], holdLooks: false, buildDims: false },
	// Warm, near-still, the one sanctioned darkness is the final fade.
	ballad: { heatBias: 0.2, heatWidth: 0.18, satScale: 0.8, monochrome: false, flashBudget: 0, peak: 'swell', darkBreakdowns: false, motionScale: 0.5, transientEvery: 0, bumpEvery: 0, signatures: ['breathe'], avoid: ['moshSlam', 'headbang', 'rollerChase', 'glitchScan', 'doubleKickGatling'], exclude: [], holdLooks: false, buildDims: false },
	// Light as weather: slow drift, no beat-locked activity at all.
	ambient: { heatBias: -0.15, heatWidth: 0.3, satScale: 0.9, monochrome: false, flashBudget: 0, peak: 'swell', darkBreakdowns: true, motionScale: 0.35, transientEvery: 0, bumpEvery: 0, signatures: [], avoid: ['moshSlam', 'headbang', 'glitchScan'], exclude: [], holdLooks: false, buildDims: false },
	// Colour is the story: hot, saturated, continuously moving, never frozen.
	latin: { heatBias: 0.15, heatWidth: 0.3, satScale: 1.05, monochrome: false, flashBudget: 2, peak: 'slam', darkBreakdowns: false, motionScale: 1.1, transientEvery: 1, bumpEvery: 1, signatures: [], avoid: ['moshSlam', 'headbang', 'glitchScan'], exclude: [], holdLooks: false, buildDims: false },
	// One long pocket: warm gold base, continuous groove, strobe only as quotation.
	disco: { heatBias: 0.16, heatWidth: 0.22, satScale: 0.92, monochrome: false, flashBudget: 1, peak: 'bloom', darkBreakdowns: false, motionScale: 1, transientEvery: 1, bumpEvery: 2, signatures: ['mirrorBall', 'discoBall'], avoid: ['moshSlam', 'headbang', 'glitchScan', 'doubleKickGatling'], exclude: [], holdLooks: false, buildDims: false }
};

/** The engine's old behaviour, for a track nothing could identify. */
const DEFAULT_PROFILE: GenreProfile = {
	heatBias: 0,
	heatWidth: 0.26,
	satScale: 1,
	monochrome: false,
	flashBudget: 1,
	peak: 'slam',
	darkBreakdowns: false,
	motionScale: 1,
	transientEvery: 2,
	bumpEvery: 2,
	signatures: [],
	avoid: [],
	exclude: [],
	holdLooks: false,
	buildDims: false
};

export function profileFor(context: TrackContext | null | undefined, analysis?: TrackAnalysis): GenreProfile {
	const family = context?.genreFamily;
	const profile = family ? PROFILES[family] : DEFAULT_PROFILE;
	if (!analysis || !kitless(analysis)) return profile;
	// Kitless tracks keep their family color but inherit ballad restraint, including hard effect
	// exclusions.
	const ballad = PROFILES.ballad;
	return {
		...profile,
		flashBudget: 0,
		peak: 'swell',
		motionScale: Math.min(profile.motionScale, ballad.motionScale),
		transientEvery: 0,
		bumpEvery: 0,
		signatures: ballad.signatures,
		avoid: [...new Set([...profile.avoid, ...ballad.avoid])],
		exclude: [...new Set([...profile.exclude, ...ballad.avoid, ...KICK_BURSTS])]
	};
}

/** The kick-burst family: one gesture in six files, and nothing to answer on a record with no kit. */
export const KICK_BURSTS = ['shockwave', 'kickTunnel', 'kickCannon', 'ricochet', 'pyroBursts', 'splash'] as const;

/** Kicks and snares per bar this low, over the bars that are loud, is a record with no kit. */
const KITLESS_PER_BAR = 0.15;

/** Use drum-model bar counts so piano energy in the kick band cannot imply a kit. */
function kitless(analysis: TrackAnalysis): boolean {
	let hits = 0;
	let loud = 0;
	for (const row of analysis.bars) {
		if (row.energy < 60) continue;
		hits += row.kicks + row.snares;
		loud++;
	}
	return loud >= 8 && hits / loud < KITLESS_PER_BAR;
}

/**
 * Shared planner/linter allowance. Kick density and crest compare tracks; normalized energy
 * cannot.
 */
export function allowedFlashes(
	analysis: TrackAnalysis,
	context: TrackContext | null | undefined
): number {
	const profile = profileFor(context, analysis);
	if (profile.flashBudget === 0) return 0;

	let kicks = 0;
	let loudBars = 0;
	for (const row of analysis.bars) {
		if (row.energy < 60) continue;
		kicks += row.kicks;
		loudBars++;
	}
	const density =
		loudBars > 0 ? kicks / loudBars / Math.max(1, analysis.tempo.beatsPerBar) : 0;
	// Slow songs suppress flashes except in half-time families, where a 75 bpm grid is normal.
	const halftime = context?.genreFamily === 'hiphop' || context?.genreFamily === 'bass';
	if (analysis.tempo.bpm < 90 && !halftime) return 0;
	// Density 1 is four-on-the-floor; half that already reads as driving in a song. The
	// scale bottoms at 0.35 rather than zero: a genre that flashes keeps at least the one.
	const scale = Math.max(0.35, Math.min(1, density / 0.9));
	return Math.max(1, Math.round(profile.flashBudget * scale));
}
