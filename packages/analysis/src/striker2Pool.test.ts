import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSession, type OnnxSession, type OnnxTensor } from './onnxSession.ts';
import { Striker2, readStriker2, type Striker2Model, type Striker2Result } from './striker2.ts';
import { releaseStriker2, withStriker2 } from './striker2Pool.ts';
import { readVerdicts, type Machine } from './striker2Provider.ts';

const cache = vi.hoisted(() => ({ dir: '' }));
vi.mock('./paths.ts', async (original) => ({
	...(await original<typeof import('./paths.ts')>()), get CACHE_DIR() { return cache.dir; }
}));

const FIXTURE = join(import.meta.dirname, 'testdata', 'striker2');
const MAC: Machine = {
	platform: 'darwin', arch: 'arm64', release: '24.6.0', cpu: 'Apple M1 Pro', model: 'MacBookPro18,1', gpu: null
};

function mono(): Float32Array {
	const buf = readFileSync(join(FIXTURE, 'audio.s16'));
	return Float32Array.from({ length: buf.length / 2 }, (_, i) => buf.readInt16LE(2 * i) / 32768);
}

/** CPU sessions under any provider's name; `spoil` edits Core ML's outputs from its nth run. */
function sessions(spoil: (out: Record<string, OnnxTensor>, run: number) => void = () => {}) {
	const opened: string[] = [];
	const state = { live: 0, most: 0 };
	const open = async (path: string, options: Record<string, unknown>): Promise<OnnxSession> => {
		const [first] = options.executionProviders as (string | { name: string })[];
		const name = typeof first === 'string' ? first : first.name;
		opened.push(name);
		const real = await openSession(path, { ...options, executionProviders: ['cpu'] });
		state.most = Math.max(state.most, ++state.live);
		let runs = 0;
		return {
			...real,
			async run(feeds, o) {
				const out = await real.run(feeds, o);
				if (name !== 'cpu') spoil(out, runs++);
				return out;
			},
			async release() {
				state.live--;
				await real.release();
			}
		};
	};
	const options = { platform: 'darwin', arch: 'arm64', machine: MAC, bundled: ['cpu', 'coreml'], open };
	return { open, opened, state, options };
}

let model: Striker2Model;
let reference: Striker2Result;
beforeAll(async () => {
	model = await readStriker2(FIXTURE);
	const cpu = await Striker2.create(model);
	reference = await cpu.run(mono());
	await cpu.close();
});
beforeEach(async () => {
	cache.dir = await mkdtemp(join(tmpdir(), 'lightningstrike-pool-'));
});
afterEach(async () => {
	await releaseStriker2();
	await rm(cache.dir, { recursive: true, force: true });
});

const song = (lease: { run(m: Float32Array): Promise<Striker2Result> }) => lease.run(mono());

