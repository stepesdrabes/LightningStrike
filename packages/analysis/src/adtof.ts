import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RealFft } from './dsp/fft.ts';
import { QUIET_THREADS, openSession, type OnnxSession } from './onnxSession.ts';
import { MODEL_DIR } from './paths.ts';
import type { DrumStream } from './drums.ts';

/**
 * ADTOF Frame_RNN (Zehren, Alunno, Bientinesi 2023), exported by bench/export-adtof.py.
 * CC BY-NC-SA weights stay local and optional. The model classifies hits; broadband onsets place them.
 */
const MODEL_FILE = 'adtof_frame_rnn.onnx';

/** Frontend parameters of the locally exported ADTOF-pytorch port. */
const SAMPLE_RATE = 44100;
const FPS = 100;
const FRAME_SIZE = 2048;
const HOP = 441;
const BANDS_PER_OCTAVE = 12;
const FMIN = 20;
const FMAX = 20000;

/** Per-class peak thresholds from the port's defaults: kick, snare, tom, hat, cymbal. */
const THRESHOLDS = [0.22, 0.24, 0.32, 0.22, 0.3] as const;
/**
 * The hat class ships below the port's fitted threshold: on MDB Drums 0.15 keeps pooled F and
 * lifts track-mean F from 0.73 to 0.75. Kick is at its optimum; snare at 0.20 would gain
 * 0.015 F but its extra weak hits moved section labels on four library tracks.
 */
const HAT_THRESHOLD = 0.15;
/**
 * A hi-hat click at a backbeat raises the snare class a little through the model's metrical
 * prior. Below this activation, a peak the hat class outscores by this factor is suspect;
 * the analysis keeps it only with snare-band evidence, so a clap under an open hat survives.
 */
const CLICK_SNARE_MAX = 0.4;
const CLICK_HAT_RATIO = 1.5;
const STRONG_ONSET_EXCESS = 0.6;
const CLASSES = 5;

export interface AdtofOnsets {
	kick: DrumStream;
	snare: DrumStream;
	hat: DrumStream;
	/** Ride and crash strikes; the analysis folds them into the hat stream as timekeeping. */
	cymbal: DrumStream;
	/** Snare times that read as hi-hat clicks by activation; absent in older evidence. */
	snareClicks?: number[];
}

export interface AdtofFilterbank {
	filters: Float32Array;
	nBins: number;
	fftBins: number;
	/** Inclusive nonzero span of each band's row; zero weights add nothing to its sum. */
	first: Int32Array;
	last: Int32Array;
}

/** The PyTorch port anchors its logarithmic bands at 20 Hz. */
export function adtofFilterbank(): AdtofFilterbank {
	const fftBins = FRAME_SIZE / 2;
	const binHz = SAMPLE_RATE / FRAME_SIZE;

	const targets: number[] = [];
	const factor = Math.pow(2, 1 / BANDS_PER_OCTAVE);
	for (let f = FMIN; f <= FMAX * (1 + 1e-12); f *= factor) targets.push(f);

	const bins: number[] = [];
	let last = -1;
	for (const f of targets) {
		let best = 0;
		let bestDist = Infinity;
		for (let k = 0; k < fftBins; k++) {
			const d = Math.abs(k * binHz - f);
			if (d < bestDist) {
				bestDist = d;
				best = k;
			}
		}
		if (best > last) {
			bins.push(best);
			last = best;
		}
	}

	const nBins = bins.length - 2;
	const filters = new Float32Array(nBins * fftBins);
	for (let i = 0; i < nBins; i++) {
		const left = bins[i];
		const centre = bins[i + 1];
		const right = bins[i + 2];
		const row = i * fftBins;
		if (right - left < 2) {
			if (left >= 0 && left < fftBins) filters[row + left] = 1;
		} else {
			for (let b = left; b < centre; b++) filters[row + b] = (b - left) / (centre - left);
			if (centre >= 0 && centre < fftBins) filters[row + centre] = 1;
			for (let b = centre + 1; b < Math.min(right, fftBins); b++) {
				filters[row + b] = (right - b) / (right - centre);
			}
		}
		let sum = 0;
		for (let b = 0; b < fftBins; b++) sum += filters[row + b];
		if (sum > 0) for (let b = 0; b < fftBins; b++) filters[row + b] /= sum;
	}
	return { filters, nBins, fftBins, ...filterbankSpans(filters, nBins, fftBins) };
}

