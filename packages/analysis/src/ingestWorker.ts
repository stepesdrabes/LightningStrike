import { parentPort } from 'node:worker_threads';
import { ingest, type IngestOptions } from './ingest.ts';
import { prepareNarration } from './narration.ts';
import { releaseStriker2 } from './striker2Pool.ts';

/**
 * Run ingests one message at a time in a worker so synchronous DSP cannot block requests or
 * hardware rendering. The worker outlives a song, so Striker 2.0's session serves the next one.
 * Dev loads source; desktop selects the bundled copy via MV_INGEST_WORKER.
 */
type Request =
	| { type: 'job'; task: 'ingest' | 'narration'; source: string; opts: IngestOptions }
	| { type: 'close' };

const port = parentPort!;
port.on('message', async (request: Request) => {
	if (request.type === 'close') {
		await releaseStriker2();
		port.postMessage({ type: 'closed' });
		return;
	}
	try {
		const result = request.task === 'narration'
			? await prepareNarration(request.source)
			: await ingest(request.source, {
					...request.opts,
					onProgress: (stage) => port.postMessage({ type: 'progress', stage })
				});
		port.postMessage({ type: 'done', result });
	} catch (e) {
		port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
	}
});
