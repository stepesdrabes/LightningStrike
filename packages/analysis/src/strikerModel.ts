import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { STRIKER2_MANIFEST, readStriker2, type Striker2Model } from './striker2.ts';
import { MODEL_DIR } from './paths.ts';

/** The installed Striker 2.0, no manifest, or one that cannot be used (malformed or unverified). */
export type InstalledStriker2 = { model: Striker2Model } | { missing: true } | { error: Error };

const failure = (e: unknown) => ({ error: e instanceof Error ? e : new Error(String(e)) });

let parsed: { stamp: string; installed: InstalledStriker2 } | undefined;

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
	if (parsed?.stamp !== stamp) {
		const installed = await readStriker2(MODEL_DIR)
			.then((model): InstalledStriker2 => ({ model }), failure);
		parsed = { stamp, installed };
	}
	return parsed.installed;
}

/** What a preparation reports when the model it needs cannot run. */
export function striker2Problem(installed: Exclude<InstalledStriker2, { model: Striker2Model }>): string {
	return 'missing' in installed
		? `Striker 2.0 is not installed: put striker2.onnx and ${STRIKER2_MANIFEST} in ${MODEL_DIR}.`
		: `Striker 2.0 cannot be used: ${installed.error.message}`;
}

/**
 * Whether an analysis is still the installed model's: its `striker` names it. While no usable
 * model is installed, analyses some Striker 2.0 made are kept: nothing could replace them.
 */
export function strikerCurrent(striker: string | null | undefined, installed: InstalledStriker2): boolean {
	return 'model' in installed ? striker === installed.model.name : typeof striker === 'string';
}
