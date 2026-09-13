import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { demucsSpec, demucsIspec } from './dsp/separationFft.ts';
import { allFinite } from './dsp/stats.ts';
import { MODEL_DIR } from './paths.ts';
import { createCachedCpuSession, hashFile } from './cpuGraphCache.ts';
import {
	QUIET_THREADS, openSession, type OnnxSession, type OnnxTensor, type OpenSession
} from './onnxSession.ts';

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
interface Ort {
	env?: { versions?: { node?: string; common?: string } };
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
/** A plain loop: Float32Array.from with a mapping function is far slower on whole songs. */
function mono([left, right]: Stereo): Float32Array {
	const out = new Float32Array(left.length);
	for (let i = 0; i < left.length; i++) out[i] = (left[i] + right[i]) / 2;
	return out;
}

const usesDirectMl = (options: Record<string, unknown>) =>
	(options.executionProviders as string[])[0] === 'dml';

/** Two lanes need eight intra-op threads and memory for two sets of HTDemucs activations. */
function defaultLanes(): number {
	return availableParallelism() >= 8 && totalmem() >= 12 * 1024 ** 3 ? 2 : 1;
}

export class DrumSeparator {
	private modelDir: string;
	private threads: number;
	private lanes: number;
	private graphCacheDir?: string;
	private provider: SeparationProvider;
	private cpuArena?: boolean;
	private pending: Promise<unknown> = Promise.resolve();
	private closed = false;
	private warmDrums: Promise<OnnxSession> | null = null;
	private constructor(
		modelDir: string, threads: number, lanes: number, graphCacheDir?: string,
		provider: SeparationProvider = 'cpu', cpuArena?: boolean
	) {
		this.modelDir = modelDir;
		this.threads = threads;
		this.lanes = lanes;
		this.graphCacheDir = graphCacheDir;
		this.provider = provider;
		this.cpuArena = cpuArena;
	}

	/** Both optional, MIT-licensed exports must be installed; see bench/setup-drum-separation.py. */
	static async create(
		modelDir = MODEL_DIR,
		options: {
			threads?: number; lanes?: number; graphCacheDir?: string; provider?: SeparationProvider;
			cpuArena?: boolean;
		} = {}
	): Promise<DrumSeparator | null> {
		const provider = options.provider ?? 'cpu';
		if (provider !== 'cpu' && provider !== 'dml') throw new Error(`Unsupported separator provider: ${provider}`);
		if (provider === 'dml' && process.platform !== 'win32') throw new Error('DirectML separation requires Windows.');
		if (Object.values(FILES).some(file => !existsSync(join(modelDir, file.name)))) return null;
		// DrumSep's CPU output changes with the intra-op thread count, not with the lane count.
		const threads = options.threads ?? 4;
		if (!Number.isInteger(threads) || threads < 1 || threads > 16) {
			throw new Error('Separator threads must be an integer from 1 to 16.');
		}
		const lanes = options.lanes ?? defaultLanes();
		if (!Number.isInteger(lanes) || lanes < 1 || lanes > 4) {
			throw new Error('Separator lanes must be an integer from 1 to 4.');
		}
		const separator = new DrumSeparator(
			modelDir, threads, lanes, options.graphCacheDir, provider, options.cpuArena
		);
		// DirectML never writes the CPU graph cache, so HTDemucs may compile while the checksums run.
		const htdemucs = join(modelDir, FILES.htdemucs.name);
		const warmDrums = provider === 'dml'
			? openSession(htdemucs, separator.sessionOptions('drums', 'dml')) : null;
		warmDrums?.catch(() => {});
		try {
			const files = Object.values(FILES);
			const hashes = await Promise.all(files.map(file => hashFile(join(modelDir, file.name))));
			for (const [index, file] of files.entries()) {
				if (hashes[index] !== file.sha256) {
					throw new Error(`Drum separator model checksum mismatch: ${file.name}`);
				}
			}
		} catch (error) {
			await warmDrums?.then(session => session.release(), () => {});
			throw error;
		}
		separator.warmDrums = warmDrums;
		return separator;
	}

