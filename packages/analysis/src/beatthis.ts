import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RealFft, hannWindow } from './dsp/fft.ts';
import { QUIET_THREADS, openSession, type OnnxSession } from './onnxSession.ts';
import { MODEL_DIR } from './paths.ts';

/**
 * Beat This! (Foscarin, Schlüter & Widmer, ISMIR 2024); benchmark: bench/beatscore.ts.
 * metricalLevel.ts judges the tempo octave. Match the frontend exactly, including arithmetic
 * channel averaging: ffmpeg -ac 1 runs sqrt(2) hot and changes the log1p feature shape.
 */

const N_FFT = 1024;
const HOP = 441;
const MEL_BINS = 128;
const FPS = 50;
const CHUNK = 1500;
const BORDER = 6;
const LOG_MULTIPLIER = 1000;
/** Maxima over +/- 3 frames, which at 50 fps is the +/- 70 ms the paper picks. */
const PEAK_RADIUS = 3;

const MODEL_HOST = 'https://huggingface.co/musetric/beat-this-onnx/resolve/main';
const FILES = [
	{
		name: 'beat_this.onnx',
		sha256: '078572af6ca47741e06a82d09525d13c793eaa8e311a8cf15e831dcd7e73f218'
	},
	{
		name: 'mel-filterbank.bin',
		sha256: '1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533'
	}
] as const;

function modelsPresent(): boolean {
	return FILES.every((f) => existsSync(join(MODEL_DIR, f.name)));
}

/**
 * Verify pinned model digests and rename completed temporary files so interrupted downloads
 * cannot pass existence checks.
 */
async function ensureModels(): Promise<void> {
	const dir = MODEL_DIR;
	mkdirSync(dir, { recursive: true });

	for (const file of FILES) {
		const path = join(dir, file.name);
		if (existsSync(path)) {
			const have = createHash('sha256').update(readFileSync(path)).digest('hex');
			if (have === file.sha256) continue;
		}

		// Bound downloads so one hung connection cannot wedge the ingest queue.
		const res = await fetch(`${MODEL_HOST}/${file.name}`, { signal: AbortSignal.timeout(300_000) });
		if (!res.ok) throw new Error(`${file.name}: ${res.status} ${res.statusText}`);
		const buf = Buffer.from(await res.arrayBuffer());

		const got = createHash('sha256').update(buf).digest('hex');
		if (got !== file.sha256) {
			throw new Error(`${file.name}: sha256 ${got}, expected ${file.sha256}`);
		}
		const tmp = `${path}.part`;
		writeFileSync(tmp, buf);
		renameSync(tmp, path);
	}
}

interface BeatThisResult {
	/** Beat times, seconds. */
	beats: number[];
	/** Downbeat times, a subset of `beats`. */
	downbeats: number[];
}

/**
 * Match torchaudio LogMelSpect: log1p(1000 * mel magnitude), centred reflect padding.
 * Frame f centres on f * hop; edge padding affects the first downbeat.
 */
function logMelSpectrogram(mono: Float32Array): { frames: number; data: Float32Array } {
	const raw = readFileSync(join(MODEL_DIR, 'mel-filterbank.bin'));
	const fb = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
	const bins = N_FFT / 2 + 1;
	if (fb.length !== bins * MEL_BINS) {
		throw new Error(`filterbank is ${fb.length} floats, expected ${bins * MEL_BINS}`);
	}

	const pad = N_FFT >> 1;
	const padded = new Float32Array(mono.length + 2 * pad);
	padded.set(mono, pad);
	for (let i = 0; i < pad; i++) {
		padded[pad - 1 - i] = mono[Math.min(i + 1, mono.length - 1)];
		padded[pad + mono.length + i] = mono[Math.max(mono.length - 2 - i, 0)];
	}

	const frames = 1 + Math.floor(mono.length / HOP);
	const fft = new RealFft(N_FFT);
	const window = hannWindow(N_FFT);
	const mags = new Float32Array(bins);
	const out = new Float32Array(frames * MEL_BINS);
	// torchaudio's normalized='frame_length' divides the magnitude by sqrt(win_length).
	const scale = 1 / Math.sqrt(N_FFT);
	// Zero weights add nothing to the finite, ascending sum, so each band reads only its span.
	const first = new Int32Array(MEL_BINS).fill(bins);
	const last = new Int32Array(MEL_BINS).fill(-1);
	for (let j = 0; j < MEL_BINS; j++) {
		for (let i = 0; i < bins; i++) {
			if (fb[i * MEL_BINS + j] === 0) continue;
			first[j] = Math.min(first[j], i);
			last[j] = i;
		}
	}

	for (let f = 0; f < frames; f++) {
		fft.magnitudes(padded, f * HOP, window, mags, scale);
		const o = f * MEL_BINS;
		for (let j = 0; j < MEL_BINS; j++) {
			let acc = 0;
			for (let i = first[j]; i <= last[j]; i++) acc += mags[i] * fb[i * MEL_BINS + j];
			out[o + j] = Math.log1p(LOG_MULTIPLIER * acc);
		}
	}
	return { frames, data: out };
}

