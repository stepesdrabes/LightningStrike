import type { ShowPalette, TrackAnalysis } from '@mv/core';
import { NAMED_PALETTES, Rng, rampHueFor, wrapHue } from '@mv/core';
import type { GenreProfile } from './genre.ts';

/**
 * Weight by absolute tempo, key and mastering dynamics; track-normalized energy cannot
 * distinguish records.
 */
export function choosePalette(
	analysis: TrackAnalysis,
	rng: Rng,
	artHue?: number | null,
	profile?: GenreProfile,
	/**
	 * For later songs in a medley, use their tempo/key and separate the base from the preceding
	 * palette.
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
	const weights = NAMED_PALETTES.map((p) => {
		const w = Math.exp(-0.5 * ((p.heat - heat) / width) ** 2);
		total += w;
		return w;
	});

	let pick = rng.float() * total;
	let index = 0;
	for (let i = 0; i < NAMED_PALETTES.length; i++) {
		pick -= weights[i];
		if (pick <= 0) {
			index = i;
			break;
		}
	}
	const choice = NAMED_PALETTES[index];
	const fromArt = own === undefined && artHue !== undefined && artHue !== null;

	// Rotate the whole palette to preserve hue spacing. Artwork HSV must convert to ramp
	// coordinates;
	// without artwork, tonic supplies a small rotation.
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

