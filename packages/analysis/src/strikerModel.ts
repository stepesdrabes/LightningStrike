import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readStriker2, type Striker2Model } from './striker2.ts';
import {
	DEFAULT_ANALYSIS_PROVIDER, isAnalysisProvider, type AnalysisProvider
} from './striker2Provider.ts';
import { MODEL_DIR } from './paths.ts';
import { readSetting } from './settingsFile.ts';
import { readStriker2Graph, type Striker2Graph } from './striker2Graph.ts';
import { STRIKER2_FRONT_END } from './striker2Frontend.ts';

/** The analysis models the settings offer, each a manifest in MODEL_DIR beside its graph. */
export const ANALYSIS_MODELS = [
	{ id: 'striker2', label: 'Striker 2.0', manifest: 'striker2.json', graph: 'striker2.onnx' },
	{ id: 'striker2-small', label: 'Striker 2.0 Small', manifest: 'striker2-small.json', graph: 'striker2-small.onnx' }
] as const;
export type AnalysisModelId = (typeof ANALYSIS_MODELS)[number]['id'];
export const DEFAULT_ANALYSIS_MODEL: AnalysisModelId = 'striker2';

export function isAnalysisModel(value: unknown): value is AnalysisModelId {
	return ANALYSIS_MODELS.some((m) => m.id === value);
}

const described = (id: AnalysisModelId) => ANALYSIS_MODELS.find((m) => m.id === id)!;

/** The model the settings choose (`analysisModel` in the cache's settings.json), or the default. */
export async function chosenAnalysisModel(): Promise<AnalysisModelId> {
	const analysisModel = await readSetting('analysisModel');
	return isAnalysisModel(analysisModel) ? analysisModel : DEFAULT_ANALYSIS_MODEL;
}

/** Where the settings run it (`analysisProvider`), or the default. */
export async function chosenAnalysisProvider(): Promise<AnalysisProvider> {
	const analysisProvider = await readSetting('analysisProvider');
	return isAnalysisProvider(analysisProvider) ? analysisProvider : DEFAULT_ANALYSIS_PROVIDER;
}

/** An installed model, no manifest, or one that cannot be used (malformed or unverified). */
export type InstalledStriker2 = { model: Striker2Model } | { missing: true } | { error: Error };

const failure = (e: unknown) => ({ error: e instanceof Error ? e : new Error(String(e)) });

const parsed = new Map<string, { stamp: string; installed: InstalledStriker2 }>();

/**
 * Reads and checks a model's manifest and its graph, once per revision of either file. A
 * preparation verifies the graph's SHA-256 too; `verify: false` checks its size only, which is
 * enough to name the model in the library and the settings.
 */
export async function readInstalledStriker2(
	id: AnalysisModelId = DEFAULT_ANALYSIS_MODEL, { verify = true } = {}
): Promise<InstalledStriker2> {
	const { manifest, graph: defaultGraph } = described(id);
	const text = await readFile(join(MODEL_DIR, manifest), 'utf8').catch(() => null);
	if (text === null) return { missing: true };
	let file: string = defaultGraph;
	try {
		const named = (JSON.parse(text) as { file?: unknown }).file;
		if (typeof named === 'string' && /^[\w.-]+\.onnx$/.test(named)) file = named;
	} catch {
		// readStriker2 reports the malformed manifest.
	}
	const graph = await stat(join(MODEL_DIR, file)).catch(() => null);
	const stamp = `${MODEL_DIR}\n${text}\n${graph?.mtimeMs}:${graph?.size}`;
	const key = `${id}:${verify}`;
	if (parsed.get(key)?.stamp !== stamp) {
		const installed = await readStriker2(MODEL_DIR, manifest, { verify })
			.then((model): InstalledStriker2 => ({ model }), failure);
		parsed.set(key, { stamp, installed });
	}
	return parsed.get(key)!.installed;
}

/** What a preparation, or the settings, report when a model cannot run. */
export function striker2Problem(
	id: AnalysisModelId, installed: Exclude<InstalledStriker2, { model: Striker2Model }>
): string {
	const { label, manifest, graph } = described(id);
	return 'missing' in installed
		? `${label} is not installed: put ${graph} and ${manifest} in ${MODEL_DIR}.`
		: `${label} cannot be used: ${installed.error.message}`;
}

/** Each model the settings offer, with the name of what is installed or why it cannot run. */
export interface AnalysisModelChoice {
	id: AnalysisModelId;
	label: string;
	/** The installed manifest's name, null when the model cannot run. */
	name: string | null;
	problem: string | null;
}

export async function analysisModelChoices(): Promise<AnalysisModelChoice[]> {
	return Promise.all(ANALYSIS_MODELS.map(async ({ id, label }) => {
		const installed = await readInstalledStriker2(id, { verify: false });
		return 'model' in installed
			? { id, label, name: installed.model.name, problem: null }
			: { id, label, name: null, problem: striker2Problem(id, installed) };
	}));
}

export interface Striker2Structure extends Striker2Graph {
	name: string;
	/** Frames a graph run takes, at `fps`. */
	chunk: number;
	fps: number;
}

const structures = new Map<string, Promise<Striker2Structure>>();

/** A model's stages and streams, read once per graph. */
export function striker2Structure(model: Striker2Model): Promise<Striker2Structure> {
	const { name, graph, sha256, chunk } = model;
	const { fps, bins } = STRIKER2_FRONT_END;
	const key = `${graph}\n${sha256}`;
	if (!structures.has(key)) {
		const read = readStriker2Graph(graph, { chunk, fps, bins }).then((g) => ({ ...g, name, chunk, fps }));
		read.catch(() => structures.delete(key));
		structures.set(key, read);
	}
	return structures.get(key)!;
}

/** The chosen model's structure for the model view; null when none runs. */
export async function chosenStriker2Graph(): Promise<Striker2Structure | null> {
	const installed = await readInstalledStriker2(await chosenAnalysisModel(), { verify: false });
	return 'model' in installed ? striker2Structure(installed.model) : null;
}

/**
 * Whether an analysis is still the chosen model's: its `striker` names it. While the chosen model
 * cannot run, analyses some Striker 2.0 made are kept: nothing could replace them.
 */
export function strikerCurrent(striker: string | null | undefined, installed: InstalledStriker2): boolean {
	return 'model' in installed ? striker === installed.model.name : typeof striker === 'string';
}
