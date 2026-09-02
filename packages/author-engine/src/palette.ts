import type { ShowPalette, TrackAnalysis } from '@mv/core';
import { Rng, rampHueFor, wrapHue } from '@mv/core';
import type { GenreProfile } from './genre.ts';

/**
 * The palette library, base first. Every base and accent are 140-180 degrees apart, which is
 * what makes colour read as emotion rather than as decoration.
 *
 * Three hues, not two. Base and accent carry the argument; the third is what the room turns to
 * when it wants to look like somewhere else without abandoning its identity, and sections
 * promote it rather than inventing a fourth.
 */
interface PaletteChoice extends ShowPalette {
	name: string;
	third: number;
	/** Where on the cool-to-hot axis this palette belongs, 0..1. */
	heat: number;
}

/**
 * Twenty of them, with base hues walked around the whole wheel rather than clustered.
 *
 * The spread is the point. Ten palettes chosen by nearest-heat put every four-on-the-floor
 * track in the same three, and the room looked like it owned four colours.
 */
const PALETTES: PaletteChoice[] = [
	{ name: 'glacier', base: 196, accent: 22, third: 168, sat: 0.86, shade: 0.2, heat: 0.05 },
	{ name: 'ice', base: 190, accent: 8, third: 230, sat: 0.88, shade: 0.18, heat: 0.12 },
	{ name: 'deep sea', base: 205, accent: 28, third: 168, sat: 0.92, shade: 0.14, heat: 0.18 },
	{ name: 'moss', base: 132, accent: 300, third: 66, sat: 0.84, shade: 0.19, heat: 0.22 },
	{ name: 'indigo', base: 252, accent: 62, third: 205, sat: 0.9, shade: 0.17, heat: 0.28 },
	{ name: 'menthol', base: 168, accent: 320, third: 205, sat: 0.9, shade: 0.15, heat: 0.32 },
	{ name: 'ultraviolet', base: 268, accent: 88, third: 320, sat: 0.94, shade: 0.16, heat: 0.36 },
	{ name: 'jade', base: 155, accent: 340, third: 190, sat: 0.9, shade: 0.15, heat: 0.4 },
	{ name: 'sodium night', base: 222, accent: 42, third: 288, sat: 0.95, shade: 0.12, heat: 0.44 },
	{ name: 'orchid', base: 292, accent: 118, third: 330, sat: 0.93, shade: 0.14, heat: 0.48 },
	{ name: 'gold room', base: 38, accent: 214, third: 330, sat: 0.93, shade: 0.12, heat: 0.52 },
	{ name: 'rosewood', base: 336, accent: 156, third: 12, sat: 0.91, shade: 0.15, heat: 0.56 },
	{ name: 'magenta bloom', base: 312, accent: 158, third: 268, sat: 0.95, shade: 0.13, heat: 0.6 },
	{ name: 'copper', base: 24, accent: 200, third: 320, sat: 0.94, shade: 0.12, heat: 0.64 },
	{ name: 'lime rig', base: 88, accent: 268, third: 44, sat: 0.95, shade: 0.13, heat: 0.68 },
	{ name: 'hot pink', base: 328, accent: 148, third: 20, sat: 0.97, shade: 0.11, heat: 0.72 },
	{ name: 'acid', base: 74, accent: 250, third: 168, sat: 0.96, shade: 0.12, heat: 0.76 },
	{ name: 'ember', base: 18, accent: 196, third: 44, sat: 0.96, shade: 0.1, heat: 0.82 },
	{ name: 'siren', base: 348, accent: 178, third: 24, sat: 0.97, shade: 0.11, heat: 0.88 },
	{ name: 'blood orange', base: 8, accent: 186, third: 40, sat: 0.98, shade: 0.09, heat: 0.95 }
];

/**
 * Pick a palette from what the track is, then vary it a little.
 *
 * Everything fed in here is an absolute property of the recording. That is a correction, not a
 * preference: the obvious inputs - section energy, peak energy - are normalised across the
 * track, so the loudest passage of every track reads about the same and the palette barely
 * moved. Tempo, mode and how squashed the master is do vary between records.
 *
 * The choice is then weighted-random rather than nearest, so the seed genuinely decides among
 * everything plausible. Nearest-heat is what made ten palettes behave like three.
 */
