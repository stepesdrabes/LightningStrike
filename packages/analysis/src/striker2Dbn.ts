import { STRIKER2_FPS, round3 } from './striker2Decode.ts';

/**
 * striker-2 `dbn.decode` as its `dbn:1:34` system runs it (research/2026-10-22-meter-decoding.md):
 * madmom's bar-pointer HMM at 100 fps, bars of 3 and 4, 60 log-spaced tempi over 55 to 215 BPM,
 * tempo changes only between beats at a cost of lambda |ln(tau'/tau)|. The arithmetic follows the
 * numpy code operation by operation, so equal inputs give equal paths.
 */
export const DBN = {
	meters: [3, 4],
	minBpm: 55,
	maxBpm: 215,
	tempi: 60,
	transitionLambda: 100,
	observationLambda: 16,
	threshold: 0.05,
	/** Frames: the beat offset head learned from up to +-6 frames away. */
	reach: 6.5
} as const;

const EPSILON = 1e-5;

/** madmom's `BeatStateSpace` intervals (frames): the integers, or `count` log-spaced ones. */
export function dbnIntervals(low: number, high: number, count: number): number[] {
	let out: number[] = [];
	for (let v = Math.round(low); v <= Math.round(high); v++) out.push(v);
	if (count >= out.length) return out;
	out = [];
	for (let k = count; out.length < count; k++) {
		const start = Math.log2(low);
		const stop = Math.log2(high);
		const step = (stop - start) / (k - 1);
		const values = Array.from({ length: k }, (_, j) => (j === k - 1 ? stop : j * step + start))
			.map((v) => Math.round(2 ** v));
		out = [...new Set(values)].sort((a, b) => a - b);
	}
	return out;
}

/** Frames at the start of a beat of `tau` frames that emit the (down)beat probability. */
function beatWidth(tau: number, observationLambda: number): number {
	let n = 0;
	for (let j = 0; j < tau; j++) if (j * (1 / tau) < 1 / observationLambda) n++;
	return n;
}