/** Chunk starts, following the reference `split_piece`. */
function chunkStarts(frames: number): number[] {
	const step = CHUNK - 2 * BORDER;
	const starts: number[] = [];
	for (let s = -BORDER; s < frames - BORDER; s += step) starts.push(s);
	if (starts.length === 0) starts.push(-BORDER);
	// The last chunk shifts left to finish on the piece rather than run short.
	if (frames > step) starts[starts.length - 1] = frames - (CHUNK - BORDER);
	return starts;
}

/** Adjacent peaks within `width` collapse to their running mean, so a peak can be fractional. */
function deduplicatePeaks(peaks: readonly number[], width = 1): number[] {
	if (peaks.length === 0) return [];
	const out: number[] = [];
	let p = peaks[0];
	let c = 1;
	for (let i = 1; i < peaks.length; i++) {
		const p2 = peaks[i];
		if (p2 - p <= width) {
			c++;
			p += (p2 - p) / c;
		} else {
			out.push(p);
			p = p2;
			c = 1;
		}
	}
	out.push(p);
	return out;
}

function pickPeaks(logits: Float32Array): number[] {
	const n = logits.length;
	const raw: number[] = [];
	for (let i = 0; i < n; i++) {
		const v = logits[i];
		if (!(v > 0)) continue;
		let isMax = true;
		for (let k = Math.max(0, i - PEAK_RADIUS); k <= Math.min(n - 1, i + PEAK_RADIUS); k++) {
			if (logits[k] > v) {
				isMax = false;
				break;
			}
		}
		if (isMax) raw.push(i);
	}
	return deduplicatePeaks(raw, 1);
}

export class BeatThis {
	// Node strips types rather than compiling them, so no parameter properties here, any more
	// than in the packages this repo consumes as source.
	private session!: OnnxSession;

	/** Bench-only checkpoint override. Downloads always use the shipping model name. */
	static async create(file = 'beat_this.onnx'): Promise<BeatThis> {
		if (file === 'beat_this.onnx' && !modelsPresent()) await ensureModels();
		const self = new BeatThis();
		self.session = await openSession(join(MODEL_DIR, file), {
			executionProviders: ['cpu'],
			graphOptimizationLevel: 'all',
			...QUIET_THREADS
		});
		return self;
	}

	async close(): Promise<void> {
		await this.session.release();
	}

	/** 22050 Hz mono, the arithmetic mean of the channels. */
	async run(mono: Float32Array): Promise<BeatThisResult> {
		const { frames, data } = logMelSpectrogram(mono);
		const starts = chunkStarts(frames);

		// -1000 is the reference's "no prediction here": a logit that cannot clear the
		// threshold, so an unwritten frame can never be picked as a peak.
		const beat = new Float32Array(frames).fill(-1000);
		const downbeat = new Float32Array(frames).fill(-1000);
		const window = new Float32Array(CHUNK * MEL_BINS);

		// Reverse order under keep_first, so an earlier chunk wins the overlap.
		for (let c = starts.length - 1; c >= 0; c--) {
			const start = starts[c];
			window.fill(0);
			for (let t = 0; t < CHUNK; t++) {
				const src = start + t;
				if (src < 0 || src >= frames) continue;
				window.set(data.subarray(src * MEL_BINS, (src + 1) * MEL_BINS), t * MEL_BINS);
			}

			// One window per call: batching them materialises an attention tensor of
			// windows x 32 x 1500 x 1500 floats, which is gigabytes on a long track.
			const out = await this.session.run({ spect: { data: window, dims: [1, CHUNK, MEL_BINS] } });

			for (let t = BORDER; t < CHUNK - BORDER; t++) {
				const dst = start + t;
				if (dst < 0 || dst >= frames) continue;
				beat[dst] = out.beat.data[t];
				downbeat[dst] = out.downbeat.data[t];
			}
		}

		const beats = pickPeaks(beat).map((f) => f / FPS);
		let downbeats = pickPeaks(downbeat).map((f) => f / FPS);

		// Every downbeat is a beat, so each is snapped to the nearest one and then uniqued.
		if (beats.length > 0) {
			downbeats = downbeats.map((d) => {
				let best = beats[0];
				let bestD = Math.abs(beats[0] - d);
				for (const b of beats) {
					const delta = Math.abs(b - d);
					if (delta < bestD) {
						bestD = delta;
						best = b;
					}
				}
				return best;
			});
			downbeats = [...new Set(downbeats)].sort((a, b) => a - b);
		}

		return { beats, downbeats };
	}
}
