/** Anchor colours x 3 channels, linearly interpolated, indexed 0..1 with wrap. */
export type Palette = Float32Array;

/** Fifty anchors place every named SLOT exactly on an anchor, preserving declared colours. */
export const PALETTE_ANCHORS = 50;

/** Named palette positions keep effects coherent when the show changes hues. */
export const SLOT = {
	/** Near-black shade of the base hue. Beds decay toward this. */
	deep: 0.06,
	/** The room's home colour. */
	base: 0.22,
	/** Brighter, softer read of the base. Wash body. */
	glow: 0.38,
	/** Faintly tinted white. Peaks, flashes, meter tips. */
	white: 0.5,
	/** Texture and variety layers. */
	third: 0.64,
	/** Answers, drops, punctuation. */
	accent: 0.8,
	accentDeep: 0.94
} as const;

/** Hues in HSV degrees. Two hues 150-180 apart plus white; a third competing hue muds. */
export interface ShowPalette {
	name?: string;
	base: number;
	accent: number;
	third?: number;
	/** Body saturation. 0.94 is the sweet spot; 1.0 is reserved for accents. */
	sat?: number;
	/** Depth of the near-black beds decay into. */
	shade?: number;
	/** 0 is pure white; higher tints the highlight. */
	white?: number;
}
