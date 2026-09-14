import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateFusionModel, type FusionModel } from './drumFusion.ts';
import { MODEL_DIR } from './paths.ts';

/** The installed drum fusion model, no file, or a file that cannot be used (unreadable or invalid). */
export type InstalledFusion = { model: FusionModel } | { missing: true } | { error: Error };

let parsed: { stamp: string; installed: InstalledFusion } | undefined;

/** Reads and validates `drum-fusion.json`, once per revision of the file. */
export async function readInstalledFusion(): Promise<InstalledFusion> {
	const path = join(MODEL_DIR, 'drum-fusion.json');
	const info = await stat(path).catch(() => null);
	if (!info) return { missing: true };
	const stamp = `${info.mtimeMs}:${info.size}`;
	if (parsed?.stamp !== stamp) {
		const installed = await readFile(path, 'utf8')
			.then((text): InstalledFusion => ({ model: validateFusionModel(JSON.parse(text) as FusionModel) }))
			.catch((e: unknown): InstalledFusion => ({ error: e instanceof Error ? e : new Error(String(e)) }));
		parsed = { stamp, installed };
	}
	return parsed.installed;
}

/**
 * Whether drums a fusion model classified still match the installed one. A retrained or removed
 * model re-classifies them; a file that cannot be used keeps them rather than falling back to rules.
 */
export function fusionCurrent(drumFusion: string, installed: InstalledFusion): boolean {
	return 'error' in installed || ('model' in installed && installed.model.version === drumFusion);
}