/** numpy's pairwise float64 sum for up to 128 values (eight running partial sums). */
function pairwiseSum(a: Float64Array): number {
	if (a.length < 8) {
		let s = 0;
		for (const v of a) s += v;
		return s;
	}
	if (a.length > 128) throw new Error('pairwiseSum covers 128 values');
	const r = Array.from(a.subarray(0, 8));
	let i = 8;
	for (; i < a.length - (a.length % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[i + j];
	let s = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
	for (; i < a.length; i++) s += a[i];
	return s;
}

/**
 * The best path as beat segments [start frame, position in the bar, tempo index]. A segment's
 * predecessor tempo is kept per frame as a byte, so memory grows by 420 bytes a frame, not by the
 * 3.4 kB the scores would take.
 */
function viterbi(act0: Float64Array, act1: Float64Array, taus: number[]): [number, number, number][] {
	const meters = [...DBN.meters].sort((a, b) => a - b);
	const n = taus.length;
	const frames = act0.length;
	const pad = Math.max(...taus);
	const rows = meters.flatMap((m) => Array.from({ length: m }, (_, k) => [m, k] as const));
	const count = rows.length;
	const into = new Int32Array(count);
	let first = 0;
	for (const m of meters) {
		for (let k = 0; k < m; k++) into[first + ((k + 1) % m)] = first + k;
		first += m;
	}
	const tau = Int32Array.from(taus);
	const width = Int32Array.from(taus, (t) => beatWidth(t, DBN.observationLambda));
	const downbeat = Uint8Array.from(rows, ([, k]) => (k === 0 ? 1 : 0));
	const total = frames + 2 * pad + 1;
	const [c0, c1, c2] = [new Float64Array(total + 1), new Float64Array(total + 1), new Float64Array(total + 1)];
	let [s0, s1, s2] = [0, 0, 0];
	for (let t = 0; t < frames; t++) {
		s0 += Math.log(Math.max(1 - (act0[t] + act1[t]), EPSILON / 2) / (DBN.observationLambda - 1));
		s1 += Math.log(act0[t]);
		s2 += Math.log(act1[t]);
		[c0[pad + 1 + t], c1[pad + 1 + t], c2[pad + 1 + t]] = [s0, s1, s2];
	}
	for (const c of [c0, c1, c2]) c.fill(c[pad + frames], pad + 1 + frames);
	const x = Float64Array.from(taus, (t) => Math.log(t) * DBN.transitionLambda);
	const z = Float64Array.from(x, (xi) =>
		Math.log(pairwiseSum(Float64Array.from(x, (xj) => Math.exp(-Math.abs(xi - xj))))));
	const tauSum = taus.reduce((a, b) => a + b, 0);
	const ringFrames = pad + 1;
	const ring = new Float64Array(ringFrames * n * count);
	for (let s = 0; s < ringFrames; s++) {
		for (let i = 0; i < n; i++) {
			for (let r = 0; r < count; r++) ring[(s * n + i) * count + r] = -Math.log(rows[r][0] * tauSum);
		}
	}
	const tail = new Float64Array(n * (pad + 1) * count);
	const back = new Uint8Array(total * n * count);
	const gains = new Float64Array(n * count);
	const less = new Float64Array(n * count);
	const forward = new Float64Array(n);
	const forwardAt = new Int32Array(n);
	const best = new Float64Array(n * count);
	for (let e = pad + 1; e < total; e++) {
		for (let i = 0; i < n; i++) {
			const start = e - tau[i];
			const mid = start + width[i];
			const beat = c1[mid] - c1[start] + c0[e] - c0[mid];
			const down = c2[mid] - c2[start] + c0[e] - c0[mid];
			const from = ((start % ringFrames) * n + i) * count;
			for (let r = 0, k = i * count; r < count; r++, k++) {
				gains[k] = ring[from + r] + (downbeat[r] ? down : beat);
				less[k] = gains[k] - z[i];
			}
		}
		if (e >= pad + frames) {
			const at = e - pad - frames;
			for (let i = 0; i < n; i++) {
				for (let r = 0; r < count; r++) tail[(i * (pad + 1) + at) * count + r] = gains[i * count + r];
			}
		}
		for (let r = 0; r < count; r++) {
			let top = -Infinity;
			let at = 0;
			for (let i = 0; i < n; i++) {
				const v = less[i * count + r] + x[i];
				if (v > top) {
					top = v;
					at = i;
				}
				forward[i] = top - x[i];
				forwardAt[i] = at;
			}
			top = -Infinity;
			for (let i = n - 1; i >= 0; i--) {
				const v = less[i * count + r] - x[i];
				if (v >= top) {
					top = v;
					at = i;
				}
				const up = top + x[i];
				best[i * count + r] = forward[i] > up ? forward[i] : up;
				// The predecessor numpy's backtrace picks: argmax of gains - z - |x' - x|.
				const fa = forwardAt[i];
				back[(e * n + i) * count + r] = at !== fa
					&& less[at * count + r] - Math.abs(x[at] - x[i]) > less[fa * count + r] - Math.abs(x[fa] - x[i])
					? at : fa;
			}
		}
		const to = (e % ringFrames) * n * count;
		for (let i = 0; i < n; i++) {
			for (let r = 0; r < count; r++) ring[to + i * count + r] = best[i * count + into[r]];
		}
	}
	let top = -Infinity;
	let found = 0;
	for (let k = 0; k < tail.length; k++) {
		if (tail[k] > top) {
			top = tail[k];
			found = k;
		}
	}
	let r = found % count;
	let i = Math.floor(found / count / (pad + 1));
	let e = Math.floor(found / count) % (pad + 1) + pad + frames;
	const path: [number, number, number][] = [];
	for (;;) {
		const s = e - taus[i];
		path.push([s - pad, rows[r][1], i]);
		if (s <= pad) break;
		r = into[r];
		i = back[(s * n + i) * count + r];
		e = s;
	}
	return path.reverse();
}

/**
 * Beats and downbeats (seconds, to 1 ms) from [frames, 2] beat and downbeat logits and the
 * [frames] beat offset at 100 fps. Every downbeat is one of the beats, equal to the bit.
 */
export function dbnBeats(
	beat: Float32Array, offset: Float32Array
): { beats: number[]; downbeats: number[] } {
	const frames = beat.length / 2;
	const all0 = new Float64Array(frames);
	const all1 = new Float64Array(frames);
	let first = -1;
	let last = -1;
	for (let t = 0; t < frames; t++) {
		const [p0, p1] = [beat[2 * t], beat[2 * t + 1]]
			.map((v) => (1 / (1 + Math.exp(-v))) * (1 - EPSILON) + EPSILON / 2);
		all0[t] = Math.max(p0 - p1, EPSILON / 2);
		all1[t] = p1;
		if (all0[t] >= DBN.threshold || all1[t] >= DBN.threshold) {
			if (first < 0) first = t;
			last = t;
		}
	}
	if (first < 0) return { beats: [], downbeats: [] };
	const act0 = all0.subarray(first, last + 1);
	const act1 = all1.subarray(first, last + 1);
	const taus = dbnIntervals(60 * STRIKER2_FPS / DBN.maxBpm, 60 * STRIKER2_FPS / DBN.minBpm, DBN.tempi);
	const beats: number[] = [];
	const downbeats: number[] = [];
	const reach = Math.fround(DBN.reach);
	for (const [s, position, i] of viterbi(act0, act1, taus)) {
		const lo = Math.max(s, 0);
		const hi = Math.min(s + beatWidth(taus[i], DBN.observationLambda), act0.length);
		if (lo >= hi) continue;
		let peak = 0;
		let top = -Infinity;
		for (let k = 0; k < 2 * (hi - lo); k++) {
			const v = (k % 2 === 0 ? act0 : act1)[lo + (k >> 1)];
			if (v > top) {
				top = v;
				peak = k;
			}
		}
		const f = lo + (peak >> 1) + first;
		const time = round3(Math.max((f + Math.min(reach, Math.max(-reach, offset[f]))) / STRIKER2_FPS, 0));
		beats.push(time);
		if (position === 0) downbeats.push(time);
	}
	return { beats, downbeats };
}
