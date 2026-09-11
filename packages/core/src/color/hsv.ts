import { clamp, frac } from '../dsl/math.ts';

const T = 1 / 3;
const C171 = 171 / 255;

/**
 * FastLED rainbow ramp: widened yellow reads better on LEDs than textbook HSV.
 * Value remains linear; gamma belongs to the output stage.
 */
export function hsv2rgb(
	h: number,
	s: number,
	v: number,
	out: [number, number, number] = [0, 0, 0]
): [number, number, number] {
	const hh = frac(h) * 8;
	const section = Math.floor(hh);
	const t = hh - section;
	const third = t * T;
	const twoThirds = t * (2 * T);

	let r: number;
	let g: number;
	let b: number;

	switch (section) {
		case 0:
			r = 1 - third;
			g = third;
			b = 0;
			break;
		case 1:
			r = C171;
			g = T + third;
			b = 0;
			break;
		case 2:
			r = C171 - twoThirds;
			g = 2 * T + third;
			b = 0;
			break;
		case 3:
			r = 0;
			g = 1 - third;
			b = third;
			break;
		case 4:
			r = 0;
			g = C171 - twoThirds;
			b = T + twoThirds;
			break;
		case 5:
			r = third;
			g = 0;
			b = 1 - third;
			break;
		case 6:
			r = T + third;
			g = 0;
			b = C171 - third;
			break;
		default:
			r = 2 * T + third;
			g = 0;
			b = T - third;
			break;
	}

	const sat = clamp(s);
	if (sat < 1) {
		// Quadratic desaturation floor, so partial saturation lifts toward white the way
		// a real fixture does rather than washing out linearly.
		const desat = 1 - sat;
		const floor = desat * desat;
		r = r * sat + floor;
		g = g * sat + floor;
		b = b * sat + floor;
	}

	out[0] = r * v;
	out[1] = g * v;
	out[2] = b * v;
	return out;
}

/**
 * Map true hue in degrees to the nearest deliverable ramp coordinate (0..1).
 * The ramp is piecewise and skips some hues, so inversion uses nearest-hue search.
 */
export function rampHueFor(degrees: number): number {
	const want = ((degrees % 360) + 360) % 360;
	let best = 0;
	let bestErr = Infinity;
	for (let i = 0; i < RAMP_STEPS; i++) {
		const err = Math.abs(angleDelta(rampTable()[i], want));
		if (err < bestErr) {
			bestErr = err;
			best = i;
		}
	}
	return best / RAMP_STEPS;
}

/** A quarter of a degree of resolution, which is finer than the eye and than a byte of hue. */
const RAMP_STEPS = 1440;
let RAMP: Float64Array | null = null;

/** Delivered true hue for every ramp coordinate. Built once; the ramp is a compile-time constant. */
function rampTable(): Float64Array {
	if (RAMP) return RAMP;
	const table = new Float64Array(RAMP_STEPS);
	const rgb: [number, number, number] = [0, 0, 0];
	for (let i = 0; i < RAMP_STEPS; i++) {
		hsv2rgb(i / RAMP_STEPS, 1, 1, rgb);
		table[i] = trueHue(rgb[0], rgb[1], rgb[2]);
	}
	RAMP = table;
	return table;
}

/** Textbook HSV hue of an RGB triple, degrees. The coordinate the outside world measures in. */
export function trueHue(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d <= 1e-9) return 0;
	let h: number;
	if (max === r) h = ((g - b) / d) % 6;
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	h *= 60;
	return ((h % 360) + 360) % 360;
}

/** Shortest signed way round the wheel, degrees. */
function angleDelta(from: number, to: number): number {
	return ((((to - from) % 360) + 540) % 360) - 180;
}
