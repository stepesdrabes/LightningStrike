import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { MDX_BINS, MDX_HOP, mdxFrames, mdxIspec, mdxSpec } from './dsp/mdxFft.ts';
import { demucsSpec, demucsIspec } from './dsp/separationFft.ts';
import { allFinite } from './dsp/stats.ts';
import { MODEL_DIR } from './paths.ts';
import { cachedCpuGraph, createCachedCpuSession, hashFile } from './cpuGraphCache.ts';
import { metalAddonPath } from './metal/addon.ts';
import { mlasParallelism } from './metal/mlas.ts';
import {
	QUIET_THREADS, openMetalSession, openSession, type OnnxSession, type OnnxTensor, type OpenSession
} from './onnxSession.ts';

export const SEPARATION_VERSION = 'htdemucs-a6eabce3-mdx23c-e2ec140f-v1';
const RATE = 44100;
const DEMUCS_SAMPLES = 343980;
/** MDX23C's training chunk: 1024 STFT frames. */
const KIT_SAMPLES = MDX_HOP * 1023;
const KIT_FRAMES = mdxFrames(KIT_SAMPLES);
/** Network source order kick, snare, toms, hi-hat, cymbals; toms are not kept. */
const KIT_OUTPUTS = [0, 1, 3, 4] as const;
const FILES = {
	htdemucs: {
		name: 'htdemucs.onnx',
		sha256: 'a6eabce31c0866a7ad7ac545dc7b12fbe4ccd0c86731e94e99fd5b583da504df'
	},
	kit: {
		name: 'drumsep-mdx23c.onnx',
		sha256: 'e2ec140f5487c79b0be512d705746e2ac017bf3ab06d899d561ca963d91755c2'
	}
} as const;

export interface SeparationProgress {
	stage: 'drums' | 'kit';
	/** 'metal' runs the CPU provider's own graph on the GPU with identical results. */
	provider: SeparationProvider | 'metal';
	completed: number;
	total: number;
}
export interface SeparatedDrums {
	sampleRate: 44100;
	drums: Float32Array;
	kick: Float32Array;
	snare: Float32Array;
	hat: Float32Array;
	/** Ride and crash. */
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

/** Two lanes need eight intra-op threads and memory for two sets of separator activations. */
function defaultLanes(): number {
	return availableParallelism() >= 8 && totalmem() >= 12 * 1024 ** 3 ? 2 : 1;
}

function metalAvailable(): boolean {
	return process.platform === 'darwin' && process.arch === 'arm64' && process.env.MV_DRUM_METAL !== '0'
		&& metalAddonPath() !== null;
}

export class DrumSeparator {
	private modelDir: string;
	private threads: number;
	private lanes: number;
	private graphCacheDir?: string;
	private provider: SeparationProvider;
	private cpuArena?: boolean;
	private metal: boolean;
	private pending: Promise<unknown> = Promise.resolve();
	private closed = false;
	private warmDrums: Promise<OnnxSession> | null = null;
	private constructor(
		modelDir: string, threads: number, lanes: number, graphCacheDir?: string,
		provider: SeparationProvider = 'cpu', cpuArena?: boolean, metal = false
	) {
		this.modelDir = modelDir;
		this.threads = threads;
		this.lanes = lanes;
		this.graphCacheDir = graphCacheDir;
		this.provider = provider;
		this.cpuArena = cpuArena;
		this.metal = metal;
	}

