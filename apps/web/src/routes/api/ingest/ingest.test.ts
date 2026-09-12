import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHOW_VERSION, type Show, type TrackAnalysis } from '@mv/core';
import { composeShow, lintShow } from '@mv/author-engine';
import { fixture } from '../../../../../../packages/author-engine/src/fixture.ts';
import { POST } from './+server.ts';

const mocks = vi.hoisted(() => ({ ingest: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile }));
vi.mock('@mv/analysis', () => ({ showPath: (id: string) => `/cache/${id}.show.json` }));
vi.mock('../../../lib/server/ingestDetached.ts', () => ({ ingestDetached: mocks.ingest }));
vi.mock('@mv/author-engine', async (original) => {
	const actual = await original<typeof import('@mv/author-engine')>();
	return { ...actual, lintShow: vi.fn(actual.lintShow) };
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.readFile.mockReset();
	mocks.writeFile.mockReset().mockResolvedValue(undefined);
	mocks.ingest.mockReset();
});

async function ingest(analysis: TrackAnalysis, existing: Show | null, fromCache: boolean, metricalLevel?: number, arrangementUnchanged?: true) {
	const stored = existing ? JSON.stringify(existing) : null;
	if (stored) mocks.readFile.mockResolvedValue(stored);
	else mocks.readFile.mockRejectedValue(new Error('ENOENT'));
	mocks.ingest.mockResolvedValue({ id: analysis.trackId, analysis, fromCache, arrangementUnchanged, meta: {}, context: undefined });
	const response = await POST({ request: new Request('http://localhost/api/ingest', {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ source: 'test-source', metricalLevel })
	}) } as Parameters<typeof POST>[0]);
	expect(mocks.ingest).toHaveBeenCalledWith('test-source', { metricalLevel });
	const body = await response.json() as { show: Show | null; fromCache: boolean };
	expect(body.fromCache).toBe(fromCache);
	if (stored) expect(JSON.stringify(existing)).toBe(stored);
	return body.show;
}

function expectWritten(show: Show | null, analysis: TrackAnalysis) {
	expect(lintShow).toHaveBeenCalledOnce();
	expect(mocks.writeFile).toHaveBeenCalledWith(`/cache/${analysis.trackId}.show.json`, JSON.stringify(show, null, '\t'));
}

describe('direct ingest show refresh', () => {
	it('keeps the compatible saved cue choices on an articulation-only refresh', async () => {
		const analysis = fixture();
		const saved = composeShow(analysis, { seed: 103 });
		saved.defaults.intensity = 0.61;
		analysis.onsets.snare.levels = analysis.onsets.snare.levels.map((level) => level * 0.8);
		expect(await ingest(analysis, saved, false, undefined, true)).toEqual(saved);
		expect(mocks.writeFile).not.toHaveBeenCalled();
	});

	it('still rebuilds a compatible arrangement for an explicit grid correction', async () => {
		const analysis = fixture();
		const saved = composeShow(analysis, { seed: 103 });
		saved.defaults.intensity = 0.61;
		const refreshed = await ingest(analysis, saved, false, 1, true);
		expect(refreshed).toEqual(composeShow(analysis, { seed: saved.seed }));
		expectWritten(refreshed, analysis);
	});

	it('recomposes freshly analysed engine shows with their saved zero seed', async () => {
		const analysis = fixture();
		const saved = composeShow(analysis, { seed: 0 });
		analysis.bars.forEach((bar) => { bar.snares = 0; });
		const show = await ingest(analysis, saved, false);
		expect(show).toEqual(composeShow(analysis, { seed: 0 }));
		expectWritten(show, analysis);
	});

	it('refreshes an old engine version even when analysis came from cache', async () => {
		const analysis = fixture();
		const saved = { ...composeShow(analysis, { seed: 42 }), version: SHOW_VERSION - 1 };
		const show = await ingest(analysis, saved, true);
		expect(show).toEqual(composeShow(analysis, { seed: 42 }));
		expectWritten(show, analysis);
	});

	it('does not lint or rewrite a current saved arrangement when analysis was reused', async () => {
		const analysis = fixture();
		const saved = composeShow(analysis, { seed: 55 });
		saved.defaults.intensity = 0.61;
		expect(await ingest(analysis, saved, true)).toEqual(saved);
		expect(lintShow).not.toHaveBeenCalled();
		expect(mocks.writeFile).not.toHaveBeenCalled();
	});

	it.each(['claude', 'deepseek'] as const)('preserves %s shows on ordinary analysis refresh', async (authoredBy) => {
		const analysis = fixture();
		const saved = { ...composeShow(analysis, { seed: 73 }), authoredBy, version: SHOW_VERSION - 1 };
		expect(await ingest(analysis, saved, false)).toEqual(saved);
		expect(lintShow).not.toHaveBeenCalled();
		expect(mocks.writeFile).not.toHaveBeenCalled();
	});

	it.each(['engine', 'claude'] as const)('rebuilds %s cues on explicit grid correction and retains the roll', async (authoredBy) => {
		const analysis = fixture();
		const saved = { ...composeShow(analysis, { seed: 0 }), authoredBy };
		analysis.bars.forEach((bar) => { bar.snares = 0; });
		const show = await ingest(analysis, saved, false, 2);
		expect(show).toEqual(composeShow(analysis, { seed: 0 }));
		expect(show?.authoredBy).toBe('engine');
		expectWritten(show, analysis);
	});

	it.each([undefined, 2])('never carries a saved roll into different audio (correction %s)', async (metricalLevel) => {
		const analysis = fixture();
		const saved = { ...composeShow(analysis, { seed: 99 }), analysisHash: 'another-recording' };
		const show = await ingest(analysis, saved, false, metricalLevel);
		expect(show).toEqual(composeShow(analysis));
		expectWritten(show, analysis);
	});

	it('keeps a rejected new composition off disk', async () => {
		const analysis = fixture();
		vi.mocked(lintShow).mockReturnValueOnce({ ok: false, errors: [], warnings: [] });
		expect(await ingest(analysis, null, false)).toBeNull();
		expect(lintShow).toHaveBeenCalledOnce();
		expect(mocks.writeFile).not.toHaveBeenCalled();
	});
});
