import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ ingest: vi.fn(), narration: vi.fn() }));
vi.mock('@mv/analysis', () => ({
	ingest: mocks.ingest, prepareNarration: mocks.narration, workspaceRoot: () => '/no/checkout'
}));
import { ingestDetached, ingestWorker, narrationDetached } from './ingestDetached.ts';

// Speaks ingestWorker.ts's protocol: one job at a time, a thread id to tell workers apart.
const FAKE = `
import { parentPort, threadId } from 'node:worker_threads';
let jobs = 0;
let active = 0;
parentPort.on('message', (m) => {
	if (m.type === 'close') return parentPort.postMessage({ type: 'closed' });
	if (m.source === 'crash') process.exit(3);
	active++;
	parentPort.postMessage({ type: 'progress', stage: 'job ' + (++jobs) });
	setTimeout(() => {
		active--;
		if (m.source === 'bad') return parentPort.postMessage({ type: 'error', message: 'no audio' });
		parentPort.postMessage({ type: 'done', result: { thread: threadId, jobs, active, task: m.task, opts: m.opts } });
	}, 20);
});
`;

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'lightningstrike-ingest-worker-'));
	writeFileSync(join(dir, 'ingest-worker.mjs'), FAKE);
	process.env.MV_INGEST_WORKER = join(dir, 'ingest-worker.mjs');
});
afterAll(() => {
	delete process.env.MV_INGEST_WORKER;
	rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
	vi.clearAllMocks();
	ingestWorker.idleMs = 100_000;
});

type Echo = { thread: number; jobs: number; active: number; task: string; opts: object };
const run = (source: string, onProgress?: (stage: string) => void) =>
	ingestDetached(source, { cachedTrackId: 'abc', onProgress }) as unknown as Promise<Echo>;

describe('the ingest worker', () => {
	it('serves song after song from one thread, one at a time, so Striker 2.0 keeps its session', async () => {
		const progress = vi.fn();
		const [a, b, c] = await Promise.all([run('a', progress), run('b'), run('c')]);
		expect([a.jobs, b.jobs, c.jobs]).toEqual([1, 2, 3]);
		expect(new Set([a.thread, b.thread, c.thread]).size).toBe(1);
		expect([a.active, b.active, c.active]).toEqual([0, 0, 0]);
		expect(progress).toHaveBeenCalledWith('job 1');
		expect(a.opts).toEqual({ cachedTrackId: 'abc' });
		const told = (await narrationDetached('voice.wav')) as unknown as Echo;
		expect([told.thread, told.task]).toEqual([a.thread, 'narration']);
	});

	it('rejects a failed song and serves the next one from the same thread', async () => {
		const before = await run('a');
		await expect(run('bad')).rejects.toThrow('no audio');
		expect((await run('b')).thread).toBe(before.thread);
	});

	it('closes once idle, and starts a fresh thread for the next song', async () => {
		ingestWorker.idleMs = 20;
		const first = await run('a');
		await new Promise((resolve) => setTimeout(resolve, 300));
		const second = await run('b');
		expect(second.thread).not.toBe(first.thread);
		expect(second.jobs).toBe(1);
	});

	it('runs a song in process when the worker dies before it answers, then starts a new one', async () => {
		const first = await run('a');
		mocks.ingest.mockResolvedValueOnce({ id: 'in-process' });
		await expect(ingestDetached('crash')).resolves.toEqual({ id: 'in-process' });
		expect(mocks.ingest).toHaveBeenCalledWith('crash', {});
		expect((await run('b')).thread).not.toBe(first.thread);
	});
});
