import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateStrikerModel, type StrikerModel } from './striker.ts';
import { MODEL_DIR } from './paths.ts';

/** The installed Striker model, no file, or a file that cannot be used (unreadable or invalid). */
export type InstalledStriker = { model: StrikerModel } | { missing: true } | { error: Error };

let parsed: { stamp: string; installed: InstalledStriker } | undefined;

/** Reads and validates `striker.json`, once per revision of the file. */
export async function readInstalledStriker(): Promise<InstalledStriker> {
	const path = join(MODEL_DIR, 'striker.json');
	const info = await stat(path).catch(() => null);
	if (!info) return { missing: true };
	const stamp = `${info.mtimeMs}:${info.size}`;
	if (parsed?.stamp !== stamp) {
		const installed = await readFile(path, 'utf8')
			.then((text): InstalledStriker => ({ model: validateStrikerModel(JSON.parse(text) as StrikerModel) }))
			.catch((e: unknown): InstalledStriker => ({ error: e instanceof Error ? e : new Error(String(e)) }));
		parsed = { stamp, installed };
	}
	return parsed.installed;
}

/**
 * Whether drums a Striker model classified still match the installed one. A retrained or removed
 * model re-classifies them; a file that cannot be used keeps them rather than falling back to rules.
 */
export function strikerCurrent(striker: string, installed: InstalledStriker): boolean {
	return 'error' in installed || ('model' in installed && installed.model.version === striker);
}
