import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { workspaceRoot } from '@mv/analysis';
import type { EveningScript, Finding } from '@mv/core';

/** Long enough for a large evening's effect gates, short enough that a hang is reported. */
const LOAD_TIMEOUT_MS = 60_000;
const LOAD_MEMORY_MB = 512;

export interface LoadResult {
	file: string;
	script: EveningScript | null;
	findings: Finding[];
	/** The file's modification time when it was read. */
	mtimeMs: number;
}

/** The bundled worker sits beside the ingest worker in the desktop app; a checkout runs source. */
function workerPath(): string | null {
	const bundled = process.env.MV_INGEST_WORKER;
	const candidates = [
		...(bundled ? [join(dirname(bundled), 'evening-worker.mjs')] : []),
		join(workspaceRoot(), 'apps', 'web', 'src', 'lib', 'server', 'evening', 'eveningWorker.ts')
	];
	return candidates.find((p) => existsSync(p)) ?? null;
}

let loads = 0;
/** Gate verdicts from earlier loads: saving a file again re-gates only the effects that changed. */
let verdicts: [string, string[]][] = [];

/** Load, validate and compile an evening file without letting it near the server's own thread. */
export async function loadEvening(file: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<LoadResult> {
	const fail = (message: string, mtimeMs = 0): LoadResult => ({
		file,
		script: null,
		findings: [{ severity: 'error', message }],
		mtimeMs
	});

	if (!['.ts', '.mts', '.js', '.mjs'].includes(extname(file).toLowerCase())) {
		return fail('An evening is a .ts file.');
	}
	let mtimeMs: number;
	try {
		mtimeMs = (await stat(file)).mtimeMs;
	} catch {
		return fail(`No evening file at ${file}.`);
	}
	const entry = workerPath();
	if (!entry) return fail('The evening loader is missing from this build.', mtimeMs);

	const nonce = `${Date.now().toString(36)}${(loads++).toString(36)}`;
	return new Promise<LoadResult>((resolve) => {
		let settled = false;
		const worker = new Worker(entry, {
			workerData: { file, nonce, verdicts },
			execArgv: [],
			resourceLimits: { maxOldGenerationSizeMb: LOAD_MEMORY_MB }
		});
		const finish = (result: LoadResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			void worker.terminate();
			resolve(result);
		};
		const timer = setTimeout(
			() => finish(fail(`The evening took longer than ${timeoutMs / 1000} s to load; look for an endless loop.`, mtimeMs)),
			timeoutMs
		);
		worker.on('message', (message: { type: string; script: EveningScript | null; findings: Finding[]; verdicts?: [string, string[]][] }) => {
			if (message.type !== 'done') return;
			if (message.verdicts) verdicts = message.verdicts;
			finish({ file, script: message.script, findings: message.findings, mtimeMs });
		});
		worker.on('error', (error: Error) => finish(fail(`The evening failed to load: ${error.message}`, mtimeMs)));
		worker.on('exit', (code) => {
			if (code !== 0) finish(fail(`The evening loader stopped (code ${code}); the file may use too much memory.`, mtimeMs));
		});
	});
}
