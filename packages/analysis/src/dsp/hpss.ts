/**
 * Median-filter HPSS (Fitzgerald 2010, Driedger separation factor): time ridges are harmonic,
 * frequency stripes percussive. Filterbank cells suffice; no masked spectrum is resynthesised.
 */
interface Separation {
	/** frames * bands, the percussive share of each cell, 0 or 1. */
	percussive: Float32Array;
	/** frames * bands, the harmonic share. */
	harmonic: Float32Array;
}

/** Soft Wiener masks preserve the input sum; a hard gate discards ambiguous kick cells. */
const MASK_POWER = 2;

export function separate(
	mag: Float32Array,
	frames: number,
	bands: number,
	timeRadius = 8,
	bandRadius = 8
): Separation {
	const harmonicEnhanced = new Float32Array(frames * bands);
	const percussiveEnhanced = new Float32Array(frames * bands);

	const line = new Float32Array(Math.max(frames, bands));
	const filtered = new Float32Array(Math.max(frames, bands));

	for (let b = 0; b < bands; b++) {
		for (let f = 0; f < frames; f++) line[f] = mag[f * bands + b];
		movingMedian(line, frames, timeRadius, filtered);
		for (let f = 0; f < frames; f++) harmonicEnhanced[f * bands + b] = filtered[f];
	}

	for (let f = 0; f < frames; f++) {
		const o = f * bands;
		for (let b = 0; b < bands; b++) line[b] = mag[o + b];
		movingMedian(line, bands, bandRadius, filtered);
		for (let b = 0; b < bands; b++) percussiveEnhanced[o + b] = filtered[b];
	}

	const percussive = new Float32Array(frames * bands);
	const harmonic = new Float32Array(frames * bands);
	for (let i = 0; i < percussive.length; i++) {
		const h = Math.pow(harmonicEnhanced[i], MASK_POWER);
		const p = Math.pow(percussiveEnhanced[i], MASK_POWER);
		const total = h + p;
		if (!(total > 0)) continue;
		percussive[i] = (mag[i] * p) / total;
		harmonic[i] = (mag[i] * h) / total;
	}

	return { percussive, harmonic };
}

/**
 * Maintain a sorted median window: O(w) insertion/deletion avoids re-sorting millions of cells.
 * Plain shift loops are much faster than copyWithin calls on windows this small.
 */
function movingMedian(src: Float32Array, len: number, radius: number, out: Float32Array): void {
	if (radius <= 0 || len === 0) {
		out.set(src.subarray(0, len));
		return;
	}

	const window = new Float32Array(2 * radius + 1);
	let size = 0;

	const insert = (v: number) => {
		let lo = 0;
		let hi = size;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (window[mid] < v) lo = mid + 1;
			else hi = mid;
		}
		for (let i = size; i > lo; i--) window[i] = window[i - 1];
		window[lo] = v;
		size++;
	};

	const remove = (v: number) => {
		let lo = 0;
		let hi = size;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (window[mid] < v) lo = mid + 1;
			else hi = mid;
		}
		size--;
		for (let i = lo; i < size; i++) window[i] = window[i + 1];
	};

	for (let i = 0; i <= Math.min(radius, len - 1); i++) insert(src[i]);

	for (let i = 0; i < len; i++) {
		out[i] = window[size >> 1];
		const drop = i - radius;
		if (drop >= 0) remove(src[drop]);
		const add = i + radius + 1;
		if (add < len) insert(src[add]);
	}
}
