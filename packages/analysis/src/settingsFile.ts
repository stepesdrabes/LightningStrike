import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR } from './paths.ts';

/** One key of the cache's settings.json, which the app writes; undefined when absent or unreadable. */
export async function readSetting(name: string): Promise<unknown> {
	try {
		return (JSON.parse(await readFile(join(CACHE_DIR, 'settings.json'), 'utf8')) as Record<string, unknown>)[name];
	} catch {
		return undefined;
	}
}
