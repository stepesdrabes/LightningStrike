import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { RealFft } from './dsp/fft.ts';
import { MODEL_DIR } from './paths.ts';
import type { DrumStream } from './drums.ts';

/**
 * ADTOF Frame_RNN (Zehren, Alunno, Bientinesi 2023), exported by bench/export-adtof.py.
 * CC BY-NC-SA weights stay local and optional. The model classifies hits; broadband onsets place them.
 */
const MODEL_FILE = 'adtof_frame_rnn.onnx';

/** The model's spectrogram contract, from the training frontend. Not tunable. */
const SAMPLE_RATE = 44100;
const FPS = 100;
const FRAME_SIZE = 2048;
const HOP = 441;
const BANDS_PER_OCTAVE = 12;
const FMIN = 20;
const FMAX = 20000;

/** Per-class peak thresholds from the port's defaults: kick, snare, tom, hat, cymbal. */
const THRESHOLDS = [0.22, 0.24, 0.32, 0.22, 0.3] as const;
const CLASSES = 5;

export interface AdtofOnsets {
	kick: DrumStream;
	snare: DrumStream;
	hat: DrumStream;
	/** Crash/ride activations, kept for the crash-event work even though no stream ships. */
	cymbalTimes: number[];
}

/**
 * Match the training filterbank exactly: snap log-spaced frequencies to unique ascending FFT
 * bins, then use unit-area triangles at interior bins.
 */
function buildFilterbank(): { filters: Float32Array; nBins: number; fftBins: number } {
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
	return { filters, nBins, fftBins };
}

/** np.hanning: symmetric, unlike the analysis stack's periodic COLA window. */
function hannSymmetric(size: number): Float32Array {
	const w = new Float32Array(size);
	for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
	return w;
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

interface Session {
	run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
	release?(): Promise<void>;
}
type TensorCtor = new (type: string, data: Float32Array, dims: number[]) => unknown;

interface Ort {
	InferenceSession: { create(path: string, opts: unknown): Promise<Session> };
	Tensor: TensorCtor;
}

/** Load the native addon through createRequire so bundlers cannot replace it with a throwing stub. */
function loadOrt(): Ort {
	const require = createRequire(import.meta.url);
	return require('onnxruntime-node') as Ort;
}

export class Adtof {
	private readonly session: Session;
	private readonly Tensor: TensorCtor;
	private readonly filters: Float32Array;
	private readonly nBins: number;
	private readonly fftBins: number;

	private constructor(session: Session, Tensor: TensorCtor) {
		this.session = session;
		this.Tensor = Tensor;
		const fb = buildFilterbank();
		this.filters = fb.filters;
		this.nBins = fb.nBins;
		this.fftBins = fb.fftBins;
	}

	/** Null when the model file is absent: the DSP detector is the life without it. */
	static async create(): Promise<Adtof | null> {
		const path = join(MODEL_DIR, MODEL_FILE);
		if (!existsSync(path)) return null;
		const ort = loadOrt();
		const session = await ort.InferenceSession.create(path, {
			// Serialise inference: competing graphs saturate CPU and slow each other.
			intraOpNumThreads: 0
		});
		return new Adtof(session, ort.Tensor);
	}

	async close(): Promise<void> {
		await this.session.release?.();
	}

	/** `mono` must be 44.1 kHz: the filterbank is a property of the training frontend. */
	async run(mono: Float32Array): Promise<AdtofOnsets> {
		const frames = 1 + Math.floor(mono.length / HOP);
		const spec = new Float32Array(frames * this.nBins);
		const fft = new RealFft(FRAME_SIZE);
		const window = hannSymmetric(FRAME_SIZE);
		const mags = new Float32Array(FRAME_SIZE / 2 + 1);

		for (let t = 0; t < frames; t++) {
			// centre-aligned like librosa's center=True, zero-padded past either end.
			fft.magnitudes(mono, t * HOP - FRAME_SIZE / 2, window, mags, 1);
			const out = t * this.nBins;
			for (let i = 0; i < this.nBins; i++) {
				const row = i * this.fftBins;
				let acc = 0;
				for (let b = 0; b < this.fftBins; b++) acc += this.filters[row + b] * mags[b];
				spec[out + i] = Math.log10(1 + acc);
			}
		}

		const result = await this.session.run({
			spectrogram: new this.Tensor('float32', spec, [1, frames, this.nBins, 1]) as never
		});
		const act = result.activations.data as Float32Array;

		const classActivation = (c: number): Float32Array => {
			const out = new Float32Array(frames);
			for (let t = 0; t < frames; t++) out[t] = act[t * CLASSES + c];
			return out;
		};

		const stream = (c: number): DrumStream => {
			const activation = classActivation(c);
			const { frames: peaks, heights } = pickActivationPeaks(activation, THRESHOLDS[c]);
			// Normalise against strong track-local hits so model and DSP hit sizes agree.
			const sorted = peaks.map((i) => heights[i]).sort((a, b) => a - b);
			const top = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.9)] || 1 : 1;
			const scale = top > 1e-9 ? 1 / top : 0;
			return {
				times: peaks.map((i) => i / FPS),
				levels: peaks.map((i) => Math.min(1, heights[i] * scale)),
				curve: activation,
				fps: FPS
			};
		};

		const cymbal = pickActivationPeaks(classActivation(4), THRESHOLDS[4]);
		return {
			kick: stream(0),
			snare: stream(1),
			hat: stream(3),
			cymbalTimes: cymbal.frames.map((i) => i / FPS)
		};
	}
}
