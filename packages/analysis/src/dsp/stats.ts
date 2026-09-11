export function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function mean(a: ArrayLike<number>, from = 0, to = a.length): number {
	const lo = Math.max(0, from);
	const hi = Math.min(a.length, to);
	if (hi <= lo) return 0;
	let acc = 0;
	for (let i = lo; i < hi; i++) acc += a[i];
	return acc / (hi - lo);
}

export function argMax(a: ArrayLike<number>): number {
	let best = 0;
	for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
	return best;
}

/** Linear-interpolated quantile, q in 0..1. Sorts a copy. */
export function quantile(a: ArrayLike<number>, q: number): number {
	const n = a.length;
	if (n === 0) return 0;
	const sorted = Float64Array.from(a as ArrayLike<number>).sort();
	const pos = clamp01(q) * (n - 1);
	const i = Math.floor(pos);
	const f = pos - i;
	return i + 1 < n ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

export function median(a: ArrayLike<number>): number {
	return quantile(a, 0.5);
}

/** Standard deviation about the sample mean. */
export function stdev(a: ArrayLike<number>): number {
	const n = a.length;
	if (n < 2) return 0;
	const m = mean(a);
	let acc = 0;
	for (let i = 0; i < n; i++) acc += (a[i] - m) ** 2;
	return Math.sqrt(acc / n);
}

/** Scale between two quantiles to 0..1 so mastering outliers cannot set thresholds. */
export function normalise(
	a: ArrayLike<number>,
	loQ = 0.02,
	hiQ = 0.98,
	out = new Float32Array(a.length)
): Float32Array {
	if (a.length === 0) return out;
	const lo = quantile(a, loQ);
	const hi = quantile(a, hiQ);
	const span = Math.max(hi - lo, 1e-9);
	for (let i = 0; i < a.length; i++) out[i] = clamp01((a[i] - lo) / span);
	return out;
}

/** Sliding maximum over a centred window of `2 * radius + 1`, O(n) via a monotonic deque. */
export function maxFilter(a: Float32Array, radius: number, out = new Float32Array(a.length)) {
	const n = a.length;
	if (radius <= 0) {
		out.set(a);
		return out;
	}
	const deque = new Int32Array(n);
	let head = 0;
	let tail = 0;

	for (let i = 0; i < n + radius; i++) {
		if (i < n) {
			while (tail > head && a[deque[tail - 1]] <= a[i]) tail--;
			deque[tail++] = i;
		}
		const centre = i - radius;
		if (centre >= 0) {
			while (deque[head] < centre - radius) head++;
			out[centre] = a[deque[head]];
		}
	}
	return out;
}

/** Odd-length centred moving average, edges handled by shrinking the window. */
export function smooth(a: Float32Array, radius: number, out = new Float32Array(a.length)) {
	const n = a.length;
	if (radius <= 0) {
		out.set(a);
		return out;
	}
	const cum = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + a[i];
	for (let i = 0; i < n; i++) {
		const lo = Math.max(0, i - radius);
		const hi = Math.min(n, i + radius + 1);
		out[i] = (cum[hi] - cum[lo]) / (hi - lo);
	}
	return out;
}

/** Gaussian smoothing by three box passes, which is close enough and O(n). */
export function gaussianSmooth(a: Float32Array, sigma: number): Float32Array {
	if (sigma <= 0) return Float32Array.from(a);
	const radius = Math.max(1, Math.round(sigma * 1.2));
	let cur = Float32Array.from(a);
	const scratch = new Float32Array(a.length);
	for (let pass = 0; pass < 3; pass++) {
		smooth(cur, radius, scratch);
		cur.set(scratch);
	}
	return cur;
}

/** Linear interpolation into a sampled curve, clamped at both ends. */
export function sampleAt(a: ArrayLike<number>, x: number): number {
	const n = a.length;
	if (n === 0) return 0;
	if (x <= 0) return a[0];
	if (x >= n - 1) return a[n - 1];
	const i = Math.floor(x);
	const f = x - i;
	return a[i] * (1 - f) + a[i + 1] * f;
}

/** Centred median preserves step edges without group delay; offline analysis needs no causal lag. */
export function centredMedian(a: ArrayLike<number>, r: number, out = new Float32Array(a.length)): Float32Array {
	const n = a.length;
	if (n === 0 || r <= 0) {
		for (let i = 0; i < n; i++) out[i] = a[i];
		return out;
	}
	const window = new Float64Array(2 * r + 1);
	for (let i = 0; i < n; i++) {
		let m = 0;
		for (let k = -r; k <= r; k++) {
			const j = i + k;
			if (j < 0 || j >= n) continue;
			window[m++] = a[j];
		}
		const slice = window.subarray(0, m);
		slice.sort();
		out[i] = m % 2 ? slice[(m - 1) >> 1] : (slice[m / 2 - 1] + slice[m / 2]) / 2;
	}
	return out;
}
