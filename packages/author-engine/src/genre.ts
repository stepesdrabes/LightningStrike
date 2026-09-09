import type { GenreFamily, TrackAnalysis, TrackContext } from '@mv/core';

/**
 * How each genre family is lit. Distilled from how working designers actually light these
 * rooms, compressed to the dials this engine owns. The rows encode the disagreements that
 * are genuinely genre - flash budget, blackout grammar, palette discipline, how a peak is
 * marked - and none of the universals, which stay hard-coded where they always were:
 * contrast is earned in the valleys, cues land on structure, the biggest card goes to the
 * biggest moment.
 */
export interface GenreProfile {
	/** Added to the tempo-derived palette heat before a palette is drawn. */
	heatBias: number;
	/** Width of the palette lottery around that heat. Narrow means the family has a colour. */
	heatWidth: number;
	/** Multiplies palette saturation. Above 1 forbids pastels; below 1 invites them. */
	satScale: number;
	/**
	 * One hue and white. The third slot collapses onto the base so nothing mid-show can
	 * introduce a second colour; the accent survives for the single inversion event.
	 */
	monochrome: boolean;
	/**
	 * Flashes (strobes + blackouts) a show may spend at full track energy. Scaled down by
	 * the track's own measured intensity, floored at zero. Zero means the family forbids
	 * the gesture outright and the room never flashes, whatever the track does.
	 */
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
	/**
	 * Effects that ARE this family's look, preferred by the picker wherever they are legal.
	 * A weight, never a filter: an id that does not exist in the catalog simply never wins.
	 * Non-master roles only - the peak master is chosen by seed alone, deliberately, so a
	 * master listed here would be dead weight pretending to matter. genre.test.ts holds the
	 * rows to both halves of that: every id must resolve, and never to a master.
	 */
	signatures: readonly string[];
	/**
	 * Effects that are NOT this family's vocabulary, dispreferred by the same order of
	 * weight. The mirror of `signatures` and under the same law - never a filter. This is
	 * what stops a Czech rap verse reaching for moshSlam, headbang and the DnB roller just
	 * because they fit the energy band: the profiles steered palette and motion while the
	 * effect pool stayed genre-blind, and 61% of the owner's corpus is the two families
	 * with the thinnest signature lists.
	 */
	avoid: readonly string[];
	/**
	 * The hard form of `avoid`: never picked while anything else fits. Only techno uses it,
	 * for the decorations and hue cycles no techno floor has ever been lit by; a weight cannot
	 * keep them out of a drop whose top band holds two other accents.
	 */
	exclude: readonly string[];
	/**
	 * Interior cues keep the section's bed and rhythm layer and move only the transient or
	 * accent, every second cue. Techno is lit by holding a look and taking things away or
	 * adding one, not by re-staging every two phrases: the owner heard eight-bar re-picks on
	 * a techno track as "the effects are just off", and every club lighting account on record
	 * (Berghain, Panorama Bar, Awakenings) describes looks held across whole sections with one
	 * parameter moving at a time.
	 */
	holdLooks: boolean;
	/**
	 * A build DIMS toward the drop instead of climbing: the room goes darker through the
	 * riser and the return arrives out of near-black. The techno grammar; every other family
	 * climbs.
	 */
	buildDims: boolean;
}

const PROFILES: Record<GenreFamily, GenreProfile> = {
	// One hue or white, darkness as the bed, looks held across whole sections and moved one
	// layer at a time; the strobe is punctuation on the kick's return, not a texture. Drawn from
	// the Berghain, Panorama Bar, Tresor and Awakenings lighting accounts (2026-09-08 research):
	// the rock and pop gestures are foreign here, so are twinkles, blooms and any hue cycle.
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
	// A track with no kit at all is a ballad whatever its metadata says: Someone You Loved
	// files under rock and got glitch and pyro in its verses. The family keeps its colour;
	// the restraint is the ballad's - nothing that flashes, punches or answers a drum - and
	// it is hard here, because an avoided effect is still picked when the pool runs dry.
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

/**
 * Whether the drum streams are silent across the loud bars. Read from the analysis's bar
 * table, which the drum model wrote, so a piano note in the kick band cannot vote.
 */
export function kitless(analysis: TrackAnalysis): boolean {
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
 * How many flashes this track has earned: the genre's budget scaled by how hard the track
 * actually goes. Energy is normalised within a track, so the scale reads kick density and
 * crest instead - a relentless track keeps the family budget, a mellow one loses most of it.
 *
 * One place, imported by the planner that spends the budget and the linter that enforces
 * it, because two implementations of the same allowance is how they come to disagree.
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
	// A slow song is a ballad whatever its family says: Iris files under rock, and a strobe
	// into its chorus reads as a rig fault. The felt tempo is trustworthy here because the
	// compound-meter guard has already put slow songs at their real pulse. The half-time
	// families are exempt - a 75 bpm grid is trap's and dubstep's natural reading, and
	// their flashes belong to them. Kick density cannot arbitrate this: an acoustic strum
	// lands in the kick band and Iris out-counts Enter Sandman.
	const halftime = context?.genreFamily === 'hiphop' || context?.genreFamily === 'bass';
	if (analysis.tempo.bpm < 90 && !halftime) return 0;
	// Density 1 is four-on-the-floor; half that already reads as driving in a song. The
	// scale bottoms at 0.35 rather than zero: a genre that flashes keeps at least the one.
	const scale = Math.max(0.35, Math.min(1, density / 0.9));
	return Math.max(1, Math.round(profile.flashBudget * scale));
}
