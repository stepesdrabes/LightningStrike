import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
import { loadMetalAddon } from './metal/addon.ts';
import { readOnnx } from './metal/onnx.ts';
import { MetalPlan, type OrtRuntime } from './metal/plan.ts';

interface Tensor {
	data: Float32Array;
	dims: readonly number[];
}
interface Session {
	run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>>;
	release(): Promise<void>;
}
interface Ort {
	InferenceSession: { create(source: string | Uint8Array, options: unknown): Promise<Session> };
	Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
}
type Request = { type: 'run'; id: number; feeds: Record<string, Tensor> } | { type: 'release' };

// One plan per thread. path is ORT's optimized CPU graph; cpu holds the options of the CPU
// session it reproduces, which also runs any chunk the plan cannot prove exact.
const { path, options } = workerData as {
	path: string;
	options: { parallelism: number; cpu: Record<string, unknown> };
};
const port = parentPort!;
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

try {
	const addon = loadMetalAddon();
	if (!addon) throw new Error('No Metal device or binding.');
	const ort = createRequire(import.meta.url)('onnxruntime-node') as Ort;
	const plan = await MetalPlan.create(addon, readOnnx(path), {
		parallelism: options.parallelism, cpu: options.cpu, ort: ort as unknown as OrtRuntime
	});
	let fallback: Promise<Session> | null = null;
	port.on('message', async (request: Request) => {
		if (request.type === 'release') {
			await plan.release();
			await fallback?.then((s) => s.release(), () => {});
			port.postMessage({ type: 'released' });
			port.close();
			return;
		}
		try {
			const feeds = Object.fromEntries(Object.entries(request.feeds).map(([name, t]) => [name, t.data]));
			const result = await plan.run(feeds);
			let outputs: Record<string, Tensor>;
			if ('doubt' in result) {
				console.warn(`Metal separation chunk ran on the CPU: ${result.doubt}`);
				fallback ??= ort.InferenceSession.create(path, { ...options.cpu, graphOptimizationLevel: 'disabled' });
				const session = await fallback;
				const predicted = await session.run(Object.fromEntries(Object.entries(request.feeds)
					.map(([name, { data, dims }]) => [name, new ort.Tensor('float32', data, dims)])));
				outputs = Object.fromEntries(Object.entries(predicted)
					.map(([name, { data, dims }]) => [name, { data, dims: [...dims] }]));
			} else {
				outputs = Object.fromEntries(Object.entries(result.outputs)
					.map(([name, data]) => [name, { data, dims: plan.outputShape(name) }]));
			}
			port.postMessage({ type: 'result', id: request.id, outputs },
				[...new Set(Object.values(outputs).map(({ data }) => data.buffer as ArrayBuffer))]);
		} catch (error) {
			port.postMessage({ type: 'error', id: request.id, message: describe(error) });
		}
	});
	port.postMessage({ type: 'ready', inputNames: plan.inputNames });
} catch (error) {
	port.postMessage({ type: 'failed', message: describe(error) });
}
