import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { demucsSpec, demucsIspec } from './dsp/separationFft.ts';
import { MODEL_DIR } from './paths.ts';
import { createCachedCpuSession, hashFile } from './cpuGraphCache.ts';

export const SEPARATION_VERSION = 'htdemucs-a6eabce3-drumsep-e35619ce-v4';
const RATE = 44100;
const DEMUCS_SAMPLES = 343980;
const DRUMSEP_SAMPLES = 352800;
const FILES = {
	htdemucs: {
		name: 'htdemucs.onnx',
		sha256: 'a6eabce31c0866a7ad7ac545dc7b12fbe4ccd0c86731e94e99fd5b583da504df'
	},
	drumsep: {
		name: 'drumsep.onnx',
		sha256: 'e35619cef17d1aeaf410dae9d9895f3814cccc51b7a0deecbf543fe0131d7002'
	}
} as const;

export interface SeparationProgress {
	stage: 'drums' | 'kit';
	provider: SeparationProvider;
	completed: number;
	total: number;
}
export interface SeparatedDrums {
	sampleRate: 44100;
	drums: Float32Array;
	kick: Float32Array;
	snare: Float32Array;
	cymbal: Float32Array;
}
interface Session {
	run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
	release(): Promise<void>;
}
interface Ort {
	env?: { versions?: { node?: string; common?: string } };
	InferenceSession: { create(path: string, options: unknown): Promise<Session> };
	Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}
type Stereo = [Float32Array, Float32Array];
type SeparationProvider = 'cpu' | 'dml';

/** Demucs normalizes against the channel mean, using the unbiased sample deviation. */
function normalization([left, right]: Stereo): { mean: number; std: number } {
	let mean = 0;
	for (let i = 0; i < left.length; i++) mean += (left[i] + right[i]) / 2;
	mean /= left.length || 1;
	let variance = 0;
	for (let i = 0; i < left.length; i++) variance += ((left[i] + right[i]) / 2 - mean) ** 2;
	return { mean, std: Math.sqrt(variance / Math.max(1, left.length - 1)) };
}
function mono([left, right]: Stereo): Float32Array {
	return Float32Array.from(left, (v, i) => (v + right[i]) / 2);
}

export class DrumSeparator {
	private modelDir: string;
	private threads: number;
	private graphCacheDir?: string;
	private provider: SeparationProvider;
	private cpuArena?: boolean;
	private pending: Promise<unknown> = Promise.resolve();
	private closed = false;
	private constructor(modelDir: string, threads: number, graphCacheDir?: string, provider: SeparationProvider = 'cpu', cpuArena?: boolean) {
		this.modelDir = modelDir;
		this.threads = threads;
		this.graphCacheDir = graphCacheDir;
		this.provider = provider;
		this.cpuArena = cpuArena;
	}

	/** Both optional, MIT-licensed exports must be installed; see bench/setup-drum-separation.py. */
	static async create(
		modelDir = MODEL_DIR, options: { threads?: number; graphCacheDir?: string; provider?: SeparationProvider; cpuArena?: boolean } = {}
	): Promise<DrumSeparator | null> {
		const provider = options.provider ?? 'cpu';
		if (provider !== 'cpu' && provider !== 'dml') throw new Error(`Unsupported separator provider: ${provider}`);
		if (provider === 'dml' && process.platform !== 'win32') throw new Error('DirectML separation requires Windows.');
		if (Object.values(FILES).some(file => !existsSync(join(modelDir, file.name)))) return null;
		for (const file of Object.values(FILES)) {
			if (await hashFile(join(modelDir, file.name)) !== file.sha256) {
				throw new Error(`Drum separator model checksum mismatch: ${file.name}`);
			}
		}
		const threads = options.threads ?? 4;
		if (!Number.isInteger(threads) || threads < 1 || threads > 16) {
			throw new Error('Separator threads must be an integer from 1 to 16.');
		}
		return new DrumSeparator(modelDir, threads, options.graphCacheDir, provider, options.cpuArena);
	}

	/** Stereo float PCM at 44.1 kHz. Calls serialize to keep only one model session in memory. */
	run(
		left: Float32Array, right: Float32Array, progress?: (p: SeparationProgress) => void
	): Promise<SeparatedDrums> {
		if (this.closed) return Promise.reject(new Error('Drum separator is closed.'));
		if (left.length !== right.length) {
			return Promise.reject(new Error('Drum separator channels must have equal lengths.'));
		}
		if (!left.every(Number.isFinite) || !right.every(Number.isFinite)) {
			return Promise.reject(new Error('Drum separator PCM must be finite.'));
		}
		const work = this.pending.then(() => this.separate([left, right], progress));
		this.pending = work.catch(() => undefined);
		return work;
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.pending;
	}

	private async separate(
		input: Stereo, progress?: (p: SeparationProgress) => void
	): Promise<SeparatedDrums> {
		const length = input[0].length;
		if (normalization(input).std <= 1e-8) {
			return {
				sampleRate: RATE, drums: new Float32Array(length),
				kick: new Float32Array(length), snare: new Float32Array(length),
				cymbal: new Float32Array(length)
			};
		}
		const require = createRequire(import.meta.url);
		const ort = require('onnxruntime-node') as Ort;
		const [drums] = await this.stage(input, 'drums', ort, progress);
		const [kick, snare, cymbal] = await this.stage(drums, 'kit', ort, progress);
		return {
			sampleRate: RATE, drums: mono(drums), kick: mono(kick), snare: mono(snare),
			cymbal: mono(cymbal)
		};
	}

