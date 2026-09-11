import { argMax, mean, quantile, smooth, stdev } from './dsp/stats.ts';

export const MIN_BPM = 55;
export const MAX_BPM = 215;

/**
 * Log-normal tactus prior, centred near 120 bpm. Width and bar-grouping weight were tuned
 * together on GTZAN/GiantSteps; keep the width symmetric.
 */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES_BELOW = 0.6;
const PRIOR_OCTAVES_ABOVE = 0.6;

interface TempoCandidate {
	bpm: number;
	/** Tempogram strength, 0..1 relative to the strongest candidate. */
	salience: number;
}

function logPrior(bpm: number): number {
	const octaves = Math.log2(bpm / PRIOR_BPM);
	const width = octaves < 0 ? PRIOR_OCTAVES_BELOW : PRIOR_OCTAVES_ABOVE;
	return Math.exp(-0.5 * (octaves / width) ** 2);
}

/**
 * Multiply autocorrelation and Fourier tempograms: their multiple/divisor ambiguities cancel
 * where only one representation supports a tempo.
 */
export function tempogram(
	odf: Float32Array,
	fps: number,
	minBpm = MIN_BPM,
	maxBpm = MAX_BPM,
	resolution = 0.25
): { bpm: Float32Array; strength: Float32Array } {
	const n = odf.length;
	const steps = Math.max(1, Math.round((maxBpm - minBpm) / resolution) + 1);
	const bpm = new Float32Array(steps);
	const acf = new Float32Array(steps);
	const dft = new Float32Array(steps);

	// Zero-mean, so autocorrelation measures modulation rather than the curve's own level.
	const centred = new Float32Array(n);
	const m = mean(odf);
	for (let i = 0; i < n; i++) centred[i] = odf[i] - m;

	let energy = 0;
	for (let i = 0; i < n; i++) energy += centred[i] * centred[i];
	energy = Math.max(energy, 1e-12);

	for (let s = 0; s < steps; s++) {
		const b = minBpm + s * resolution;
		bpm[s] = b;

		const lagF = (60 * fps) / b;
		const lag = Math.floor(lagF);
		const frac = lagF - lag;

		let a0 = 0;
		let a1 = 0;
		const limit = n - lag - 1;
		for (let i = 0; i < limit; i++) {
			a0 += centred[i] * centred[i + lag];
			a1 += centred[i] * centred[i + lag + 1];
		}
		// Linear interpolation between integer lags: at 180 bpm one frame of lag is 3 bpm, so
		// integer lags alone cannot resolve tempo to better than a few bpm up there.
		acf[s] = Math.max(0, (a0 * (1 - frac) + a1 * frac) / energy);

		const w = (2 * Math.PI * b) / (60 * fps);
		let re = 0;
		let im = 0;
		for (let i = 0; i < n; i++) {
			re += centred[i] * Math.cos(w * i);
			im += centred[i] * Math.sin(w * i);
		}
		dft[s] = Math.sqrt(re * re + im * im) / Math.sqrt(energy * n);
	}

	const strength = new Float32Array(steps);
	const acfTop = Math.max(quantile(acf, 0.999), 1e-9);
	const dftTop = Math.max(quantile(dft, 0.999), 1e-9);
	for (let s = 0; s < steps; s++) {
		strength[s] = Math.sqrt((acf[s] / acfTop) * (dft[s] / dftTop));
	}
	return { bpm, strength: smooth(strength, Math.max(1, Math.round(1 / resolution))) };
}

/**
 * Use only observed tempogram peaks. Adding relatives with inherited salience invents
 * evidence for octave selection.
 */
export function tempoCandidates(
	odf: Float32Array,
	fps: number,
	minBpm = MIN_BPM,
	maxBpm = MAX_BPM
): TempoCandidate[] {
	const tg = tempogram(odf, fps, minBpm, maxBpm);
	const peaks: TempoCandidate[] = [];

	for (let s = 1; s < tg.strength.length - 1; s++) {
		if (tg.strength[s] < tg.strength[s - 1] || tg.strength[s] <= tg.strength[s + 1]) continue;
		// Parabolic interpolation of the peak, so a 0.25 bpm grid still resolves finer.
		const a = tg.strength[s - 1];
		const b = tg.strength[s];
		const c = tg.strength[s + 1];
		const denom = a - 2 * b + c;
		const shift = Math.abs(denom) < 1e-12 ? 0 : (0.5 * (a - c)) / denom;
		const step = tg.bpm[1] - tg.bpm[0];
		peaks.push({ bpm: tg.bpm[s] + shift * step, salience: b * logPrior(tg.bpm[s]) });
	}

	peaks.sort((x, y) => y.salience - x.salience);
	// The fallback has to respect the search range, or a caller who narrowed it around a known
	// tempo gets the prior back instead of anything like what they asked for.
	if (peaks.length === 0) {
		return [{ bpm: Math.min(maxBpm, Math.max(minBpm, PRIOR_BPM)), salience: 0 }];
	}

	const best = peaks[0].salience || 1;
	return peaks.slice(0, 6).map((p) => ({ bpm: p.bpm, salience: p.salience / best }));
}

