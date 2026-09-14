import { parentPort, workerData } from 'node:worker_threads';
import { ingest, type IngestOptions } from './ingest.ts';
import { prepareNarration } from './narration.ts';

/**
 * Run the entire ingest in a worker so synchronous DSP cannot block requests or hardware
 * rendering. Dev loads source; desktop selects the bundled copy via MV_INGEST_WORKER.
 */
const { source, opts, task } = workerData as {
	source: string;
	opts: IngestOptions;
	task?: 'ingest' | 'narration';
};

try {
	const result =
		task === 'narration'
			? await prepareNarration(source)
			: await ingest(source, {
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