	private async stage(
		input: Stereo, stage: 'drums' | 'kit', ort: Ort,
		progress?: (p: SeparationProgress) => void
	): Promise<Stereo[]> {
		try {
			return await this.stageWithProvider(input, stage, ort, this.provider, progress);
		} catch (error) {
			if (this.provider !== 'dml') throw error;
			console.warn(`DirectML ${stage} separation failed; restarting stage on CPU.`, error);
			return this.stageWithProvider(input, stage, ort, 'cpu', progress);
		}
	}

	private async stageWithProvider(
		input: Stereo, stage: 'drums' | 'kit', ort: Ort, provider: SeparationProvider,
		progress?: (p: SeparationProgress) => void
	): Promise<Stereo[]> {
		const length = input[0].length;
		const { mean, std } = normalization(input);
		const outputs: Stereo[] = Array.from({ length: stage === 'drums' ? 1 : 3 },
			() => [new Float32Array(length), new Float32Array(length)]);
		if (std <= 1e-8) return outputs;
		const segment = stage === 'drums' ? DEMUCS_SAMPLES : DRUMSEP_SAMPLES;
		const stride = Math.floor(segment * .75);
		const total = Math.ceil(length / stride);
		const weights = new Float32Array(length);
		progress?.({ stage, provider, completed: 0, total });
		const modelPath = join(this.modelDir, FILES[stage === 'drums' ? 'htdemucs' : 'drumsep'].name);
		const sessionOptions = {
			executionProviders: provider === 'dml' ? ['dml', 'cpu'] : ['cpu'], graphOptimizationLevel: 'all',
			enableCpuMemArena: this.cpuArena ?? stage !== 'drums', intraOpNumThreads: this.threads, interOpNumThreads: 1,
			...(provider === 'dml' ? {
				enableMemPattern: false, executionMode: 'sequential',
				// ORT 1.27 DirectML fusion corrupts this HTDemucs graph's finite output.
				...(stage === 'drums' ? { extra: { ep: { dml: { disable_graph_fusion: '1' } } } }
					: {})
			} : {})
		};
		const session = provider === 'dml' ? await ort.InferenceSession.create(modelPath, sessionOptions)
			: await createCachedCpuSession({
			modelPath, modelSha256: FILES[stage === 'drums' ? 'htdemucs' : 'drumsep'].sha256,
			cacheDir: this.graphCacheDir, runtimeVersion: ort.env?.versions?.node ?? ort.env?.versions?.common,
			sessionOptions,
			load: (path, options) => ort.InferenceSession.create(path, options)
		});
		try {
			for (let offset = 0, completed = 0; offset < length; offset += stride) {
				const count = Math.min(segment, length - offset);
				// The DrumSep graph's dynamic axes retain internal traced padding branches.
				// Fixed, validated chunk lengths also bound recurrent state and activation memory.
				const chunkLength = segment;
				const trim = Math.floor((chunkLength - count) / 2);
				const start = offset - trim;
				const mix = new Float32Array(2 * chunkLength);
				for (let c = 0; c < 2; c++) {
					for (let i = Math.max(0, start); i < Math.min(length, start + chunkLength); i++) {
						mix[c * chunkLength + i - start] = (input[c][i] - mean) / std;
					}
				}
				const feeds: Record<string, unknown> = {
					[stage === 'drums' ? 'mix' : 'waveform']:
						new ort.Tensor('float32', mix, [1, 2, chunkLength])
				};
				feeds.magnitude = new ort.Tensor('float32', demucsSpec(mix, chunkLength),
					[1, 4, 2048, Math.ceil(chunkLength / 1024)]);
				const predicted = await session.run(feeds);
				const wave = predicted.time_output.data;
				const frequency = demucsIspec(predicted.freq_output.data, chunkLength, outputs.length);
				if (wave.length !== (stage === 'drums' ? 2 : 8) * chunkLength) throw new Error(`Unexpected ${stage} separator output shape.`);
				for (let i = 0; i < count; i++) {
					const weight = Math.min(i + 1, segment - i) / (segment / 2);
					weights[offset + i] += weight;
					for (let s = 0; s < outputs.length; s++) for (let c = 0; c < 2; c++) {
						const index = (s * 2 + c) * chunkLength + trim + i;
						const summed = wave[index] + frequency[index];
						const value = (stage === 'drums' ? Math.fround(summed) : summed) * std + mean;
						if (!Number.isFinite(value)) throw new Error(`Non-finite ${stage} separator output.`);
						outputs[s][c][offset + i] += value * weight;
					}
				}
				progress?.({ stage, provider, completed: ++completed, total });
			}
		} finally {
			await session.release();
		}
		for (const source of outputs) for (const channel of source) {
			for (let i = 0; i < length; i++) channel[i] /= weights[i];
		}
		return outputs;
	}
}