interface BeatTrack {
	/** Beat times in seconds. */
	times: Float64Array;
	/** Mean conditioned onset strength landing on a beat; the tracker's own confidence. */
	score: number;
	bpm: number;
}

/**
 * Ellis (2007) DP beat tracking maximises onset support minus period deviation. Global
 * sequence scoring preserves phase through silence.
 */
export function trackBeats(
	odf: Float32Array,
	fps: number,
	bpm: number,
	tightness = 100
): BeatTrack {
	const n = odf.length;
	const period = (60 * fps) / bpm;
	if (n < 4 || period < 2) return { times: new Float64Array(0), score: 0, bpm };

	// Smooth by a fraction of the period so a beat is a hump rather than a spike; the DP then
	// tolerates a few milliseconds of jitter instead of paying the full transition penalty.
	const sd = stdev(odf) || 1;
	const local = gaussianLocalScore(odf, period / 32, sd);

	const first = Math.round(period / 2);
	const last = Math.round(2 * period);
	const span = last - first + 1;
	const txwt = new Float64Array(span);
	for (let i = 0; i < span; i++) {
		const back = first + i;
		txwt[i] = -tightness * Math.log(back / period) ** 2;
	}

	const cum = new Float64Array(n);
	const link = new Int32Array(n).fill(-1);

	for (let t = 0; t < n; t++) {
		let bestScore = -Infinity;
		let bestFrom = -1;
		for (let i = 0; i < span; i++) {
			const from = t - (first + i);
			if (from < 0) continue;
			const v = txwt[i] + cum[from];
			if (v > bestScore) {
				bestScore = v;
				bestFrom = from;
			}
		}
		if (bestFrom < 0) {
			cum[t] = local[t];
			link[t] = -1;
		} else {
			cum[t] = local[t] + bestScore;
			link[t] = bestFrom;
		}
	}

	// Start the backtrace from a local maximum of the cumulative score rather than from its
	// global one: the last few frames often hold a fade-out whose score is meaningless.
	let end = -1;
	const threshold = quantile(cum, 0.5);
	for (let t = n - 1; t >= 1; t--) {
		if (cum[t] <= threshold) continue;
		if (cum[t] >= cum[t - 1] && (t === n - 1 || cum[t] >= cum[t + 1])) {
			end = t;
			break;
		}
	}
	if (end < 0) end = argMax(cum);

	const rev: number[] = [];
	for (let t = end; t >= 0; t = link[t]) {
		rev.push(t);
		if (link[t] < 0) break;
	}
	rev.reverse();

	const times = new Float64Array(rev.length);
	let hit = 0;
	for (let i = 0; i < rev.length; i++) {
		times[i] = rev[i] / fps;
		hit += odf[rev[i]];
	}

	const score = rev.length > 0 ? hit / (rev.length * sd) : 0;
	const observed =
		rev.length > 1 ? (60 * (rev.length - 1) * fps) / (rev[rev.length - 1] - rev[0]) : bpm;

	return { times, score, bpm: observed };
}

function gaussianLocalScore(odf: Float32Array, sigma: number, norm: number): Float32Array {
	const radius = Math.max(1, Math.round(sigma * 3));
	const kernel = new Float64Array(2 * radius + 1);
	let sum = 0;
	for (let i = -radius; i <= radius; i++) {
		const v = Math.exp(-0.5 * (i / Math.max(sigma, 1e-6)) ** 2);
		kernel[i + radius] = v;
		sum += v;
	}
	for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

	const n = odf.length;
	const out = new Float32Array(n);
	for (let t = 0; t < n; t++) {
		let acc = 0;
		for (let i = -radius; i <= radius; i++) {
			const j = t + i;
			if (j >= 0 && j < n) acc += odf[j] * kernel[i + radius];
		}
		out[t] = acc / norm;
	}
	return out;
}
