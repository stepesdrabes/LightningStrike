import { Worker } from 'node:worker_threads';
import { workerFile } from './paths.ts';
import { restorePrelude, type AnalysisPrelude } from './prelude.ts';
import type { SourceOnsets } from './separatedDrums.ts';

export type DspTask =
	| { task: 'prelude'; mono: Float32Array; left?: Float32Array; right?: Float32Array; sampleRate: number }
	| { task: 'onsets'; source: Float32Array; sampleRate: number };

function inWorker(job: DspTask): Promise<unknown> {
	const file = workerFile('dspWorker.ts', 'dsp-worker.mjs');
	if (!file) return Promise.reject(new Error('The DSP worker is not installed.'));
	return new Promise((resolve, reject) => {
		const worker = new Worker(file, { workerData: job, execArgv: [] });
		worker.once('message', (reply: { value?: unknown; error?: string }) => {
			if (reply.error === undefined) resolve(reply.value);
			else reject(new Error(reply.error));
			void worker.terminate();
		});
		worker.once('error', reject);
		worker.once('exit', (code) => reject(new Error(`DSP worker exited with code ${code}`)));
	});
}

/** Undefined when no worker could compute it; analysis then computes the step itself. */
export async function preludeBeside(
	mono: Float32Array, left: Float32Array, right: Float32Array, sampleRate: number
): Promise<AnalysisPrelude | undefined> {
	try {
		return restorePrelude(await inWorker({ task: 'prelude', mono, left, right, sampleRate }));
	} catch {
		return undefined;
	}
}

export async function onsetsBeside(
	source: Float32Array, sampleRate: number
): Promise<SourceOnsets | undefined> {
	try {
		return await inWorker({ task: 'onsets', source, sampleRate }) as SourceOnsets;
	} catch {
		return undefined;
	}
}
