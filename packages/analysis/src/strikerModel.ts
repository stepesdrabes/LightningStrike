import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateStrikerModel, type StrikerModel } from './striker.ts';
import { STRIKER2_MANIFEST, readStriker2, type Striker2Model } from './striker2.ts';
import { MODEL_DIR } from './paths.ts';

/** The installed Striker model, no file, or a file that cannot be used (unreadable or invalid). */
export type InstalledStriker = { model: StrikerModel } | { missing: true } | { error: Error };

/** The installed Striker 2.0, no manifest, or one that cannot be used (malformed or unverified). */
export type InstalledStriker2 = { model: Striker2Model } | { missing: true } | { error: Error };

const failure = (e: unknown) => ({ error: e instanceof Error ? e : new Error(String(e)) });

let parsed: { stamp: string; installed: InstalledStriker } | undefined;
let parsed2: { stamp: string; installed: InstalledStriker2 } | undefined;

/** Reads and validates `striker.json`, once per revision of the file. */
export async function readInstalledStriker(): Promise<InstalledStriker> {
	const path = join(MODEL_DIR, 'striker.json');
	const info = await stat(path).catch(() => null);
	if (!info) return { missing: true };
	const stamp = `${info.mtimeMs}:${info.size}`;
	if (parsed?.stamp !== stamp) {
		const installed = await readFile(path, 'utf8')
			.then((text): InstalledStriker => ({ model: validateStrikerModel(JSON.parse(text) as StrikerModel) }))
			.catch(failure);
		parsed = { stamp, installed };
	}
	return parsed.installed;
}

/** Reads and verifies `striker2.json` and its graph, once per revision of either file. */
export async function readInstalledStriker2(): Promise<InstalledStriker2> {
	const text = await readFile(join(MODEL_DIR, STRIKER2_MANIFEST), 'utf8').catch(() => null);
	if (text === null) return { missing: true };
	let file = 'striker2.onnx';
	try {
		const named = (JSON.parse(text) as { file?: unknown }).file;
		if (typeof named === 'string' && /^[\w.-]+\.onnx$/.test(named)) file = named;
	} catch {
		// readStriker2 reports the malformed manifest.
	}
	const graph = await stat(join(MODEL_DIR, file)).catch(() => null);
	const stamp = `${MODEL_DIR}\n${text}\n${graph?.mtimeMs}:${graph?.size}`;
	if (parsed2?.stamp !== stamp) {
		const installed = await readStriker2(MODEL_DIR)
			.then((model): InstalledStriker2 => ({ model }), failure);
		parsed2 = { stamp, installed };
	}
	return parsed2.installed;
}

/**
 * Whether drums a Striker model classified still match the installed one. Striker 2.0 takes
 * precedence: with its manifest installed only its own identity is current. A model file that
 * cannot be used keeps analyses rather than re-analysing them on an older path.
 */
export function strikerCurrent(
	striker: string, installed: InstalledStriker, installed2: InstalledStriker2
): boolean {
	if ('error' in installed2) return true;
	if ('model' in installed2) return installed2.model.identity === striker;
	return 'error' in installed || ('model' in installed && installed.model.version === striker);
}
