import { applyBiquad, lowpass } from './dsp/filters.ts';

/** Samples per second of the pan and width curves. A sixteenth at 175 bpm is 86 ms. */
const STEREO_FPS = 25;

export interface StereoImage {
	fps: number;
	/** -1 hard left, +1 hard right, 0 centred. */
	pan: Float32Array;
	/** 0 when the channels are identical, 1 when they share nothing. */
	width: Float32Array;
}

/**
 * Measure stereo position over 200 Hz-6 kHz: bass is normally mono, while wide cymbals above
 * that range would swamp vocal movement. Mono features cannot observe left/right exchanges.
 */
export function analyseStereo(
	left: Float32Array,
	right: Float32Array,
	sampleRate: number
): StereoImage {
	const l = bandLimited(left, sampleRate);
	const r = bandLimited(right, sampleRate);

	const hop = Math.max(1, Math.round(sampleRate / STEREO_FPS));
	const frames = Math.max(1, Math.ceil(l.length / hop));
	const pan = new Float32Array(frames);
	const width = new Float32Array(frames);

	for (let f = 0; f < frames; f++) {
		const from = f * hop;
		const to = Math.min(l.length, from + hop);
		let sumL = 0;
		let sumR = 0;
		let cross = 0;
		for (let i = from; i < to; i++) {
			sumL += l[i] * l[i];
			sumR += r[i] * r[i];
			cross += l[i] * r[i];
		}
		const n = Math.max(1, to - from);
		const rmsL = Math.sqrt(sumL / n);
		const rmsR = Math.sqrt(sumR / n);
		const total = rmsL + rmsR;

		// A silent window has no position. Reporting zero there rather than a ratio of two
		// noise floors is what stops the pan curve thrashing between sections.
		pan[f] = total > 1e-5 ? (rmsR - rmsL) / total : 0;

		const denom = Math.sqrt((sumL / n) * (sumR / n));
		const correlation = denom > 1e-10 ? cross / n / denom : 1;
		width[f] = Math.max(0, Math.min(1, (1 - correlation) / 2));
	}

	return { fps: sampleRate / hop, pan, width };
}

/** Two cascaded sections each end, so the band is genuinely gone rather than merely reduced. */
function bandLimited(channel: Float32Array, sampleRate: number): Float32Array {
	const out = Float32Array.from(channel);
	applyBiquad(out, lowpass(sampleRate, 6000));
	applyBiquad(out, lowpass(sampleRate, 6000));
	highpassTwice(out, sampleRate, 200);
	return out;
}

function highpassTwice(signal: Float32Array, sampleRate: number, freq: number): void {
	const w0 = (2 * Math.PI * freq) / sampleRate;
	const cosW = Math.cos(w0);
	const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
	const a0 = 1 + alpha;
	const f = {
		b0: (1 + cosW) / 2 / a0,
		b1: -(1 + cosW) / a0,
		b2: (1 + cosW) / 2 / a0,
		a1: (-2 * cosW) / a0,
		a2: (1 - alpha) / a0
	};
	applyBiquad(signal, f);
	applyBiquad(signal, f);
}
