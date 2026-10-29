import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSession, type OnnxSession, type OnnxTensor } from './onnxSession.ts';
import { readStriker2, type Striker2Model } from './striker2.ts';
import {
	COREML, CPU, DIRECTML, PROVIDER_CHECKS, checkKey, openChecked, providerCandidates, providerLabel,
	providerSession, readVerdicts, type ExecutionProvider, type Machine
} from './striker2Provider.ts';

const cache = vi.hoisted(() => ({ dir: '' }));
vi.mock('./paths.ts', async (original) => ({
	...(await original<typeof import('./paths.ts')>()), get CACHE_DIR() { return cache.dir; }
}));

const FIXTURE = join(import.meta.dirname, 'testdata', 'striker2');
const MAC: Machine = {
	platform: 'darwin', arch: 'arm64', release: '24.6.0', cpu: 'Apple M1 Pro', model: 'MacBookPro18,1', gpu: null
};
const ON_MAC = { platform: 'darwin', arch: 'arm64', machine: MAC, bundled: ['cpu', 'coreml', 'webgpu'] };

let model: Striker2Model;
beforeAll(async () => {
	model = await readStriker2(FIXTURE);
});
beforeEach(async () => {
	cache.dir = await mkdtemp(join(tmpdir(), 'lightningstrike-providers-'));
});
afterEach(async () => {
	await rm(cache.dir, { recursive: true, force: true });
});

/**
 * Sessions that run on this CPU whatever provider they are asked for, the accelerated ones with
 * their outputs spoiled as a test wants: Core ML and DirectML cannot run here.
 */
function sessions(spoil: (out: Record<string, OnnxTensor>, run: number) => void = () => {}, refuse = false) {
	const opened: string[] = [];
	let live = 0;
	const open = async (path: string, options: Record<string, unknown>): Promise<OnnxSession> => {
		const [first] = options.executionProviders as (string | { name: string })[];
		const name = typeof first === 'string' ? first : first.name;
		opened.push(name);
		if (refuse && name !== 'cpu') throw new Error(`no ${name} here`);
		const real = await openSession(path, { ...options, executionProviders: ['cpu'] });
		live++;
		let runs = 0;
		return {
			...real,
			async run(feeds, o) {
				const out = await real.run(feeds, o);
				if (name !== 'cpu') spoil(out, runs++);
				return out;
			},
			async release() {
				live--;
				await real.release();
			}
		};
	};
	return { open, opened, live: () => live };
}

describe('provider candidates', () => {
	it.each([
		['darwin', 'arm64', 'auto', true, [COREML, CPU]],
		['darwin', 'arm64', 'cpu', true, [CPU]],
		['darwin', 'arm64', 'auto', false, [CPU]],
		['darwin', 'x64', 'auto', true, [CPU]],
		['win32', 'x64', 'auto', true, [DIRECTML, CPU]],
		['win32', 'x64', 'auto', false, [CPU]],
		['win32', 'x64', 'cpu', true, [CPU]],
		['win32', 'arm64', 'auto', true, [CPU]],
		['linux', 'x64', 'auto', true, [CPU]]
	] as const)('%s %s, %s, static %s', (platform, arch, setting, graph, want) => {
		expect(providerCandidates(setting, graph, platform, arch)).toEqual(want);
	});

	it('opens Core ML as MLProgram with static shapes on the CPU and GPU, and DirectML as it needs', () => {
		expect(providerLabel(COREML)).toBe('coreml:56');
		expect(providerSession(COREML)).toEqual({ executionProviders: [{ name: 'coreml', coreMlFlags: 56 }, 'cpu'] });
		expect(providerLabel(DIRECTML)).toBe('dml:0');
		expect(providerSession(DIRECTML)).toEqual({
			executionProviders: [{ name: 'dml', deviceId: 0 }, 'cpu'], enableMemPattern: false, executionMode: 'sequential'
		});
		expect(providerSession(CPU)).toEqual({ executionProviders: ['cpu'] });
		const threads: ExecutionProvider = { name: 'cpu', threads: 8 };
		expect([providerLabel(threads), providerSession(threads)])
			.toEqual(['cpu threads=8', { executionProviders: ['cpu'], intraOpNumThreads: 8 }]);
	});
});

