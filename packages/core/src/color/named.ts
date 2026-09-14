import type { ShowPalette } from '../contracts/palette.ts';

export interface NamedPalette extends ShowPalette {
	name: string;
	third: number;
	/** Where on the cool-to-hot axis this palette belongs, 0..1. */
	heat: number;
}

/**
 * Three-hue palettes that keep base and accent complementary. The engine weights them by heat;
 * evening files name them. Spread around the wheel so similar tempos still vary.
 */
export const NAMED_PALETTES: readonly NamedPalette[] = [
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
