import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Find the workspaces package.json from this module; cwd differs between dev and production. */
export function workspaceRoot(): string {
	let dir = import.meta.dirname;
	for (let i = 0; i < 8; i++) {
		try {
			const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
				workspaces?: unknown;
			};
			if (pkg.workspaces) return dir;
		} catch {
			// Keep walking.
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return process.cwd();
}

/** A worker entry beside this module: TypeScript in a checkout, the named bundle in the desktop app. */
export function workerFile(source: string, bundle: string): string | null {
	return [join(import.meta.dirname, source), join(import.meta.dirname, bundle)].find(existsSync) ?? null;
}

/** Decoded audio and analysis blobs. */
export const CACHE_DIR = process.env.MV_CACHE_DIR
	? resolve(process.env.MV_CACHE_DIR)
	: join(workspaceRoot(), 'cache');

/** Model weights. Big, fetched once, and no more part of the repo than the audio is. */
export const MODEL_DIR = process.env.MV_MODEL_DIR
	? resolve(process.env.MV_MODEL_DIR)
	: join(workspaceRoot(), 'models');
