import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ingest, workspaceRoot, type IngestOptions, type IngestResult } from '@mv/analysis';

/**
 * Serialize all ingest callers and use a worker to keep DSP off the server thread. Dev uses
 * source; bundles use MV_INGEST_WORKER; missing workers retain in-process fallback.
 */
let inFlight: Promise<unknown> = Promise.resolve();

export function ingestDetached(source: string, opts: IngestOptions = {}): Promise<IngestResult> {
	const run = inFlight.then(() => ingestInWorker(source, opts));
	// The chain must survive a rejection or every later ingest inherits the first failure.
	inFlight = run.catch(() => {});
	return run;
}

function ingestInWorker(source: string, opts: IngestOptions): Promise<IngestResult> {
	const bundled = process.env.MV_INGEST_WORKER;
	const workerPath =
		bundled && existsSync(bundled)
			? bundled
			: join(workspaceRoot(), 'packages', 'analysis', 'src', 'ingestWorker.ts');
	if (!existsSync(workerPath)) return ingest(source, opts);

	return new Promise((resolve, reject) => {
		const worker = new Worker(workerPath, {
			workerData: {
				source,
				// Only the serialisable options cross the boundary; progress comes back as messages.
				opts: { force: opts.force, metricalLevel: opts.metricalLevel, artwork: opts.artwork }
			},
			// Do not inherit server inspector/eval flags that can break or collide in a worker.
			execArgv: []
		});
		let sawMessage = false;
		let settled = false;
		const finish = (act: () => void) => {
			if (settled) return;
			settled = true;
			act();
			void worker.terminate();
		};
		worker.on('message', (m: { type: string; stage?: string; result?: IngestResult; message?: string }) => {
			sawMessage = true;
			if (m.type === 'progress' && m.stage) opts.onProgress?.(m.stage);
			else if (m.type === 'done' && m.result) finish(() => resolve(m.result as IngestResult));
			else if (m.type === 'error') finish(() => reject(new Error(m.message ?? 'ingest failed')));
		});
		// Fall back once if the worker fails before its first message. Later crashes are pipeline
		// failures.
		worker.on('error', (e) => {
			if (!sawMessage) finish(() => resolve(ingest(source, opts)));
			else finish(() => reject(e));
		});
		worker.on('exit', (code) => {
			if (settled) return;
			if (!sawMessage) finish(() => resolve(ingest(source, opts)));
			else finish(() => reject(new Error(`ingest worker exited with code ${code}`)));
		});
	});
}