	/** Stereo float PCM at 44.1 kHz. Calls run one at a time. */
	run(
		left: Float32Array, right: Float32Array, progress?: (p: SeparationProgress) => void
	): Promise<SeparatedDrums> {
		if (this.closed) return Promise.reject(new Error('Drum separator is closed.'));
		if (left.length !== right.length) {
			return Promise.reject(new Error('Drum separator channels must have equal lengths.'));
		}
		if (!allFinite(left) || !allFinite(right)) {
			return Promise.reject(new Error('Drum separator PCM must be finite.'));
		}
		const work = this.pending.then(() => this.separate([left, right], progress));
		this.pending = work.catch(() => undefined);
		return work;
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.pending;
		const warm = this.warmDrums;
		this.warmDrums = null;
		await warm?.then(session => session.release(), () => {});
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
		// DirectML compiles DrumSep on its first run, so that runs while HTDemucs holds the device.
		let warmKit = this.provider === 'dml' ? this.warmDirectMlKit() : null;
		warmKit?.catch(() => {});
		const openKit: OpenSession = (path, options) => {
			const session = warmKit;
			if (!session || !usesDirectMl(options)) return openSession(path, options);
			warmKit = null;
			return session;
		};
		const openDrums: OpenSession = (path, options) => {
			const session = this.warmDrums;
			if (!session || !usesDirectMl(options)) return openSession(path, options);
			this.warmDrums = null;
			return session;
		};
		try {
			const [drums] = await this.stage(input, 'drums', openDrums, progress);
			const [kick, snare, cymbal] = await this.stage(drums, 'kit', openKit, progress);
			return {
				sampleRate: RATE, drums: mono(drums), kick: mono(kick), snare: mono(snare),
				cymbal: mono(cymbal)
			};
		} finally {
			await warmKit?.then(session => session.release(), () => {});
		}
	}

	/** DirectML outputs do not depend on earlier runs; an all-zero chunk only compiles kernels. */
	private async warmDirectMlKit(): Promise<OnnxSession> {
		const path = join(this.modelDir, FILES.drumsep.name);
		const session = await openSession(path, this.sessionOptions('kit', 'dml'));
		try {
			const frames = Math.ceil(DRUMSEP_SAMPLES / 1024);
			await session.run({
				waveform: { data: new Float32Array(2 * DRUMSEP_SAMPLES), dims: [1, 2, DRUMSEP_SAMPLES] },
				magnitude: { data: new Float32Array(4 * 2048 * frames), dims: [1, 4, 2048, frames] }
			}, { transfer: true });
			return session;
		} catch (error) {
			await session.release();
			throw error;
		}
	}

	private sessionOptions(stage: 'drums' | 'kit', provider: SeparationProvider): Record<string, unknown> {
		return {
			executionProviders: provider === 'dml' ? ['dml', 'cpu'] : ['cpu'], graphOptimizationLevel: 'all',
			enableCpuMemArena: this.cpuArena ?? stage !== 'drums', intraOpNumThreads: this.threads,
			interOpNumThreads: 1,
			...(provider === 'dml' ? {
				enableMemPattern: false, executionMode: 'sequential',
				// ORT 1.27 DirectML fusion corrupts this HTDemucs graph's finite output.
				...(stage === 'drums' ? { extra: { ep: { dml: { disable_graph_fusion: '1' } } } }
					: {})
			} : {})
		};
	}

	private async stage(
		input: Stereo, stage: 'drums' | 'kit', open: OpenSession,
		progress?: (p: SeparationProgress) => void
	): Promise<Stereo[]> {
		try {
			return await this.stageWithProvider(input, stage, open, this.provider, progress);
		} catch (error) {
			if (this.provider !== 'dml') throw error;
			console.warn(`DirectML ${stage} separation failed; restarting stage on CPU.`, error);
			return this.stageWithProvider(input, stage, open, 'cpu', progress);
		}
	}

