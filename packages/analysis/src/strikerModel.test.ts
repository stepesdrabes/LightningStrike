import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	analysisModelChoices, chosenAnalysisModel, readInstalledStriker2, strikerCurrent
} from './strikerModel.ts';

const dirs = vi.hoisted(() => ({ cache: '' }));
vi.mock('./paths.ts', () => ({ get CACHE_DIR() { return dirs.cache; }, get MODEL_DIR() { return dirs.cache; } }));

const FIXTURE = join(import.meta.dirname, 'testdata', 'striker2');

/** The fixture model installed under a model's own file names, its manifest edited. */
async function install(stem: string, edit: (manifest: Record<string, any>) => void = () => {}) {
	const manifest = JSON.parse(await readFile(join(FIXTURE, 'striker2.json'), 'utf8'));
	manifest.file = `${stem}.onnx`;
	edit(manifest);
	await copyFile(join(FIXTURE, 'striker2.onnx'), join(dirs.cache, `${stem}.onnx`));
	await writeFile(join(dirs.cache, `${stem}.json`), JSON.stringify(manifest));
}

const choose = (analysisModel: unknown) =>
	writeFile(join(dirs.cache, 'settings.json'), JSON.stringify({ outputFps: 60, analysisModel }));

beforeEach(async () => {
	dirs.cache = await mkdtemp(join(tmpdir(), 'lightningstrike-models-'));
});

afterEach(async () => {
	await rm(dirs.cache, { recursive: true, force: true });
});

describe('the analysis model', () => {
	it('is the one the settings choose, Striker 2.0 when they choose none it knows', async () => {
		expect(await chosenAnalysisModel()).toBe('striker2');
		await choose('striker2-small');
		expect(await chosenAnalysisModel()).toBe('striker2-small');
		await choose('striker3');
		expect(await chosenAnalysisModel()).toBe('striker2');
		await writeFile(join(dirs.cache, 'settings.json'), '{"analysisModel": ');
		expect(await chosenAnalysisModel()).toBe('striker2');
	});

	it('offers both models, saying which is installed and what the other lacks', async () => {
		await install('striker2', (m) => { m.name = 'Striker 2.0 (fixture)'; });
		const [full, small] = await analysisModelChoices();
		expect(full).toEqual({ id: 'striker2', label: 'Striker 2.0', name: 'Striker 2.0 (fixture)', problem: null });
		expect(small).toMatchObject({ id: 'striker2-small', label: 'Striker 2.0 Small', name: null });
		expect(small.problem).toBe(
			`Striker 2.0 Small is not installed: put striker2-small.onnx and striker2-small.json in ${dirs.cache}.`
		);
	});

	it('reads Small from its own manifest and graph, and names that manifest when it refuses one', async () => {
		await install('striker2-small', (m) => { m.name = 'Striker 2.0 Small (fixture)'; });
		const installed = await readInstalledStriker2('striker2-small');
		expect('model' in installed && installed.model.name).toBe('Striker 2.0 Small (fixture)');
		expect('missing' in (await readInstalledStriker2('striker2'))).toBe(true);
		const graph = await readFile(join(dirs.cache, 'striker2-small.onnx'));
		graph[graph.length >> 1] ^= 1;
		await writeFile(join(dirs.cache, 'striker2-small.onnx'), graph);
		const refused = await readInstalledStriker2('striker2-small');
		expect('error' in refused && refused.error.message).toBe('striker2-small.json: the graph does not match its SHA-256');
		// The library and the settings only need its name, which the size check vouches for.
		expect('model' in (await readInstalledStriker2('striker2-small', { verify: false }))).toBe(true);
	});

	it('keeps analyses of the chosen model current, and every model\'s while it cannot run', async () => {
		await install('striker2', (m) => { m.name = 'Striker 2.0 (fixture)'; });
		const installed = await readInstalledStriker2('striker2');
		expect(strikerCurrent('Striker 2.0 (fixture)', installed)).toBe(true);
		expect(strikerCurrent('Striker 2.0 Small (fixture)', installed)).toBe(false);
		expect(strikerCurrent(undefined, installed)).toBe(false);
		const absent = await readInstalledStriker2('striker2-small');
		expect(strikerCurrent('Striker 2.0 (fixture)', absent)).toBe(true);
		expect(strikerCurrent(undefined, absent)).toBe(false);
	});
});