describe('the check key', () => {
	it('changes with the graph, the provider and its options, the threads and the machine', () => {
		const id = (m: Striker2Model, p: ExecutionProvider, machine: Machine) => checkKey(m, p, machine).id;
		const base = id(model, COREML, MAC);
		expect(base).toMatch(/^[0-9a-f]{16}$/);
		expect(id(model, COREML, { ...MAC })).toBe(base);
		const others = [
			id({ ...model, sha256: '0'.repeat(64) }, COREML, MAC),
			id(model, { name: 'coreml', options: { coreMlFlags: 24 } }, MAC),
			id(model, CPU, MAC),
			id(model, { ...COREML, threads: 6 }, MAC),
			id(model, COREML, { ...MAC, release: '25.0.0' }),
			id(model, COREML, { ...MAC, model: 'MacBookPro18,3' }),
			id(model, COREML, { ...MAC, cpu: 'Apple M1 Max' })
		];
		expect(new Set([base, ...others]).size).toBe(others.length + 1);
		expect(checkKey(model, COREML, MAC).key).toMatchObject({
			check: 1, graph: model.sha256, ort: '1.27.0', provider: 'coreml', options: { coreMlFlags: 56 }, threads: 0,
			model: 'MacBookPro18,1'
		});
	});
});

describe('the first-use check', () => {
	it('uses Core ML once it passes, and reuses the stored verdict without checking again', async () => {
		const mock = sessions();
		const log = vi.fn();
		const first = await openChecked(model, 'auto', { ...ON_MAC, open: mock.open, log });
		expect([first.label, first.warnings]).toEqual(['coreml:56', []]);
		expect(log).toHaveBeenCalledWith('checking Striker 2.0 on coreml:56');
		await first.striker.close();
		const verdicts = await readVerdicts();
		expect(verdicts[first.check]).toMatchObject({
			verdict: 'pass', key: { provider: 'coreml', model: 'MacBookPro18,1' }, sessionMs: expect.any(Number),
			checkMs: expect.any(Number), maxAbs: { drum_onset: expect.any(Number) }, events: { kick: expect.any(Object) }
		});
		const again = vi.fn();
		const second = await openChecked(model, 'auto', { ...ON_MAC, open: mock.open, log: again });
		expect([second.label, second.check]).toEqual(['coreml:56', first.check]);
		expect(again.mock.calls).toEqual([['opening Striker 2.0 on coreml:56']]);
		await second.striker.close();
		const updated = await openChecked(model, 'auto', { ...ON_MAC, machine: { ...MAC, release: '25.0.0' },
			open: mock.open, log: again });
		expect(updated.check).not.toBe(first.check);
		expect(again).toHaveBeenCalledWith('checking Striker 2.0 on coreml:56');
		await updated.striker.close();
		expect(mock.opened).toEqual(['coreml', 'coreml', 'coreml']);
		expect(Object.keys(await readVerdicts())).toHaveLength(2);
	});

	it('falls back to the checked CPU when Core ML moves an event, and remembers why', async () => {
		const mock = sessions((out) => out.drum_onset.data.fill(-20));
		const chosen = await openChecked(model, 'auto', { ...ON_MAC, open: mock.open });
		expect(chosen.label).toBe('cpu');
		expect(chosen.warnings).toEqual([expect.stringMatching(/^coreml:56 is not used: kick: 0 of \d+ PyTorch events/)]);
		await chosen.striker.close();
		expect(mock.live()).toBe(0);
		const verdicts = Object.values(await readVerdicts());
		expect(verdicts.map((v) => [v.key.provider, v.verdict])).toEqual([['coreml', 'fail'], ['cpu', 'pass']]);
		const later = await openChecked(model, 'auto', { ...ON_MAC, open: mock.open });
		expect(later.warnings).toEqual(chosen.warnings);
		await later.striker.close();
		expect(mock.opened).toEqual(['coreml', 'cpu', 'cpu']);
	});

	it('records Core ML as close, and does not use it, when only the 1e-3 bar is missed', async () => {
		const mock = sessions((out) => {
			for (let i = 0; i < out.drum_level.data.length; i++) out.drum_level.data[i] += 3e-3;
		});
		const chosen = await openChecked(model, 'auto', { ...ON_MAC, open: mock.open });
		expect(chosen.label).toBe('cpu');
		expect(chosen.warnings).toEqual([
			expect.stringMatching(/^coreml:56 is not used: every event matched, but drum_level differs by 3\.0e-3/)
		]);
		await chosen.striker.close();
		expect(Object.values(await readVerdicts()).map((v) => v.verdict)).toEqual(['close', 'pass']);
	});

	it('falls back to the CPU when DirectML does not open, and skips it under the CPU setting', async () => {
		const windows = { platform: 'win32', arch: 'x64', bundled: ['cpu', 'dml', 'webgpu'], machine: { ...MAC,
			platform: 'win32', arch: 'x64', model: null, gpu: 'NVIDIA GeForce RTX 3060 32.0.15.6094' } };
		const mock = sessions(undefined, true);
		const cpu = await openChecked(model, 'cpu', { ...windows, open: mock.open });
		await cpu.striker.close();
		expect(mock.opened).toEqual(['cpu']);
		const auto = await openChecked(model, 'auto', { ...windows, open: mock.open });
		expect(auto.label).toBe('cpu');
		expect(auto.warnings).toEqual(['dml:0 is not used: its session did not open (no dml here)']);
		await auto.striker.close();
		expect(mock.opened).toEqual(['cpu', 'dml', 'cpu']);
		const verdicts = Object.values(await readVerdicts());
		expect(verdicts.find((v) => v.key.provider === 'dml'))
			.toMatchObject({ verdict: 'fail', key: { gpu: 'NVIDIA GeForce RTX 3060 32.0.15.6094' } });
	});

	it('runs the CPU, with a warning, when even it fails, and offers a dynamic graph to nothing else', async () => {
		const mock = sessions();
		const dynamic = await openChecked({ ...model, static: false }, 'auto', { ...ON_MAC, open: mock.open });
		expect(dynamic.label).toBe('cpu');
		expect(dynamic.warnings).toEqual(['its graph is not static, which the GPU providers need, so the CPU runs it']);
		await dynamic.striker.close();
		const real = sessions().open;
		const cpu = await openChecked(model, 'cpu', {
			...ON_MAC,
			machine: { ...MAC, cpu: 'Apple M1 Pro, flaky' },
			open: async (path, options) => {
				const session = await real(path, options);
				return { ...session, run: async (feeds, o) => {
					const out = await session.run(feeds, o);
					out.beat.data.fill(5);
					return out;
				} };
			}
		});
		expect(cpu.label).toBe('cpu');
		expect(cpu.warnings).toEqual([expect.stringMatching(/^the CPU did not pass its check \(beats: .+\) and runs anyway$/)]);
		await cpu.striker.close();
		expect((await readVerdicts())[cpu.check]).toMatchObject({ verdict: 'fail', key: { provider: 'cpu' } });
	});

	it('never names a provider that the onnxruntime build lacks, which would run on the CPU unseen', async () => {
		const mock = sessions();
		const chosen = await openChecked(model, 'auto', { ...ON_MAC, bundled: ['cpu', 'webgpu'], open: mock.open });
		expect([chosen.label, chosen.warnings])
			.toEqual(['cpu', ['coreml:56 is not used: this onnxruntime-node build does not have it']]);
		await chosen.striker.close();
		expect(mock.opened).toEqual(['cpu']);
	});

	it('never offers an unchecked provider when the golden chunks cannot be read, and says so', async () => {
		const mock = sessions();
		const none = { ...model, golden: { problem: 'the manifest lists no golden chunks' } };
		const chosen = await openChecked(none, 'auto', { ...ON_MAC, open: mock.open });
		expect(chosen.label).toBe('cpu');
		expect(chosen.warnings).toEqual([
			'coreml:56 is not used: it cannot be checked (the manifest lists no golden chunks)',
			'the CPU runs unchecked: the manifest lists no golden chunks'
		]);
		await chosen.striker.close();
		expect(mock.opened).toEqual(['cpu']);
		expect(await readVerdicts()).toEqual({});
		await expect(readFile(join(cache.dir, PROVIDER_CHECKS), 'utf8')).rejects.toThrow();
	});
});