/** Each band row's inclusive nonzero span, for a bank laid out as nBins rows of fftBins weights. */
export function filterbankSpans(
	filters: Float32Array, nBins: number, fftBins: number
): Pick<AdtofFilterbank, 'first' | 'last'> {
	const first = new Int32Array(nBins).fill(fftBins);
	const last = new Int32Array(nBins).fill(-1);
	for (let i = 0; i < nBins; i++) {
		for (let b = 0; b < fftBins; b++) {
			if (filters[i * fftBins + b] === 0) continue;
			first[i] = Math.min(first[i], b);
			last[i] = b;
		}
	}
	return { first, last };
}

/** np.hanning: symmetric, unlike the analysis stack's periodic COLA window. */
function hannSymmetric(size: number): Float32Array {
	const w = new Float32Array(size);
	for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
	return w;
}

/** Centred 44.1 kHz PCM to the 100 Hz log-magnitude model input. */
export function adtofSpectrogram(mono: Float32Array, bank: AdtofFilterbank): Float32Array {
	const frames = 1 + Math.floor(mono.length / HOP);
	const spec = new Float32Array(frames * bank.nBins);
	const fft = new RealFft(FRAME_SIZE);
	const window = hannSymmetric(FRAME_SIZE);
	const mags = new Float32Array(FRAME_SIZE / 2 + 1);

	for (let t = 0; t < frames; t++) {
		// centre-aligned like librosa's center=True, zero-padded past either end.
		fft.magnitudes(mono, t * HOP - FRAME_SIZE / 2, window, mags, 1);
		const out = t * bank.nBins;
		for (let i = 0; i < bank.nBins; i++) {
			const row = i * bank.fftBins;
			let acc = 0;
			for (let b = bank.first[i]; b <= bank.last[i]; b++) acc += bank.filters[row + b] * mags[b];
			spec[out + i] = Math.log10(1 + acc);
		}
	}

	return spec;
}

/** madmom-style peaks: exceed the trailing average, win a local window, and merge nearby groups. */
function pickActivationPeaks(
	act: Float32Array,
	threshold: number
): { frames: number[]; heights: Float32Array } {
	const n = act.length;
	const preAvg = Math.round(0.1 * FPS);
	const postAvg = Math.round(0.01 * FPS);
	const preMax = Math.round(0.02 * FPS);
	const postMax = Math.round(0.01 * FPS);
	const combine = Math.max(1, Math.round(0.02 * FPS));

	const proc = new Float32Array(n);
	const win = preAvg + 1 + postAvg;
	for (let i = 0; i < n; i++) {
		let acc = 0;
		for (let k = -preAvg; k <= postAvg; k++) {
			const j = Math.min(n - 1, Math.max(0, i + k));
			acc += act[j];
		}
		proc[i] = Math.max(0, act[i] - acc / win);
	}

	const isPeak: number[] = [];
	for (let i = 0; i < n; i++) {
		let max = -Infinity;
		for (let k = -preMax; k <= postMax; k++) {
			const j = Math.min(n - 1, Math.max(0, i + k));
			if (proc[j] > max) max = proc[j];
		}
		if (proc[i] >= max && proc[i] >= threshold) isPeak.push(i);
	}

	const kept: number[] = [];
	let group: number[] = [];
	for (const idx of isPeak) {
		if (group.length === 0 || idx - group[group.length - 1] <= combine) {
			group.push(idx);
		} else {
			kept.push(group.reduce((a, b) => (proc[b] > proc[a] ? b : a)));
			group = [idx];
		}
	}
	if (group.length > 0) kept.push(group.reduce((a, b) => (proc[b] > proc[a] ? b : a)));

	return { frames: kept, heights: proc };
}

