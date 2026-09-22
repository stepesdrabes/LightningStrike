import type { LampLight, Vec3 } from '@mv/core';
import { atlasU, atlasV, type AtlasLayout } from './atlas.ts';
import { LIGHTING } from './lighting.ts';
import { lengthOf, pointAt, type ArcShape, type StripPiece } from './strips.ts';
import { length, sub } from './vec.ts';

/**
 * WebGL2 guarantees 224 fragment vec4s. Lines take three each and points three with their
 * colour, which leaves the rest of the surface shader room at these caps.
 */
export const MAX_LINES = 24;
export const MAX_POINTS = 8;

/** Texture taps per surface fragment, shared by every line; the Frame's five keep eight each. */
const TAP_BUDGET = 96;
const MAX_SAMPLES = 8;
const MIN_SAMPLES = 4;

/** Metres of ring per chord its spill is walked along. */
const CHORD = 0.5;
const MAX_CHORDS = 8;
const TAU = Math.PI * 2;

/** A straight stretch of LEDs lighting the room, walked in samples by the surface shader. */
export interface LineEmitter {
	a: Vec3;
	b: Vec3;
	normal: Vec3;
	/** Atlas u at `a`, its change from `a` to `b`, and the row's v. */
	u: number;
	du: number;
	v: number;
	/** Metres, which rank lines when there are more than the shader takes. */
	weight: number;
}

export interface PointEmitter {
	at: Vec3;
	/** Square metres added to the squared distance: the source's own size softens its falloff. */
	soft: number;
	/** Null for a source that throws light all round. */
	normal: Vec3 | null;
	/** Spill per unit of colour, which also ranks points over the cap. */
	gain: number;
}

/** Every piece as lines: a straight run whole, an arc as chords. */
export function lineEmitters(pieces: readonly StripPiece[], atlas: AtlasLayout): LineEmitter[] {
	const out: LineEmitter[] = [];
	pieces.forEach((p, i) => {
		const slot = atlas.slots[i];
		const at = (x: number) => atlasU(atlas, slot, p.count, x);
		const v = atlasV(atlas, slot);
		const { shape, normal } = p;
		if (shape.kind === 'line') {
			const weight = lengthOf(shape);
			if (weight < 1e-6) return;
			// First LED at `a` and last at `b`, as the Frame's spill has always been walked.
			const u = at(0.5 / p.count);
			const du = at(1 - 0.5 / p.count) - u;
			out.push({ a: shape.a, b: shape.b, normal, u, du, v, weight });
			return;
		}
		const chords = chordsOf(shape);
		for (let c = 0; c < chords; c++) {
			const x0 = c / chords;
			const x1 = (c + 1) / chords;
			const a = pointAt(shape, x0);
			const b = pointAt(shape, x1);
			const weight = length(sub(b, a));
			out.push({ a, b, normal, u: at(x0), du: at(x1) - at(x0), v, weight });
		}
	});
	return out;
}

/** One chord per half metre of arc, at least three round a whole ring and at most eight. */
export function chordsOf(shape: ArcShape): number {
	const turns = Math.abs(shape.sweep) / TAU;
	const byLength = Math.min(MAX_CHORDS, Math.round(lengthOf(shape) / CHORD));
	return Math.max(1, Math.ceil(3 * turns - 1e-9), byLength);
}

/** A summary lamp's tube or bulb, or a pixel lamp's bulb. */
export function lampEmitter(lamp: LampLight): PointEmitter {
	if (lamp.mode === 'summary' && lamp.height > 0) {
		return {
			at: [lamp.at[0], lamp.at[1], lamp.at[2] + lamp.height / 2],
			// The column's own emitting area, as the radius its inverse square softens over.
			// Without it the two walls it stands against take a hot point rather than the broad
			// wash a metre of diffuser actually throws.
			soft: lamp.height * lamp.height * 0.25,
			normal: null,
			gain: LIGHTING.lampSpill * lamp.height
		};
	}
	const r = lamp.diameter / 2;
	return { at: bulbCentre(lamp), soft: r * r, normal: null, gain: LIGHTING.bulbSpill };
}

/** Where a bulb glows: the top of its lamp, which is its base when it has no height. */
export function bulbCentre(lamp: LampLight): Vec3 {
	return [lamp.at[0], lamp.at[1], lamp.at[2] + lamp.height];
}

/** The texture taps a line gets when `lines` share the fragment's budget. */
export function samplesFor(lines: number): number {
	if (lines === 0) return 0;
	return Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.floor(TAP_BUDGET / lines)));
}

/** The heaviest `cap` items, in their original order. */
export function strongest<T>(list: readonly T[], cap: number, weight: (item: T) => number): T[] {
	if (list.length <= cap) return [...list];
	return list
		.map((_, i) => i)
		.sort((i, j) => weight(list[j]) - weight(list[i]) || i - j)
		.slice(0, cap)
		.sort((i, j) => i - j)
		.map((i) => list[i]);
}

/** Three vec4 per line: [a, u], [b, du], [normal, v]. */
export function packLines(lines: readonly LineEmitter[]): Float32Array {
	const out = new Float32Array(lines.length * 12);
	lines.forEach((l, i) => out.set([...l.a, l.u, ...l.b, l.du, ...l.normal, l.v], i * 12));
	return out;
}

/** Two vec4 per point: [position, soft], [normal, or zero for none, gain]. */
export function packPoints(points: readonly PointEmitter[]): Float32Array {
	const out = new Float32Array(points.length * 8);
	points.forEach((p, i) => out.set([...p.at, p.soft, ...(p.normal ?? [0, 0, 0]), p.gain], i * 8));
	return out;
}