export function choosePalette(
	analysis: TrackAnalysis,
	rng: Rng,
	artHue?: number | null,
	profile?: GenreProfile,
	/**
	 * One song of a track that is several: its own tempo and key decide the heat, the cover
	 * does not anchor it (the sleeve belongs to the record, and the first song wears it), and
	 * the base is kept a clear step away from the song before, so the switch reads as a
	 * change of room.
	 */
	own?: { bpm: number; key: TrackAnalysis['key']; awayFrom: number }
): ShowPalette {
	const bpm = own?.bpm ?? analysis.tempo.bpm;
	const key = own?.key ?? analysis.key;

	// Tempo carries most of it. 90 is a room at rest and 175 is one that is not, and unlike
	// every energy figure in the analysis it means the same thing from one track to the next.
	let heat = Math.max(0, Math.min(1, (bpm - 90) / 85));

	// Mode is the one colour convention an audience reads without being taught - and it works
	// through saturation and lightness far more than through hue, so the mode nudge is small
	// next to the genre's own bias.
	if (key.confidence > 0.55) heat += key.mode === 'major' ? 0.14 : -0.1;
	// A squashed master has no dynamics for the lighting to follow, so colour does more work.
	if (analysis.peakToLoudness < 9) heat += 0.08;
	// A wide loudness range means the arrangement is already doing the shouting.
	if (analysis.loudnessRange > 8) heat -= 0.08;
	heat += profile?.heatBias ?? 0;
	heat = Math.max(0, Math.min(1, heat));

	// Every palette stays in the running; heat only bends the odds. The width is the genre's:
	// a narrow family has a colour of its own, a wide one lets the seed roam.
	const width = profile?.heatWidth ?? 0.26;
	let total = 0;
	const weights = PALETTES.map((p) => {
		const w = Math.exp(-0.5 * ((p.heat - heat) / width) ** 2);
		total += w;
		return w;
	});

	let pick = rng.float() * total;
	let index = 0;
	for (let i = 0; i < PALETTES.length; i++) {
		pick -= weights[i];
		if (pick <= 0) {
			index = i;
			break;
		}
	}
	const choice = PALETTES[index];
	const fromArt = own === undefined && artHue !== undefined && artHue !== null;

	// The cover wins when there is one. The whole palette rotates rather than the base being
	// overwritten, so the 140-180 degrees between base and accent survive exactly: a yellow
	// sleeve gets a yellow room with the same complementary answer the palette was built with.
	// Without a cover the tonic rotates the story by up to fifteen degrees instead, so two
	// tracks landing on the same palette in different keys still light the room differently.
	// The cover's hue is measured in textbook HSV; the palette's hues are ramp coordinates, and the
	// two are different curves rather than a rotation of each other. Converting is not a nicety:
	// declared 90 is delivered as 60, so a chartreuse sleeve lit the room yellow and the palette
	// looked like it had ignored the artwork.
	let shift = fromArt
		? ((rampHueFor(artHue as number) * 360 - choice.base) % 360 + 360) % 360
		: key.confidence > 0.5
			? (key.tonic / 12) * 30 - 15
			: 0;
	// A second song that lands within a sixth of the wheel of the one before it would read
	// as the same room; a quarter turn keeps the base and accent geometry and moves both.
	if (own) {
		const apart = Math.abs((((wrapHue(choice.base + shift) - own.awayFrom) % 360) + 540) % 360 - 180);
		if (apart < 60) shift += 90;
	}

	// The genre's saturation discipline: pop may pastel, techno may not, and a monochrome
	// family folds the third hue back onto the base so nothing mid-show can introduce a
	// second colour - the accent survives for the single inversion event.
	const sat = Math.max(0.3, Math.min(1, (choice.sat ?? 0.94) * (profile?.satScale ?? 1)));
	const base = wrapHue(choice.base + shift);
	return {
		// The curated name describes a hue the palette no longer sits on once it has been turned
		// onto the cover, and that name is what the brief tells a reader the room looks like.
		name: fromArt ? `${hueName(base)} from the cover` : choice.name,
		base,
		accent: wrapHue(choice.accent + shift),
		third: profile?.monochrome ? base : wrapHue(choice.third + shift),
		sat,
		shade: choice.shade
	};
}

const HUE_NAMES = [
	[15, 'red'], [45, 'orange'], [70, 'yellow'], [100, 'lime'], [150, 'green'], [175, 'sea green'],
	[200, 'cyan'], [225, 'azure'], [255, 'blue'], [280, 'violet'], [310, 'purple'], [340, 'magenta']
] as const;

function hueName(h: number): string {
	for (const [edge, name] of HUE_NAMES) if (h < edge) return name;
	return 'red';
}