/** Keep absolute activation strength when a track contains only marginal detections. */
export function activationStream(activation: Float32Array, threshold: number): DrumStream {
	const { frames: peaks, heights } = pickActivationPeaks(activation, threshold);
	const sorted = peaks.map((i) => heights[i]).sort((a, b) => a - b);
	const top = Math.max(STRONG_ONSET_EXCESS, sorted[Math.floor(sorted.length * 0.9)] ?? 0);
	const levelCurve = Float32Array.from(heights, (height) =>
		Math.min(1, height / top) * Math.min(1, height / STRONG_ONSET_EXCESS)
	);
	return {
		times: peaks.map((i) => i / FPS),
		levels: peaks.map((i) => Math.min(1, heights[i] / top) * Math.min(1, heights[i] / STRONG_ONSET_EXCESS)),
		// Pattern completion needs a fresh onset, not sustained class activation.
		curve: heights,
		levelCurve,
		fps: FPS
	};
}

/** Snare peaks that look like hi-hat clicks read through the model's backbeat prior. */
export function hatClickSuspects(
	snare: DrumStream,
	snareAct: Float32Array,
	hatAct: Float32Array
): number[] {
	const suspects: number[] = [];
	for (const time of snare.times) {
		const frame = Math.round(time * snare.fps);
		const act = snareAct[frame] ?? 0;
		let hat = 0;
		for (let k = Math.max(0, frame - 1); k <= Math.min(hatAct.length - 1, frame + 1); k++) {
			if (hatAct[k] > hat) hat = hatAct[k];
		}
		if (act < CLICK_SNARE_MAX && hat > CLICK_HAT_RATIO * act) suspects.push(time);
	}
	return suspects;
}

/** The shipped streams from a whole-track activation matrix (frames x CLASSES, 100 Hz). */
export function onsetsFromActivations(act: Float32Array): AdtofOnsets {
	const frames = Math.floor(act.length / CLASSES);
	const classActivation = (c: number): Float32Array => {
		const out = new Float32Array(frames);
		for (let t = 0; t < frames; t++) out[t] = act[t * CLASSES + c];
		return out;
	};
	const snareAct = classActivation(1);
	const hatAct = classActivation(3);
	const snare = activationStream(snareAct, THRESHOLDS[1]);
	return {
		kick: activationStream(classActivation(0), THRESHOLDS[0]),
		snare,
		hat: activationStream(hatAct, HAT_THRESHOLD),
		cymbal: activationStream(classActivation(4), THRESHOLDS[4]),
		snareClicks: hatClickSuspects(snare, snareAct, hatAct)
	};
}

export class Adtof {
	private readonly session: OnnxSession;
	private readonly bank: AdtofFilterbank;

	private constructor(session: OnnxSession) {
		this.session = session;
		this.bank = adtofFilterbank();
	}

	/** Null when the model file is absent: the DSP detector is the life without it. */
	static async create(): Promise<Adtof | null> {
		const path = join(MODEL_DIR, MODEL_FILE);
		if (!existsSync(path)) return null;
		const session = await openSession(path, { intraOpNumThreads: 0, ...QUIET_THREADS });
		return new Adtof(session);
	}

	async close(): Promise<void> {
		await this.session.release();
	}

	/** `mono` must be 44.1 kHz: the filterbank is a property of the training frontend. */
	async run(
		mono: Float32Array,
		probe?: { activations?: Float32Array }
	): Promise<AdtofOnsets> {
		const frames = 1 + Math.floor(mono.length / HOP);
		const spec = adtofSpectrogram(mono, this.bank);

		const result = await this.session.run({
			spectrogram: { data: spec, dims: [1, frames, this.bank.nBins, 1] }
		}, { transfer: true });
		const act = result.activations.data;
		if (probe) probe.activations = act;
		return onsetsFromActivations(act);
	}
}
