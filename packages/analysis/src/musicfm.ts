import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { RealFft, hannWindow } from './dsp/fft.ts';
import { MODEL_DIR } from './paths.ts';

/**
 * MusicFM (ByteDance 2023, MIT) plus an optional section head. Frontend constants and windowing
 * must match bench/extract-musicfm.py: 30 s pieces, 5 s discarded padding, variable track edges.
 * Verify parity with bench/musicfm-parity.ts.
 */
const ENCODER_FILE = 'musicfm_encoder_int8.onnx';
const HEAD_FILE = 'musicfm_sectionhead.onnx';
const FB_FILE = 'musicfm_mel_fb.bin';
const CONFIG_FILE = 'musicfm_config.json';

export const MUSICFM_RATE = 24000;
const N_FFT = 2048;
const HOP = 240;
const N_MELS = 128;
const FREQ_BINS = N_FFT / 2 + 1;
const WIN = 30 * MUSICFM_RATE;
const PAD = 5 * MUSICFM_RATE;
const POOL = 3;

interface MusicFmConfig {
	melMean: number;
	melStd: number;
	kinds: string[];
}

/**
 * Match torchaudio MelSpectrogram + AmplitudeToDB: unnormalised power, Hann window, centred
 * reflect padding, saved HTK filterbank, then 10*log10(max(x, 1e-10)). Return frame-major mel
 * values with the last frame dropped, matching model preprocessing.
 */
export function melSpectrogram(piece: Float32Array, fb: Float32Array): Float32Array {
	const pad = N_FFT >> 1;
	const padded = new Float32Array(piece.length + 2 * pad);
	padded.set(piece, pad);
	for (let i = 0; i < pad; i++) {
		padded[pad - 1 - i] = piece[Math.min(i + 1, piece.length - 1)];
		padded[pad + piece.length + i] = piece[Math.max(piece.length - 2 - i, 0)];
	}

	const frames = Math.floor(piece.length / HOP);
	const fft = new RealFft(N_FFT);
	const window = hannWindow(N_FFT);
	const mags = new Float32Array(FREQ_BINS);
	const out = new Float32Array(frames * N_MELS);

	for (let f = 0; f < frames; f++) {
		fft.magnitudes(padded, f * HOP, window, mags, 1);
		const o = f * N_MELS;
		for (let i = 0; i < FREQ_BINS; i++) {
			const power = mags[i] * mags[i];
			if (power === 0) continue;
			const row = i * N_MELS;
			for (let m = 0; m < N_MELS; m++) out[o + m] += power * fb[row + m];
		}
		for (let m = 0; m < N_MELS; m++) {
			out[o + m] = 10 * Math.log10(Math.max(out[o + m], 1e-10));
		}
	}
	return out;
}

/** Label precomputed embeddings without loading the large encoder. */
export class MusicFmHead {
	private readonly session: ort.InferenceSession;
	readonly kinds: readonly string[];

	private constructor(session: ort.InferenceSession, kinds: readonly string[]) {
		this.session = session;
		this.kinds = kinds;
	}

	static async create(): Promise<MusicFmHead | null> {
		const headPath = join(MODEL_DIR, HEAD_FILE);
		const configPath = join(MODEL_DIR, CONFIG_FILE);
		if (!existsSync(headPath) || !existsSync(configPath)) return null;
		const config = JSON.parse(readFileSync(configPath, 'utf8')) as MusicFmConfig;
		const session = await ort.InferenceSession.create(headPath, { intraOpNumThreads: 0 });
		return new MusicFmHead(session, config.kinds);
	}

	async close(): Promise<void> {
		await this.session.release();
	}

	/**
	 * Frame-major posteriors [t x kinds]. Append track position exactly as trained so intro/outro
	 * labels can observe the clock.
	 */
	async label(emb: { frames: number; data: Float32Array }): Promise<Float32Array> {
		const t = emb.frames;
		const classes = this.kinds.length;
		const input = new Float32Array(t * 1025);
		for (let f = 0; f < t; f++) {
			input.set(emb.data.subarray(f * 1024, (f + 1) * 1024), f * 1025);
			input[f * 1025 + 1024] = t > 1 ? f / (t - 1) : 0;
		}
		const result = await this.session.run({
			emb_pos: new ort.Tensor('float32', input, [1, t, 1025])
		});
		const logits = result.logits.data as Float32Array;

		const post = new Float32Array(t * classes);
		for (let f = 0; f < t; f++) {
			const o = f * classes;
			let max = -Infinity;
			for (let c = 0; c < classes; c++) max = Math.max(max, logits[o + c]);
			let sum = 0;
			for (let c = 0; c < classes; c++) {
				const e = Math.exp(logits[o + c] - max);
				post[o + c] = e;
				sum += e;
			}
			for (let c = 0; c < classes; c++) post[o + c] /= sum;
		}
		return post;
	}
}

