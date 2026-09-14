import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ANALYSIS_VERSION, SHOW_VERSION } from '@mv/core';
import { CANDIDATE_REVISION, FUSION_FEATURES, FUSION_KINDS } from './drumFusion.ts';
import { readLibrary } from './library.ts';

const dirs = vi.hoisted(() => ({ cache: '', models: '' }));
vi.mock('./paths.ts', () => ({ get CACHE_DIR() { return dirs.cache; }, get MODEL_DIR() { return dirs.models; } }));

beforeEach(async () => {
	dirs.cache = await mkdtemp(join(tmpdir(), 'lightningstrike-library-'));
	dirs.models = join(dirs.cache, 'models');
	await mkdir(dirs.models);
});

afterEach(async () => {
	await rm(dirs.cache, { recursive: true, force: true });
});

const modelPath = () => join(dirs.models, 'drum-fusion.json');

async function installModel(version: string) {
	const tree = { feature: [], threshold: [], left: [], right: [], leaf: [0] };
	const classes = Object.fromEntries(FUSION_KINDS.map((kind) => [kind, { threshold: 0.5, trees: [tree] }]));
	const model = { version, candidates: CANDIDATE_REVISION, features: FUSION_FEATURES, classes };
	await writeFile(modelPath(), JSON.stringify(model));
}

async function saveSong(id: string, drumFusion?: string) {
	const analysis = { version: ANALYSIS_VERSION, ...(drumFusion ? { drumFusion } : {}), duration: 100 };
	await Promise.all([
		writeFile(join(dirs.cache, `${id}.meta.json`), JSON.stringify({ id, source: id, title: id })),
		writeFile(join(dirs.cache, `${id}.analysis.json`), JSON.stringify(analysis, null, '\t')),
		writeFile(join(dirs.cache, `${id}.show.json`), JSON.stringify({ authoredBy: 'engine', version: SHOW_VERSION }))
	]);
}

const currentById = async () => Object.fromEntries((await readLibrary()).map((entry) => [entry.id, entry.current]));

describe('library', () => {
	it('marks songs classified by another drum fusion model as not current', async () => {
		await installModel('fusion-b');
		await Promise.all([saveSong('retrained', 'fusion-a'), saveSong('installed', 'fusion-b'), saveSong('rules')]);
		expect(await currentById()).toEqual({ retrained: false, installed: true, rules: true });
		await unlink(modelPath());
		expect(await currentById()).toEqual({ retrained: false, installed: false, rules: true });
	});

	it('keeps fused songs current while the installed model file cannot be used', async () => {
		await writeFile(modelPath(), JSON.stringify({ version: 'fusion-b', candidates: CANDIDATE_REVISION - 1 }));
		await saveSong('retrained', 'fusion-a');
		expect(await currentById()).toEqual({ retrained: true });
	});
});
