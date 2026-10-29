import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { MeasuredAudio } from '@mv/core';
import {
	ingest,
	prepareNarration,
	workspaceRoot,
	type IngestOptions,
	type IngestResult,
	type Striker2Glimpse
} from '@mv/analysis';

/**
 * Serialize all ingest callers and use one worker to keep DSP off the server thread. It stays
 * between songs, so Striker 2.0's session does too, and closes once idle a little longer than
 * that session. Dev uses source; bundles use MV_INGEST_WORKER; missing workers run in process.
 */
export const ingestWorker = { idleMs: 100_000 };

let inFlight: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
	const run = inFlight.then(work);
	// The chain must survive a rejection or every later ingest inherits the first failure.
	inFlight = run.catch(() => {});
	return run;
}

export function ingestDetached(source: string, opts: IngestOptions = {}): Promise<IngestResult> {
	return serialized(() => inWorker<IngestResult>('ingest', source, {
		// Only the serialisable options cross the boundary; progress comes back as messages.
		opts: {
			cachedTrackId: opts.cachedTrackId,
			force: opts.force,
			metricalLevel: opts.metricalLevel,
			artwork: opts.artwork
		},
		onProgress: opts.onProgress,
		onStriker: opts.onStriker,
		fallback: () => ingest(source, opts)
	}));
}

/** Measure a narration's audio in the same serialized worker, for the same reason. */
export function narrationDetached(path: string): Promise<MeasuredAudio> {
	return serialized(() => inWorker<MeasuredAudio>('narration', path, {
		opts: {},
		missing: () => prepareNarration(path)
	}));
}

type Reply =
	| { type: 'progress'; stage: string }
	| { type: 'striker'; glimpse: Striker2Glimpse }
	| { type: 'done'; result: unknown }
	| { type: 'error'; message?: string }
	| { type: 'closed' };

interface Thread {
	worker: Worker;
	job: { reply(m: Reply): void; lost(error: Error): void } | null;
}

let thread: Thread | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

function workerPath(): string | null {
	const bundled = process.env.MV_INGEST_WORKER;
	const path = bundled && existsSync(bundled)
		? bundled
		: join(workspaceRoot(), 'packages', 'analysis', 'src', 'ingestWorker.ts');
	return existsSync(path) ? path : null;
}

function spawn(path: string): Thread {
	// Do not inherit server inspector/eval flags that can break or collide in a worker.
	const t: Thread = { worker: new Worker(path, { execArgv: [] }), job: null };
	t.worker.on('message', (m: Reply) => t.job?.reply(m));
	const lost = (error: Error) => {
		if (thread === t) thread = null;
		const job = t.job;
		t.job = null;
		job?.lost(error);
		void t.worker.terminate();
	};
	t.worker.on('error', lost);
	t.worker.on('exit', (code) => lost(new Error(`ingest worker exited with code ${code}`)));
	return t;
}

/** Releases the Striker 2.0 session before the worker goes, so native memory is freed in order. */
async function close(): Promise<void> {
	const t = thread;
	if (!t) return;
	thread = null;
	await new Promise<void>((done) => {
		const late = setTimeout(done, 10_000);
		t.worker.on('message', (m: Reply) => {
			if (m.type !== 'closed') return;
			clearTimeout(late);
			done();
		});
		t.worker.once('exit', () => {
			clearTimeout(late);
			done();
		});
		t.worker.postMessage({ type: 'close' });
	});
	await t.worker.terminate();
}

function inWorker<T>(task: 'ingest' | 'narration', source: string, how: {
	opts: IngestOptions;
	onProgress?: (stage: string) => void;
	onStriker?: (glimpse: Striker2Glimpse) => void;
	/** Runs the job here when the worker fails before its first message. */
	fallback?: () => Promise<T>;
	missing?: () => Promise<T>;
}): Promise<T> {
	const path = workerPath();
	if (!path) return (how.fallback ?? how.missing)!();
	if (idle) clearTimeout(idle);
	idle = null;
	const t = (thread ??= spawn(path));
	t.worker.ref();
	return new Promise<T>((resolve, reject) => {
		let spoke = false;
		t.job = {
			reply(m) {
				spoke = true;
				if (m.type === 'progress') how.onProgress?.(m.stage);
				else if (m.type === 'striker') how.onStriker?.(m.glimpse);
				else if (m.type === 'done') resolve(m.result as T);
				else if (m.type === 'error') reject(new Error(m.message ?? `${task} failed`));
			},
			lost(error) {
				if (!spoke && how.fallback) resolve(how.fallback());
				else reject(error);
			}
		};
		t.worker.postMessage({ type: 'job', task, source, opts: how.opts });
	}).finally(() => {
		t.job = null;
		if (thread !== t) return;
		t.worker.unref();
		idle = setTimeout(() => {
			idle = null;
			void serialized(close);
		}, ingestWorker.idleMs);
		idle.unref();
	});
}
