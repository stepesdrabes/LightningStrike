import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { compileEvening, gateVerdicts, rememberGateVerdicts, type Finding } from '@mv/core';
import * as api from '@mv/core/evening';

/**
 * Load one evening file in isolation: its only imports are `lightningstrike` and its own
 * relative files, and the loader bounds how long and how much memory it may take.
 */
const { file, nonce, verdicts } = workerData as { file: string; nonce: string; verdicts?: [string, string[]][] };
rememberGateVerdicts(verdicts ?? []);

const SPECIFIER = 'lightningstrike';
const VIRTUAL = 'lightningstrike:api';
const KEY = Symbol.for('lightningstrike.api');

(globalThis as Record<symbol, unknown>)[KEY] = api;
const names = Object.keys(api).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
const surface = [
	`const api = globalThis[Symbol.for('lightningstrike.api')];`,
	...names.map((name) => `export const ${name} = api.${name};`)
].join('\n');

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === SPECIFIER) return { url: VIRTUAL, format: 'module', shortCircuit: true };
		if (!context.parentURL?.includes('?v=')) return nextResolve(specifier, context);
		if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
			throw new Error(`An evening can import only '${SPECIFIER}' and its own files, not '${specifier}'.`);
		}
		const resolved = nextResolve(specifier, context);
		const url = new URL(resolved.url);
		url.searchParams.set('v', nonce);
		return { ...resolved, url: url.href, shortCircuit: true };
	},
	load(url, context, nextLoad) {
		if (url === VIRTUAL) return { format: 'module', source: surface, shortCircuit: true };
		return nextLoad(url, context);
	}
});

/** The evening file's own line, from a stack frame or a syntax error's header. */
function lineIn(error: unknown): { file: string; line: number } | undefined {
	const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
	const header = /^(.+\.[cm]?[jt]s):(\d+)\r?\n/m.exec(text);
	if (header) return { file: header[1], line: Number(header[2]) };
	const frame = /(file:\/\/[^\s)]+?)\?v=[^:\s)]*:(\d+):\d+/.exec(text);
	if (!frame) return undefined;
	const url = decodeURIComponent(frame[1]);
	return { file: /^file:\/\/\/[A-Za-z]:\//.test(url) ? url.slice(8) : url.slice(7), line: Number(frame[2]) };
}

function failure(error: unknown): Finding {
	const line = lineIn(error);
	const raw = error instanceof Error ? error.message : String(error);
	// Syntax errors lead with the file and the offending source; the reason is the last line.
	const reason = raw.includes('\n') ? raw.trim().split('\n').pop()!.trim() : raw;
	return { severity: 'error', message: reason.replace(/\s*file:\/\/\S+/g, '').trim(), ...(line ? { line } : {}) };
}

try {
	const url = pathToFileURL(file);
	url.searchParams.set('v', nonce);
	const module = (await import(url.href)) as { default?: unknown };
	const { script, findings } = compileEvening(module.default, {
		resolvePath: (path) => resolve(dirname(file), path)
	});
	parentPort?.postMessage({ type: 'done', script, findings, verdicts: gateVerdicts() });
} catch (error) {
	parentPort?.postMessage({ type: 'done', script: null, findings: [failure(error)] });
}