	/** Both optional exports must be installed; see bench/lab/SEPARATION.md. */
	static async create(
		modelDir = MODEL_DIR,
		options: {
			threads?: number; lanes?: number; graphCacheDir?: string; provider?: SeparationProvider;
			cpuArena?: boolean;
			/** Run CPU stages the Metal engine reproduces on the GPU; needs graphCacheDir. */
			metal?: boolean;
		} = {}
	): Promise<DrumSeparator | null> {
		const provider = options.provider ?? 'cpu';
		if (provider !== 'cpu' && provider !== 'dml') throw new Error(`Unsupported separator provider: ${provider}`);
		if (provider === 'dml' && process.platform !== 'win32') throw new Error('DirectML separation requires Windows.');
		if (Object.values(FILES).some(file => !existsSync(join(modelDir, file.name)))) return null;
		// Separator CPU output can change with the intra-op thread count, not with the lane count.
		const threads = options.threads ?? 4;
		if (!Number.isInteger(threads) || threads < 1 || threads > 16) {
			throw new Error('Separator threads must be an integer from 1 to 16.');
		}
		const lanes = options.lanes ?? defaultLanes();
		if (!Number.isInteger(lanes) || lanes < 1 || lanes > 4) {
			throw new Error('Separator lanes must be an integer from 1 to 4.');
		}
		const metal = provider === 'cpu' && options.graphCacheDir !== undefined && (options.metal ?? metalAvailable());
		const separator = new DrumSeparator(
			modelDir, threads, lanes, options.graphCacheDir, provider, options.cpuArena, metal
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

	/** The kit stage alone, on stereo drums a previous run separated. */
	runKit(
		left: Float32Array, right: Float32Array, progress?: (p: SeparationProgress) => void
	): Promise<Omit<SeparatedDrums, 'drums'>> {
		if (this.closed) return Promise.reject(new Error('Drum separator is closed.'));
		if (left.length !== right.length) {
			return Promise.reject(new Error('Drum separator channels must have equal lengths.'));
		}
		if (!allFinite(left) || !allFinite(right)) {
			return Promise.reject(new Error('Drum separator PCM must be finite.'));
		}
		const work = this.pending.then(async () => {
			const [kick, snare, hat, cymbal] = await this.stage([left, right], 'kit', openSession, progress);
			return {
				sampleRate: RATE, kick: mono(kick), snare: mono(snare), hat: mono(hat), cymbal: mono(cymbal)
			} as const;
		});
		this.pending = work.catch(() => undefined);
		return work;
	}

	private async separate(
		input: Stereo, progress?: (p: SeparationProgress) => void
	): Promise<SeparatedDrums> {
		const length = input[0].length;
		if (normalization(input).std <= 1e-8) {
			return {
				sampleRate: RATE, drums: new Float32Array(length), kick: new Float32Array(length),
				snare: new Float32Array(length), hat: new Float32Array(length), cymbal: new Float32Array(length)
			};
		}
		// DirectML compiles the kit model on its first run, so that runs while HTDemucs holds the device.
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
		// The kit's Metal plan is built on the CPU while HTDemucs holds the GPU.
		let warmMetalKit = this.provider === 'cpu' && this.metal
			? this.openMetal(join(this.modelDir, FILES.kit.name), FILES.kit.sha256, this.sessionOptions('kit', 'cpu'))
			: null;
		const takeMetalKit = () => {
			const session = warmMetalKit;
			warmMetalKit = null;
			return session;
		};
		try {
			const [drums] = await this.stage(input, 'drums', openDrums, progress);
			const [kick, snare, hat, cymbal] = await this.stage(drums, 'kit', openKit, progress, takeMetalKit);
			return {
				sampleRate: RATE, drums: mono(drums), kick: mono(kick), snare: mono(snare), hat: mono(hat),
				cymbal: mono(cymbal)
			};
		} finally {
			await warmKit?.then(session => session.release(), () => {});
			await takeMetalKit()?.then(session => session?.release(), () => {});
		}
	}

	/** DirectML outputs do not depend on earlier runs; an all-zero chunk only compiles kernels. */
	private async warmDirectMlKit(): Promise<OnnxSession> {
		const path = join(this.modelDir, FILES.kit.name);
		const session = await openSession(path, this.sessionOptions('kit', 'dml'));
		try {
			await session.run({
				spec: { data: new Float32Array(4 * MDX_BINS * KIT_FRAMES), dims: [1, 4, MDX_BINS, KIT_FRAMES] }
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
			// Both models hold gigabytes of activations per call; an arena would keep them between calls.
			enableCpuMemArena: this.cpuArena ?? false, intraOpNumThreads: this.threads,
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
		progress?: (p: SeparationProgress) => void, warmMetal?: () => Promise<OnnxSession | null> | null
	): Promise<Stereo[]> {
		try {
			return await this.stageWithProvider(input, stage, open, this.provider, progress, warmMetal);
		} catch (error) {
			if (this.provider === 'cpu' && this.metal) {
				console.warn(`Metal ${stage} separation failed; restarting stage on the CPU.`, error);
				this.metal = false;
				return this.stageWithProvider(input, stage, open, 'cpu', progress);
			}
			if (this.provider !== 'dml') throw error;
			console.warn(`DirectML ${stage} separation failed; restarting stage on CPU.`, error);
			return this.stageWithProvider(input, stage, open, 'cpu', progress);
		}
	}

	/** A Metal session on the CPU session's own optimized graph, or null to stay on the CPU. */
	private async openMetal(
		modelPath: string, modelSha256: string, sessionOptions: Record<string, unknown>
	): Promise<OnnxSession | null> {
		try {
			const graph = await cachedCpuGraph({
				modelPath, modelSha256, cacheDir: this.graphCacheDir, runtimeVersion: runtimeVersion(),
				sessionOptions, load: openSession
			});
			if (!graph) return null;
			return await openMetalSession(graph, { parallelism: mlasParallelism(this.threads), cpu: sessionOptions });
		} catch (error) {
			console.warn('Metal separation unavailable; staying on the CPU.', error);
			return null;
		}
	}

	private async stageWithProvider(
		input: Stereo, stage: 'drums' | 'kit', open: OpenSession, provider: SeparationProvider,
		progress?: (p: SeparationProgress) => void, warmMetal?: () => Promise<OnnxSession | null> | null
	): Promise<Stereo[]> {
		const length = input[0].length;
		const drums = stage === 'drums';
		const outputs: Stereo[] = Array.from({ length: drums ? 1 : KIT_OUTPUTS.length },
			() => [new Float32Array(length), new Float32Array(length)]);
		// HTDemucs normalizes its input; MDX23C was trained on unnormalized drum stems.
		const stats = normalization(input);
		const { mean, std } = drums ? stats : { mean: 0, std: stats.std > 1e-8 ? 1 : 0 };
		if (std <= 1e-8) return outputs;
		const segment = drums ? DEMUCS_SAMPLES : KIT_SAMPLES;
		const stride = Math.floor(segment * .75);
		const total = Math.ceil(length / stride);
		const weights = new Float32Array(length);
		const model = FILES[drums ? 'htdemucs' : 'kit'];
		const modelPath = join(this.modelDir, model.name);
		const sessionOptions = this.sessionOptions(stage, provider);
		const metal = provider === 'cpu' && this.metal
			? await (warmMetal?.() ?? this.openMetal(modelPath, model.sha256, sessionOptions)) : null;
		const reported = metal ? 'metal' : provider;
		progress?.({ stage, provider: reported, completed: 0, total });
		// DirectML and Metal serialize a session's runs; CPU lanes share the chunk queue.
		const lanes = metal || provider === 'dml' ? 1 : Math.min(this.lanes, total);
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
		// Chunk inputs are prepared while earlier chunks run; results commit strictly in order.
		const launch = (offset: number): Promise<Record<string, OnnxTensor>> => {
			const count = Math.min(segment, length - offset);
			// Fixed, validated chunk lengths bound recurrent state and activation memory.
			const trim = Math.floor((segment - count) / 2);
			const start = offset - trim;
			const mix = new Float32Array(2 * segment);
			for (let c = 0; c < 2; c++) {
				for (let i = Math.max(0, start); i < Math.min(length, start + segment); i++) {
					mix[c * segment + i - start] = (input[c][i] - mean) / std;
				}
			}
			const feeds: Record<string, OnnxTensor> = drums
				? {
						mix: { data: mix, dims: [1, 2, segment] },
						magnitude: { data: demucsSpec(mix, segment), dims: [1, 4, 2048, Math.ceil(segment / 1024)] }
					}
				: { spec: { data: mdxSpec(mix, segment), dims: [1, 4, MDX_BINS, KIT_FRAMES] } };
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
			const first = metal ?? await openLane();
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
				let wave: Float32Array;
				let frequency: Float32Array | null = null;
				const sources: readonly number[] = drums ? [0] : KIT_OUTPUTS;
				if (drums) {
					wave = predicted.time_output.data;
					frequency = demucsIspec(predicted.freq_output.data, segment, 1);
					if (wave.length !== 2 * segment) throw new Error('Unexpected drums separator output shape.');
				} else {
					if (predicted.sources.data.length !== 5 * 4 * MDX_BINS * KIT_FRAMES) {
						throw new Error('Unexpected kit separator output shape.');
					}
					wave = mdxIspec(predicted.sources.data, segment, 5);
				}
				for (let i = 0; i < count; i++) {
					const weight = Math.min(i + 1, segment - i) / (segment / 2);
					weights[offset + i] += weight;
					for (let s = 0; s < sources.length; s++) for (let c = 0; c < 2; c++) {
						const index = (sources[s] * 2 + c) * segment + trim + i;
						const value = frequency
							? Math.fround(wave[index] + frequency[index]) * std + mean
							: wave[index];
						if (!Number.isFinite(value)) throw new Error(`Non-finite ${stage} separator output.`);
						outputs[s][c][offset + i] += value * weight;
					}
				}
				progress?.({ stage, provider: reported, completed: ++completed, total });
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