	private async stageWithProvider(
		input: Stereo, stage: 'drums' | 'kit', open: OpenSession, provider: SeparationProvider,
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
		const model = FILES[stage === 'drums' ? 'htdemucs' : 'drumsep'];
		const modelPath = join(this.modelDir, model.name);
		const sessionOptions = this.sessionOptions(stage, provider);
		// DirectML serializes a session's runs; CPU lanes share the chunk queue.
		const lanes = provider === 'dml' ? 1 : Math.min(this.lanes, total);
		const openLane = () => provider === 'dml'
			? open(modelPath, sessionOptions)
			: createCachedCpuSession({
				modelPath, modelSha256: model.sha256, cacheDir: this.graphCacheDir,
				runtimeVersion: runtimeVersion(), sessionOptions,
				load: (path, options) =>
					open(path, lanes > 1 ? { ...options, ...QUIET_THREADS } : options)
			});
		const sessions: OnnxSession[] = [];
		const idle: OnnxSession[] = [];
		const waiting: ((session: OnnxSession) => void)[] = [];
		let failed = false;
		const lend = (session: OnnxSession) => {
			const next = waiting.shift();
			if (next) next(session);
			else idle.push(session);
		};
		const name = stage === 'drums' ? 'mix' : 'waveform';
		// Chunk inputs are prepared while earlier chunks run; results commit strictly in order.
		const launch = (offset: number): Promise<Record<string, OnnxTensor>> => {
			const count = Math.min(segment, length - offset);
			// The DrumSep graph's dynamic axes retain internal traced padding branches.
			// Fixed, validated chunk lengths also bound recurrent state and activation memory.
			const trim = Math.floor((segment - count) / 2);
			const start = offset - trim;
			const mix = new Float32Array(2 * segment);
			for (let c = 0; c < 2; c++) {
				for (let i = Math.max(0, start); i < Math.min(length, start + segment); i++) {
					mix[c * segment + i - start] = (input[c][i] - mean) / std;
				}
			}
			const feeds = {
				[name]: { data: mix, dims: [1, 2, segment] },
				magnitude: { data: demucsSpec(mix, segment), dims: [1, 4, 2048, Math.ceil(segment / 1024)] }
			};
			const infer = (session: OnnxSession) => failed
				? (lend(session), Promise.reject(new Error(`Abandoned ${stage} separator chunk.`)))
				: session.run(feeds, { transfer: true }).finally(() => lend(session));
			const session = idle.pop();
			if (session) return infer(session);
			return new Promise<OnnxSession>(accept => waiting.push(accept)).then(infer);
		};
		const inflight = new Map<number, Promise<Record<string, OnnxTensor>>>();
		let opening: Promise<void> = Promise.resolve();
		try {
			const first = await openLane();
			sessions.push(first);
			idle.push(first);
			// A session on this thread cannot overlap runs, so more lanes would only add memory.
			const width = first.detached ? lanes : 1;
			opening = (async () => {
				try {
					for (let lane = 1; lane < width && !failed; lane++) {
						const session = await openLane();
						sessions.push(session);
						lend(session);
					}
				} catch { /* Lanes that opened keep working. */ }
			})();
			for (let k = 0, completed = 0; k < total; k++) {
				for (let next = inflight.size + k; next < Math.min(total, k + width + 1); next++) {
					const work = launch(next * stride);
					work.catch(() => {});
					inflight.set(next, work);
				}
				const predicted = await inflight.get(k)!;
				inflight.delete(k);
				const offset = k * stride;
				const count = Math.min(segment, length - offset);
				const trim = Math.floor((segment - count) / 2);
				const wave = predicted.time_output.data;
				const frequency = demucsIspec(predicted.freq_output.data, segment, outputs.length);
				if (wave.length !== (stage === 'drums' ? 2 : 8) * segment) {
					throw new Error(`Unexpected ${stage} separator output shape.`);
				}
				for (let i = 0; i < count; i++) {
					const weight = Math.min(i + 1, segment - i) / (segment / 2);
					weights[offset + i] += weight;
					for (let s = 0; s < outputs.length; s++) for (let c = 0; c < 2; c++) {
						const index = (s * 2 + c) * segment + trim + i;
						const summed = wave[index] + frequency[index];
						const value = (stage === 'drums' ? Math.fround(summed) : summed) * std + mean;
						if (!Number.isFinite(value)) throw new Error(`Non-finite ${stage} separator output.`);
						outputs[s][c][offset + i] += value * weight;
					}
				}
				progress?.({ stage, provider, completed: ++completed, total });
			}
			await opening;
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			await Promise.allSettled([...inflight.values(), opening]);
			await Promise.all(sessions.map(session => session.release()));
		}
		for (const source of outputs) for (const channel of source) {
			for (let i = 0; i < length; i++) channel[i] /= weights[i];
		}
		return outputs;
	}
}

function runtimeVersion(): string | undefined {
	const ort = createRequire(import.meta.url)('onnxruntime-node') as Ort;
	return ort.env?.versions?.node ?? ort.env?.versions?.common;
}