describe('the Striker 2.0 session pool', () => {
	it('keeps one checked session for the songs of a run', async () => {
		const mock = sessions();
		const first = await withStriker2(model, 'auto', async (lease) => ({ lease, heard: await song(lease) }),
			mock.options);
		const second = await withStriker2(model, 'auto', async (lease) => ({ lease, heard: await song(lease) }),
			mock.options);
		expect(mock.opened).toEqual(['coreml']);
		expect([first.lease.provider, second.lease.provider]).toEqual(['coreml:56', 'coreml:56']);
		expect(second.lease.check).toBe(first.lease.check);
		expect(first.heard).toEqual(reference);
		expect(second.heard).toEqual(reference);
		expect(mock.state.live).toBe(1);
	});

	it('releases the session after an idle spell, and opens it again for the next song', async () => {
		const mock = sessions();
		await withStriker2(model, 'cpu', async () => {}, { ...mock.options, idleMs: 30 });
		expect(mock.state.live).toBe(1);
		await vi.waitFor(() => expect(mock.state.live).toBe(0), { timeout: 2000 });
		await withStriker2(model, 'cpu', async () => {}, mock.options);
		expect(mock.opened).toEqual(['cpu', 'cpu']);
	});

	it('releases the session before opening another for a new provider setting or model', async () => {
		const mock = sessions();
		await withStriker2(model, 'auto', async () => {}, mock.options);
		await withStriker2(model, 'cpu', async () => {}, mock.options);
		const elsewhere = join(cache.dir, 'striker2.onnx');
		await copyFile(model.graph, elsewhere);
		await withStriker2({ ...model, graph: elsewhere }, 'cpu', async () => {}, mock.options);
		await withStriker2({ ...model, sha256: 'e'.repeat(64) }, 'cpu', async () => {}, mock.options);
		expect(mock.opened).toEqual(['coreml', 'cpu', 'cpu', 'cpu']);
		expect([mock.state.most, mock.state.live]).toEqual([1, 1]);
	});

	it('runs songs that arrive together one after another on the one session', async () => {
		const mock = sessions();
		const order: string[] = [];
		const work = (name: string) => async () => {
			order.push(`${name} in`);
			await new Promise((r) => setTimeout(r, 30));
			order.push(`${name} out`);
		};
		await Promise.all([
			withStriker2(model, 'auto', work('a'), mock.options),
			withStriker2(model, 'cpu', work('b'), mock.options),
			withStriker2(model, 'cpu', work('c'), mock.options),
			releaseStriker2(),
			withStriker2(model, 'cpu', work('d'), mock.options)
		]);
		expect(order).toEqual(['a in', 'a out', 'b in', 'b out', 'c in', 'c out', 'd in', 'd out']);
		expect(mock.opened).toEqual(['coreml', 'cpu', 'cpu']);
		expect(mock.state.most).toBe(1);
	});

	it('runs a song again on the CPU when Core ML breaks on it, and leaves Core ML off from then on', async () => {
		// Two runs pass the check on the golden chunks; the song's first chunk then comes back broken.
		const mock = sessions((out, run) => {
			if (run >= 2) out.drum_onset.data[5] = NaN;
		});
		const log = vi.fn();
		const broken = await withStriker2(model, 'auto', async (lease) => ({ heard: await song(lease), lease }),
			{ ...mock.options, log });
		expect(broken.heard).toEqual(reference);
		expect(broken.lease.provider).toBe('cpu');
		expect(broken.lease.warnings).toEqual([
			"coreml:56 failed on this song (Striker 2.0's graph returned a non-finite drum_onset), so it ran again on the CPU"
		]);
		expect(log).toHaveBeenCalledWith(`Striker 2.0: ${broken.lease.warnings[0]}`);
		expect(mock.opened).toEqual(['coreml', 'cpu']);
		expect(mock.state.most).toBe(1);
		const verdicts = Object.values(await readVerdicts());
		expect(verdicts.map((v) => [v.key.provider, v.verdict])).toEqual([['coreml', 'fail'], ['cpu', 'pass']]);
		expect(verdicts[0].reason).toMatch(/^it failed on a song \(/);
		const next = await withStriker2(model, 'auto', async (lease) => lease, mock.options);
		expect([next.provider, mock.opened.length]).toEqual(['cpu', 2]);
		expect(next.warnings).toEqual([expect.stringMatching(/^coreml:56 is not used: it failed on a song/)]);
		await releaseStriker2();
		const fresh = await withStriker2(model, 'auto', async (lease) => lease, mock.options);
		expect(fresh.provider).toBe('cpu');
		expect(fresh.warnings).toEqual([expect.stringMatching(/^coreml:56 is not used: it failed on a song/)]);
		expect(mock.opened).toEqual(['coreml', 'cpu', 'cpu']);
	});

	it('fails the song when the CPU itself fails, keeping the queue free for the next', async () => {
		const create = vi.spyOn(Striker2, 'create').mockRejectedValueOnce(new Error('no session'));
		await expect(withStriker2(model, 'cpu', async () => {}, sessions().options)).rejects.toThrow('no session');
		create.mockRestore();
		await expect(withStriker2(model, 'cpu', async (lease) => lease.provider, sessions().options))
			.resolves.toBe('cpu');
	});
});
