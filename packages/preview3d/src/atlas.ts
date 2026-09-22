import type { LightPixels } from '@mv/core';
import { ATLAS_WIDTH, type StripPiece } from './strips.ts';

/** A piece's texels: its leading guard's column, and its row. */
export interface AtlasSlot {
	x: number;
	row: number;
}

export interface AtlasLayout {
	width: number;
	height: number;
	/** One per piece, in piece order. */
	slots: AtlasSlot[];
	/** Effect-buffer LED per texel: -1 for none, and -(led + 2) for a guard repeating one. */
	source: Int32Array;
	/** Each texel's light level, when some light is dimmed. */
	level: Float32Array | null;
}

/**
 * Pack pieces into rows as [guard, LEDs, guard]. Samples stay between the guards' centres, so
 * linear filtering blends a piece's ends like its middle and never reaches a neighbour.
 */
export function layoutAtlas(
	pieces: readonly StripPiece[],
	pixels: readonly LightPixels[]
): AtlasLayout {
	const total = pieces.reduce((n, p) => n + p.count + 2, 0);
	const width = Math.max(1, Math.min(ATLAS_WIDTH, total));
	const slots: AtlasSlot[] = [];
	let x = 0;
	let row = 0;
	for (const p of pieces) {
		if (x + p.count + 2 > width) {
			row++;
			x = 0;
		}
		slots.push({ x, row });
		x += p.count + 2;
	}

	const height = row + 1;
	const source = new Int32Array(width * height).fill(-1);
	const dimmed = pieces.some((p) => (pixels[p.light].light.level ?? 1) < 1);
	const level = dimmed ? new Float32Array(width * height).fill(1) : null;
	pieces.forEach((p, i) => {
		const { index, light } = pixels[p.light];
		const at = slots[i].row * width + slots[i].x;
		const guard = (led: number) => (index[led] >= 0 ? -(index[led] + 2) : -1);
		source[at] = guard(p.before);
		for (let k = 0; k < p.count; k++) source[at + 1 + k] = index[p.from + k];
		source[at + p.count + 1] = guard(p.after);
		if (level) level.fill(light.level ?? 1, at, at + p.count + 2);
	});
	return { width, height, slots, source, level };
}

/** Atlas u at x = 0..1 across a piece's cells; LED k's texel centre is at x = (k + 0.5) / count. */
export function atlasU(layout: AtlasLayout, slot: AtlasSlot, count: number, x: number): number {
	return (slot.x + 1 + x * count) / layout.width;
}

export function atlasV(layout: AtlasLayout, slot: AtlasSlot): number {
	return (slot.row + 0.5) / layout.height;
}
