import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { workerFile } from './paths.ts';

export interface OnnxTensor {
	data: Float32Array;
	dims: readonly number[];
}
export interface OnnxSession {
	readonly inputNames: readonly string[];
	readonly inputMetadata?: readonly { name: string; shape?: readonly (number | string)[] }[];
	/** `transfer` detaches the input buffers from the caller instead of copying them. */
	run(
		feeds: Record<string, OnnxTensor>, options?: { transfer?: boolean }
	): Promise<Record<string, OnnxTensor>>;
	release(): Promise<void>;
	/** False when the session runs on the calling thread, where concurrent runs cannot overlap. */
	readonly detached: boolean;
}
export type OpenSession = (path: string, options: Record<string, unknown>) => Promise<OnnxSession>;

/**
 * Preparation overlaps sessions, so idle intra-op threads block instead of spinning on cores
 * another session needs. Output is unchanged.
 */
export const QUIET_THREADS = { extra: { session: { intra_op: { allow_spinning: '0' } } } };

interface NativeSession {
	inputNames: readonly string[];
	inputMetadata?: OnnxSession['inputMetadata'];
	run(feeds: Record<string, unknown>): Promise<Record<string, OnnxTensor>>;
	release(): Promise<void>;
}
interface Ort {
	InferenceSession: { create(path: string, options: unknown): Promise<NativeSession> };
	Tensor: new (type: string, data: Float32Array, dims: readonly number[]) => unknown;
}

const buffers = (tensors: Record<string, OnnxTensor>) =>
	[...new Set(Object.values(tensors).map(({ data }) => data.buffer as ArrayBuffer))];

async function openInThread(path: string, options: Record<string, unknown>): Promise<OnnxSession> {
	// createRequire keeps bundlers from replacing the native addon with a throwing stub.
	const ort = createRequire(import.meta.url)('onnxruntime-node') as Ort;
	const session = await ort.InferenceSession.create(path, options);
	return {
		inputNames: session.inputNames, inputMetadata: session.inputMetadata, detached: false,
		async run(feeds) {
			const predicted = await session.run(Object.fromEntries(Object.entries(feeds)
				.map(([name, { data, dims }]) => [name, new ort.Tensor('float32', data, dims)])));
			return Object.fromEntries(Object.entries(predicted)
				.map(([name, { data, dims }]) => [name, { data, dims }]));
		},
		release: () => session.release()
	};
}

type Reply =
	| { type: 'ready'; inputNames: string[]; inputMetadata?: OnnxSession['inputMetadata'] }
	| { type: 'failed'; message: string }
	| { type: 'result'; id: number; outputs: Record<string, OnnxTensor> }
	| { type: 'error'; id: number; message: string }
	| { type: 'released' };

interface PendingRun {
	resolve: (outputs: Record<string, OnnxTensor>) => void;
	reject: (error: Error) => void;
}

/** Native errors reject the open; a worker that cannot start at all falls back to this thread. */
function openInWorker(
	file: string, path: string, options: Record<string, unknown>
): Promise<OnnxSession> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(file, { workerData: { path, options }, execArgv: [] });
		const pending = new Map<number, PendingRun>();
		let ready = false;
		let released: (() => void) | null = null;
		let failure: Error | null = null;
		let nextId = 0;
		const fail = (error: Error) => {
			failure ??= error;
			for (const request of pending.values()) request.reject(failure);
			pending.clear();
			released?.();
		};
		worker.on('message', (reply: Reply) => {
			if (reply.type === 'ready') {
				ready = true;
				resolve({
					inputNames: reply.inputNames, inputMetadata: reply.inputMetadata, detached: true,
					run(feeds, { transfer = false } = {}) {
						if (failure) return Promise.reject(failure);
						const id = nextId++;
						return new Promise((accept, refuse) => {
							pending.set(id, { resolve: accept, reject: refuse });
							worker.postMessage({ type: 'run', id, feeds }, transfer ? buffers(feeds) : []);
						});
					},
					release() {
						if (failure) return worker.terminate().then(() => {});
						return new Promise<void>((done) => {
							released = done;
							worker.postMessage({ type: 'release' });
						}).then(() => worker.terminate()).then(() => {});
					}
				});
			} else if (reply.type === 'failed') {
				reject(new Error(reply.message));
				void worker.terminate();
			} else if (reply.type === 'released') {
				released?.();
			} else {
				const request = pending.get(reply.id);
				pending.delete(reply.id);
				if (reply.type === 'result') request?.resolve(reply.outputs);
				else request?.reject(new Error(reply.message));
			}
		});
		worker.on('error', (error: Error) => {
			if (!ready) openInThread(path, options).then(resolve, reject);
			fail(error);
		});
		worker.on('exit', (code) => {
			if (!ready && !failure) reject(new Error(`ONNX worker exited with code ${code}`));
			fail(new Error(`ONNX worker exited with code ${code}`));
		});
	});
}

/** Run the session on its own thread when the worker entry is available. */
export const openSession: OpenSession = (path, options) => {
	const file = workerFile('onnxWorker.ts', 'onnx-worker.mjs');
	return file ? openInWorker(file, path, options) : openInThread(path, options);
};
