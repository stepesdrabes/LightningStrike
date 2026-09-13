import { parentPort, workerData } from 'node:worker_threads';
import { analysisPrelude, preludeMessage } from './prelude.ts';
import { sourceOnsets } from './separatedDrums.ts';
import type { DspTask } from './dsp.ts';

// Runs one analysis step off the ingest thread; callers compute it themselves if this fails.
const port = parentPort!;
const job = workerData as DspTask;
try {
	if (job.task === 'prelude') {
		const prelude = analysisPrelude(job.mono, job.left, job.right, job.sampleRate);
		const { message, transfer } = preludeMessage(prelude);
		port.postMessage({ value: message }, transfer);
	} else {
		const onsets = sourceOnsets(job.source, job.sampleRate);
		port.postMessage({ value: onsets }, [onsets.odf.buffer as ArrayBuffer]);
	}
} catch (error) {
	port.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
