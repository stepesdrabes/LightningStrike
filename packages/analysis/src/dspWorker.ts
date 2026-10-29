import { parentPort, workerData } from 'node:worker_threads';
import { analysisPrelude, preludeMessage } from './prelude.ts';
import type { DspTask } from './dsp.ts';

// Runs one analysis step off the ingest thread; callers compute it themselves if this fails.
const port = parentPort!;
const job = workerData as DspTask;
try {
	const prelude = analysisPrelude(job.mono, job.left, job.right, job.sampleRate);
	const { message, transfer } = preludeMessage(prelude);
	port.postMessage({ value: message }, transfer);
} catch (error) {
	port.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
