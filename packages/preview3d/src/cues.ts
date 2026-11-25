import { mountNormal, type LightPixels, type MatrixLight, type Vec3 } from '@mv/core';
import { lengthOf, pointAt, tangentAt, type StripPiece } from './strips.ts';
import { lerp, normalize, scale, sub } from './vec.ts';

/** Metres between chevrons along a strip. */
const CHEVRON_SPACING = 0.4;
/** Chevrons along each of a matrix's first lines, at most. */
const PANEL_CHEVRONS = 12;
const TAU = Math.PI * 2;

/** An arrowhead on a light, pointing the way its data runs. */
export interface Chevron {
	at: Vec3;
	dir: Vec3;
	/** The way the light faces. */
	normal: Vec3;
}

/** The LED a light's data enters at: its first, or its last when wired from the far end. */
export function entryLed(pixels: LightPixels): number {
	return pixels.light.wiring?.reversed ? pixels.index.length - 1 : 0;
}

export function ledAt(pixels: LightPixels, i: number): Vec3 {
	const p = pixels.position;
	return [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
}

/** Evenly along each piece of a path or ring, at least three round a whole ring. */
export function stripChevrons(pieces: readonly StripPiece[], reversed: boolean): Chevron[] {
	const out: Chevron[] = [];
	for (const p of pieces) {
		const length = lengthOf(p.shape);
		if (length < 1e-6) continue;
		const turns = p.shape.kind === 'arc' ? Math.abs(p.shape.sweep) / TAU : 0;
		const spaced = Math.round(length / CHEVRON_SPACING);
		const count = Math.max(1, Math.ceil(3 * turns - 1e-9), spaced);
		for (let k = 0; k < count; k++) {
			const x = (k + 0.5) / count;
			const along = tangentAt(p.shape, x);
			const dir = reversed ? scale(along, -1) : along;
			out.push({ at: pointAt(p.shape, x), dir, normal: p.normal });
		}
	}
	return out;
}

/**
 * Between LEDs along the first two lines a matrix's data walks, which shows the corner it starts
 * from, the way it runs, and whether the next line comes back.
 */
export function panelChevrons(light: MatrixLight, pixels: LightPixels): Chevron[] {
	const n = pixels.index.length;
	const entry = entryLed(pixels);
	const at = (d: number) => ledAt(pixels, entry === 0 ? d : n - 1 - d);
	const line = light.horizontal ? light.columns : light.rows;
	const lines = light.horizontal ? light.rows : light.columns;
	// Lines of one LED step across the panel, so their LEDs make the first line instead.
	const length = line > 1 ? line : Math.min(n, PANEL_CHEVRONS + 1);
	const walked = line > 1 ? Math.min(2, lines) : 1;
	const gaps = Math.min(length - 1, PANEL_CHEVRONS);
	const normal = mountNormal(light.mount);

	const out: Chevron[] = [];
	for (let l = 0; l < walked; l++) {
		for (let k = 0; k < gaps; k++) {
			const s = l * length + Math.floor(((k + 0.5) * (length - 1)) / gaps);
			const a = at(s);
			const b = at(s + 1);
			out.push({ at: lerp(a, b, 0.5), dir: normalize(sub(b, a)), normal });
		}
	}
	return out;
}
