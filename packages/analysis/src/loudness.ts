import { applyCascade, kWeighting } from './dsp/filters.ts';

export interface Loudness {
	/** Gated integrated loudness, LUFS. */
	integrated: number;
	/** Loudness range, LU: the 95th minus the 10th percentile of gated short-term blocks. */
	range: number;
	/** Sample peak in dBFS. */
	peak: number;
	/**
	 * Peak-to-loudness ratio, LU. Below ~8 indicates limiting; onset density then carries more
	 * dynamics than level.
	 */
	peakToLoudness: number;
	/** Short-term loudness (3 s window) sampled every 100 ms, LUFS. */
	shortTerm: Float32Array;
	shortTermFps: number;
}

const BLOCK_SEC = 0.4;
const STEP_SEC = 0.1;
const SHORT_TERM_SEC = 3;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;
/** Cancel K-weighting passband gain at 997 Hz so a full-scale sine measures -3.01 LUFS. */
const OFFSET = -0.691;

function loudnessOf(meanSquare: number): number {
	return meanSquare > 0 ? OFFSET + 10 * Math.log10(meanSquare) : -Infinity;
}

/**
 * ITU-R BS.1770-4 with EBU R128 gating. Measure the analysed mono stream; stereo loudness
 * can differ by 3 dB. Reuse its blocks for the short-term curve.
 */
export function measureLoudness(mono: Float32Array, sampleRate: number): Loudness {
	const weighted = Float32Array.from(mono);
	applyCascade(weighted, kWeighting(sampleRate));

	const step = Math.max(1, Math.round(STEP_SEC * sampleRate));
	const blockLen = Math.max(step, Math.round(BLOCK_SEC * sampleRate));
	const stepsPerBlock = Math.round(blockLen / step);

	// Mean square per 100 ms hop, so any window length that is a multiple of the hop is a
	// running sum away.
	const hops = Math.max(1, Math.floor(weighted.length / step));
	const hopPower = new Float64Array(hops);
	for (let h = 0; h < hops; h++) {
		let acc = 0;
		const from = h * step;
		const to = Math.min(weighted.length, from + step);
		for (let i = from; i < to; i++) acc += weighted[i] * weighted[i];
		hopPower[h] = acc / Math.max(1, to - from);
	}

	const blockPower: number[] = [];
	for (let h = 0; h + stepsPerBlock <= hops; h++) {
		let acc = 0;
		for (let k = 0; k < stepsPerBlock; k++) acc += hopPower[h + k];
		blockPower.push(acc / stepsPerBlock);
	}

	const above = blockPower.filter((p) => loudnessOf(p) > ABSOLUTE_GATE);
	const absoluteMean = above.length > 0 ? above.reduce((a, b) => a + b, 0) / above.length : 0;
	const relativeGate = loudnessOf(absoluteMean) + RELATIVE_GATE;
	const gated = blockPower.filter(
		(p) => loudnessOf(p) > ABSOLUTE_GATE && loudnessOf(p) > relativeGate
	);
	const integrated =
		gated.length > 0 ? loudnessOf(gated.reduce((a, b) => a + b, 0) / gated.length) : -Infinity;

	const stPerBlock = Math.round(SHORT_TERM_SEC / STEP_SEC);
	const shortTerm = new Float32Array(Math.max(0, hops - stPerBlock + 1));
	for (let h = 0; h < shortTerm.length; h++) {
		let acc = 0;
		for (let k = 0; k < stPerBlock; k++) acc += hopPower[h + k];
		shortTerm[h] = loudnessOf(acc / stPerBlock);
	}

	// LRA gates the short-term values a second time, 20 LU down rather than 10.
	const stAbove = Array.from(shortTerm).filter((v) => v > ABSOLUTE_GATE && Number.isFinite(v));
	let range = 0;
	if (stAbove.length > 2) {
		const meanPower =
			stAbove.reduce((a, b) => a + Math.pow(10, (b - OFFSET) / 10), 0) / stAbove.length;
		const gate = loudnessOf(meanPower) - 20;
		const kept = stAbove.filter((v) => v > gate).sort((a, b) => a - b);
		if (kept.length > 1) {
			const at = (q: number) => kept[Math.min(kept.length - 1, Math.round(q * (kept.length - 1)))];
			range = at(0.95) - at(0.1);
		}
	}

	let peakAmp = 0;
	for (let i = 0; i < mono.length; i++) {
		const v = Math.abs(mono[i]);
		if (v > peakAmp) peakAmp = v;
	}
	const peak = peakAmp > 0 ? 20 * Math.log10(peakAmp) : -Infinity;

	return {
		integrated,
		range,
		peak,
		peakToLoudness: Number.isFinite(integrated) ? peak - integrated : 0,
		shortTerm,
		shortTermFps: 1 / STEP_SEC
	};
}
