import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

interface Tensor {
	data: Float32Array;
	dims: readonly number[];
}
interface Session {
	inputNames: readonly string[];
	inputMetadata?: readonly unknown[];
	run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>>;
	release(): Promise<void>;
}
interface Ort {
	InferenceSession: { create(path: string, options: unknown): Promise<Session> };
	Tensor: new (type: string, data: Float32Array, dims: readonly number[]) => unknown;
}
type Request = { type: 'run'; id: number; feeds: Record<string, Tensor> } | { type: 'release' };

// One ONNX session per thread: native runs block their thread, so the ingest thread stays free.
const { path, options } = workerData as { path: string; options: Record<string, unknown> };
const port = parentPort!;
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

try {
	const ort = createRequire(import.meta.url)('onnxruntime-node') as Ort;
	const session = await ort.InferenceSession.create(path, options);
	port.on('message', async (request: Request) => {
		if (request.type === 'release') {
			await session.release().catch(() => {});
			port.postMessage({ type: 'released' });
			port.close();
			return;
		}
		try {
			const feeds = Object.fromEntries(Object.entries(request.feeds)
				.map(([name, { data, dims }]) => [name, new ort.Tensor('float32', data, dims)]));
			const predicted = await session.run(feeds);
			const outputs = Object.fromEntries(Object.entries(predicted)
				.map(([name, { data, dims }]) => [name, { data, dims: [...dims] }]));
			port.postMessage({ type: 'result', id: request.id, outputs },
				[...new Set(Object.values(outputs).map(({ data }) => data.buffer as ArrayBuffer))]);
		} catch (error) {
			port.postMessage({ type: 'error', id: request.id, message: describe(error) });
		}
	});
	port.postMessage({ type: 'ready', inputNames: session.inputNames, inputMetadata: session.inputMetadata });
} catch (error) {
	port.postMessage({ type: 'failed', message: describe(error) });
}
