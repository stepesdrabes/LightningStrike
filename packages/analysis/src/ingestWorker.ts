import { parentPort, workerData } from 'node:worker_threads';
import { ingest, type IngestOptions } from './ingest.ts';

/**
 * Run the entire ingest in a worker so synchronous DSP cannot block requests or hardware
 * rendering. Dev loads source; desktop selects the bundled copy via MV_INGEST_WORKER.
 */
const { source, opts } = workerData as { source: string; opts: IngestOptions };

try {
	const result = await ingest(source, {
		...opts,
		onProgress: (stage) => parentPort?.postMessage({ type: 'progress', stage })
	});
	parentPort?.postMessage({ type: 'done', result });
} catch (e) {
	parentPort?.postMessage({
		type: 'error',
		message: e instanceof Error ? e.message : String(e)
	});
}
