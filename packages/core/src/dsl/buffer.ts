import { alphaFor } from './math.ts';

/** Never clear, always decay: it is what makes trails and after-glow read as light. */
export function fadeToBlack(buf: Float32Array, dt: number, tau: number): void {
	const k = 1 - alphaFor(dt, tau);
	for (let i = 0; i < buf.length; i++) {
		const v = buf[i] * k;
		buf[i] = v < 1e-4 ? 0 : v;
	}
}

export function scaleBuf(buf: Float32Array, k: number): void {
	for (let i = 0; i < buf.length; i++) buf[i] *= k;
}

/** Temporal low-pass toward `src`. `amount` 0..1. */
export function nblend(dst: Float32Array, src: Float32Array, amount: number): void {
	for (let i = 0; i < dst.length; i++) dst[i] += (src[i] - dst[i]) * amount;
}

export function addPixel(buf: Float32Array, i: number, r: number, g: number, b: number): void {
	const o = i * 3;
	buf[o] += r;
	buf[o + 1] += g;
	buf[o + 2] += b;
}

export function setPixel(buf: Float32Array, i: number, r: number, g: number, b: number): void {
	const o = i * 3;
	buf[o] = r;
	buf[o + 1] = g;
	buf[o + 2] = b;
}

/** Fill every pixel with one colour. */
export function fillSolid(buf: Float32Array, count: number, rgb: readonly number[]): void {
	for (let i = 0; i < count; i++) {
		const o = i * 3;
		buf[o] = rgb[0];
		buf[o + 1] = rgb[1];
		buf[o + 2] = rgb[2];
	}
}

/** Sub-pixel additive dot. Anti-aliases motion that would otherwise step LED to LED. */
export function addPixelF(
	buf: Float32Array,
	pos: number,
	n: number,
	r: number,
	g: number,
	b: number,
	wrap = false
): void {
	const i0 = Math.floor(pos);
	const f = pos - i0;
	let a = i0;
	let bIdx = i0 + 1;
	if (wrap) {
		a = ((a % n) + n) % n;
		bIdx = ((bIdx % n) + n) % n;
	} else {
		if (a < 0 || a >= n) a = -1;
		if (bIdx < 0 || bIdx >= n) bIdx = -1;
	}
	if (a >= 0) addPixel(buf, a, r * (1 - f), g * (1 - f), b * (1 - f));
	if (bIdx >= 0) addPixel(buf, bIdx, r * f, g * f, b * f);
}

/**
 * Clip gaussian blobs with lo/hi when strips share a buffer, or wall ends can bleed onto the
 * beam.
 */
export function stampGaussian(
	buf: Float32Array,
	n: number,
	centre: number,
	sigma: number,
	r: number,
	g: number,
	b: number,
	wrap: boolean,
	lo = 0,
	hi = n
): void {
	if (sigma <= 0) return;
	const reach = Math.ceil(sigma * 3);
	const inv = 1 / (2 * sigma * sigma);
	const c0 = Math.round(centre);
	for (let k = -reach; k <= reach; k++) {
		let i = c0 + k;
		if (wrap) {
			const span = hi - lo;
			i = lo + (((i - lo) % span) + span) % span;
		} else if (i < lo || i >= hi) {
			continue;
		}
		const d = c0 + k - centre;
		const w = Math.exp(-d * d * inv);
		addPixel(buf, i, r * w, g * w, b * w);
	}
}

/** In-place box blur over a 1-D run of `n` pixels. */
export function blur1d(buf: Float32Array, n: number, amount: number, wrap = false): void {
	if (amount <= 0) return;
	const keep = 1 - amount;
	const side = amount * 0.5;
	for (let c = 0; c < 3; c++) {
		let prev = buf[(wrap ? n - 1 : 0) * 3 + c];
		for (let i = 0; i < n; i++) {
			const o = i * 3 + c;
			const nextIdx = i + 1 >= n ? (wrap ? 0 : i) : i + 1;
			const next = buf[nextIdx * 3 + c];
			const cur = buf[o];
			buf[o] = cur * keep + (prev + next) * side;
			prev = cur;
		}
	}
}
