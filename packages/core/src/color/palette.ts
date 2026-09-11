import type { Palette, ShowPalette } from '../contracts/palette.ts';
import { PALETTE_ANCHORS, SLOT } from '../contracts/palette.ts';
import { clamp, frac, lerpAngle01 } from '../dsl/math.ts';
import { hsv2rgb } from './hsv.ts';

interface Key {
	u: number;
	h: number;
	s: number;
	v: number;
}

const RGB_SCRATCH: [number, number, number] = [0, 0, 0];

/** Refilled per call, ascending. Same reason as `RGB_SCRATCH`, one level up. */
const KEYS: Key[] = [
	SLOT.deep,
	SLOT.base,
	SLOT.glow,
	SLOT.white,
	SLOT.third,
	SLOT.accent,
	SLOT.accentDeep
].map((u) => ({ u, h: 0, s: 0, v: 0 }));

function set(key: Key, h: number, s: number, v: number): void {
	key.h = h;
	key.s = s;
	key.v = v;
}

/** Lay a show's three hues onto the named slots and fill 16 anchors between them. */
export function makePalette(p: ShowPalette): Palette {
	return writePalette(new Float32Array(PALETTE_ANCHORS * 3), p);
}

/** Write into a caller-owned palette for allocation-free colour updates. */
export function writePalette(out: Palette, p: ShowPalette): Palette {
	const sat = clamp(p.sat ?? 0.94, 0, 1);
	const shade = clamp(p.shade ?? 0.08, 0, 0.4);
	const whiteS = clamp(p.white ?? 0.06, 0, 0.5);
	const base = frac(p.base / 360);
	const accent = frac(p.accent / 360);
	const third = frac((p.third ?? p.accent) / 360);

	const keys = KEYS;
	set(keys[0], base, sat, shade);
	set(keys[1], base, sat, 1);
	set(keys[2], base, sat * 0.72, 1);
	set(keys[3], base, whiteS, 1);
	set(keys[4], third, sat, 0.95);
	set(keys[5], accent, sat, 1);
	set(keys[6], accent, sat, shade * 1.6);

	for (let i = 0; i < PALETTE_ANCHORS; i++) {
		const u = i / PALETTE_ANCHORS;

		let a = keys[keys.length - 1];
		let b = keys[0];
		let au = a.u - 1;
		let bu = b.u;

		for (let k = 0; k < keys.length; k++) {
			const next = keys[k + 1];
			if (u >= keys[k].u && (!next || u < next.u)) {
				a = keys[k];
				b = next ?? keys[0];
				au = a.u;
				bu = next ? next.u : keys[0].u + 1;
				break;
			}
		}

		const t = bu === au ? 0 : (u - au) / (bu - au);
		const h = lerpAngle01(a.h, b.h, t);
		const s = a.s + (b.s - a.s) * t;
		const v = a.v + (b.v - a.v) * t;

		hsv2rgb(h, s, v, RGB_SCRATCH);
		out[i * 3] = RGB_SCRATCH[0];
		out[i * 3 + 1] = RGB_SCRATCH[1];
		out[i * 3 + 2] = RGB_SCRATCH[2];
	}

	return out;
}

/** Degrees, folded into 0..360. */
export function wrapHue(h: number): number {
	return ((h % 360) + 360) % 360;
}

/** Shortest way round the wheel, so a midpoint stays saturated instead of passing through grey. */
export function lerpHue(from: number, to: number, u: number): number {
	const d = ((((to - from) % 360) + 540) % 360) - 180;
	return wrapHue(from + d * u);
}

/** Swap base and accent. The one colour event a disciplined show usually gets. */
export function swapped(p: ShowPalette): ShowPalette {
	return { ...p, base: p.accent, accent: p.base };
}

export function sample(
	p: Palette,
	u: number,
	brightness = 1,
	out: [number, number, number] = RGB_SCRATCH
): [number, number, number] {
	const pos = frac(u) * PALETTE_ANCHORS;
	const a = Math.floor(pos);
	const b = (a + 1) % PALETTE_ANCHORS;
	const f = pos - a;
	const ai = a * 3;
	const bi = b * 3;
	out[0] = (p[ai] + (p[bi] - p[ai]) * f) * brightness;
	out[1] = (p[ai + 1] + (p[bi + 1] - p[ai + 1]) * f) * brightness;
	out[2] = (p[ai + 2] + (p[bi + 2] - p[ai + 2]) * f) * brightness;
	return out;
}

/** Allocation-free write into a pixel buffer. */
export function setSample(
	buf: Float32Array,
	i: number,
	p: Palette,
	u: number,
	brightness: number
): void {
	sample(p, u, brightness, RGB_SCRATCH);
	const o = i * 3;
	buf[o] = RGB_SCRATCH[0];
	buf[o + 1] = RGB_SCRATCH[1];
	buf[o + 2] = RGB_SCRATCH[2];
}

export function addSample(
	buf: Float32Array,
	i: number,
	p: Palette,
	u: number,
	brightness: number
): void {
	sample(p, u, brightness, RGB_SCRATCH);
	const o = i * 3;
	buf[o] += RGB_SCRATCH[0];
	buf[o + 1] += RGB_SCRATCH[1];
	buf[o + 2] += RGB_SCRATCH[2];
}

export function blendPalettes(dst: Palette, a: Palette, b: Palette, t: number): Palette {
	for (let i = 0; i < dst.length; i++) dst[i] = a[i] + (b[i] - a[i]) * t;
	return dst;
}
