import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ANALYSIS_VERSION, SHOW_VERSION } from '@mv/core';
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

/** The tiny Striker 2.0 export from striker-2's tools/m7_fixtures.py, its manifest edited. */
async function installStriker2(edit: (manifest: Record<string, any>) => void = () => {}) {
	const fixture = join(import.meta.dirname, 'testdata', 'striker2');
	const manifest = JSON.parse(await readFile(join(fixture, 'striker2.json'), 'utf8'));
	edit(manifest);
	await copyFile(join(fixture, 'striker2.onnx'), join(dirs.models, 'striker2.onnx'));
	await writeFile(join(dirs.models, 'striker2.json'), JSON.stringify(manifest));
	return manifest.name as string;
}

async function saveSong(id: string, striker?: string) {
	const analysis = { version: ANALYSIS_VERSION, ...(striker ? { striker } : {}), duration: 100 };
	await Promise.all([
		writeFile(join(dirs.cache, `${id}.meta.json`), JSON.stringify({ id, source: id, title: id })),
		writeFile(join(dirs.cache, `${id}.analysis.json`), JSON.stringify(analysis, null, '\t')),
		writeFile(join(dirs.cache, `${id}.show.json`), JSON.stringify({ authoredBy: 'engine', version: SHOW_VERSION }))
	]);
}

const currentById = async () => Object.fromEntries((await readLibrary()).map((entry) => [entry.id, entry.current]));

describe('library', () => {
	it('marks songs only the installed Striker 2.0 made as current, and keeps them while none is usable', async () => {
		const name = await installStriker2();
		await Promise.all([saveSong('made', name), saveSong('other', 'Striker 2.0 (00000000)'), saveSong('unmarked')]);
		expect(await currentById()).toEqual({ made: true, other: false, unmarked: false });
		await installStriker2((manifest) => { manifest.name = 'Striker 2.0 (00000000)'; });
		expect(await currentById()).toEqual({ made: false, other: true, unmarked: false });
		await writeFile(join(dirs.models, 'striker2.json'), '{"format": "striker2-model"');
		expect(await currentById()).toEqual({ made: true, other: true, unmarked: false });
		await rm(join(dirs.models, 'striker2.json'));
		expect(await currentById()).toEqual({ made: true, other: true, unmarked: false });
	});
});