export class MusicFm {
	private readonly encoder: ort.InferenceSession;
	private readonly head: MusicFmHead;
	private readonly fb: Float32Array;
	private readonly config: MusicFmConfig;

	private constructor(
		encoder: ort.InferenceSession,
		head: MusicFmHead,
		fb: Float32Array,
		config: MusicFmConfig
	) {
		this.encoder = encoder;
		this.head = head;
		this.fb = fb;
		this.config = config;
	}

	/** Null when any artefact is absent: the rules labeller is the life without it. */
	static async create(): Promise<MusicFm | null> {
		const paths = [ENCODER_FILE, FB_FILE, CONFIG_FILE].map((f) => join(MODEL_DIR, f));
		if (!paths.every((p) => existsSync(p))) return null;
		const head = await MusicFmHead.create();
		if (!head) return null;
		const raw = readFileSync(paths[1]);
		const fb = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
		if (fb.length !== FREQ_BINS * N_MELS) {
			throw new Error(`mel filterbank is ${fb.length} floats, expected ${FREQ_BINS * N_MELS}`);
		}
		const config = JSON.parse(readFileSync(paths[2], 'utf8')) as MusicFmConfig;
		// One graph at a time, like the other models: a second saturating session only
		// starves the first.
		const encoder = await ort.InferenceSession.create(paths[0], { intraOpNumThreads: 0 });
		return new MusicFm(encoder, head, fb, config);
	}

	async close(): Promise<void> {
		await this.encoder.release();
		await this.head.close();
	}

	get kinds(): readonly string[] {
		return this.config.kinds;
	}

	/**
	 * 24 kHz mono to layer-9 embeddings at 25/3 Hz, frame-major [t x 1024]. Match extraction
	 * windowing and drop incomplete pooled triples.
	 */
	async embed(mono: Float32Array): Promise<{ frames: number; data: Float32Array }> {
		const { melMean, melStd } = this.config;
		const chunks: Float32Array[] = [];
		let total = 0;

		for (let at = 0; at < mono.length; at += WIN) {
			const lo = Math.max(0, at - PAD);
			const hi = Math.min(mono.length, at + WIN + PAD);
			const mel = melSpectrogram(mono.subarray(lo, hi), this.fb);
			const frames = mel.length / N_MELS;
			// The graph wants [1, mel, time] normalised; the mel above is frame-major.
			const input = new Float32Array(N_MELS * frames);
			for (let f = 0; f < frames; f++) {
				for (let m = 0; m < N_MELS; m++) {
					input[m * frames + f] = (mel[f * N_MELS + m] - melMean) / melStd;
				}
			}
			const result = await this.encoder.run({
				mel_norm: new ort.Tensor('float32', input, [1, N_MELS, frames])
			});
			const hidden = result.hidden.data as Float32Array;
			const tokens = result.hidden.dims[1];

			const padLo = Math.round(((at - lo) / MUSICFM_RATE) * 25);
			const want = Math.round((Math.min(WIN, mono.length - at) / MUSICFM_RATE) * 25);
			const kept = hidden.slice(padLo * 1024, Math.min(padLo + want, tokens) * 1024);
			chunks.push(kept);
			total += kept.length / 1024;
		}

		const seq = new Float32Array(total * 1024);
		let w = 0;
		for (const c of chunks) {
			seq.set(c, w);
			w += c.length;
		}
		const pooled = Math.floor(total / POOL);
		const data = new Float32Array(pooled * 1024);
		for (let t = 0; t < pooled; t++) {
			const o = t * 1024;
			for (let p = 0; p < POOL; p++) {
				const row = (t * POOL + p) * 1024;
				for (let k = 0; k < 1024; k++) data[o + k] += seq[row + k];
			}
		}
		for (let i = 0; i < data.length; i++) data[i] /= POOL;
		return { frames: pooled, data };
	}

	/** Per-frame posteriors for a whole track's embeddings; see MusicFmHead.label. */
	async label(emb: { frames: number; data: Float32Array }): Promise<Float32Array> {
		return this.head.label(emb);
	}
}
