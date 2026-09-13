import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, toNamespacedPath } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCachedCpuSession } from './cpuGraphCache.ts';

const failures = vi.hoisted(() => ({ link: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:fs/promises')>();
	return { ...original, link: (...args: Parameters<typeof original.link>) => {
		if (failures.link) return Promise.reject(Object.assign(new Error('unsupported links'), { code: 'ENOTSUP' }));
		return original.link(...args);
	} };
});
const directories: string[] = [];
afterEach(() => {
	vi.restoreAllMocks(); failures.link = false;
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), 'lightningstrike-graphs-'));
	directories.push(dir);
	const cacheDir = join(dir, 'cache');
	const modelPath = join(dir, 'htdemucs.onnx');
	writeFileSync(modelPath, 'verified original');
	const calls: { path: string; options: Record<string, unknown> }[] = [];
	const input = {
		cacheDir, modelPath, modelSha256: 'source-model-hash', runtimeVersion: '1.27.0',
		sessionOptions: { executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: 4 },
		load: async (path: string, options: Record<string, unknown>) => {
			calls.push({ path, options });
			readFileSync(path);
			if (options.optimizedModelFilePath) writeFileSync(String(options.optimizedModelFilePath), 'compiled graph');
			return { path };
		}
	};
	const graphs = () => readdirSync(cacheDir).filter(name => !name.startsWith('.') && name.endsWith('.onnx'));
	const graph = () => join(cacheDir, graphs()[0]);
	return { dir, input, calls, graph, graphs };
}

describe('optional CPU graph cache', () => {
	it('runs the original without cache configuration or a known runtime version', async () => {
		const { input, calls } = fixture();
		await createCachedCpuSession({ ...input, cacheDir: undefined });
		await createCachedCpuSession({ ...input, runtimeVersion: undefined });
		expect(calls.every(call => call.path === input.modelPath && !call.options.optimizedModelFilePath)).toBe(true);
	});

	it('verifies content-addressed bytes before reopening without graph transforms', async () => {
		const { input, calls, graph, graphs } = fixture();
		await createCachedCpuSession(input);
		const cached = graph();
		await createCachedCpuSession(input);
		expect(calls.map(call => call.path)).toEqual([input.modelPath, toNamespacedPath(cached)]);
		expect(calls[1].options.graphOptimizationLevel).toBe('disabled');
		expect(graphs()).toHaveLength(1);
		expect(readdirSync(input.cacheDir)).toEqual(graphs());
	});

	it('prunes stale model, runtime and thread configurations without accumulating variants', async () => {
		const { input, calls, graphs } = fixture();
		await createCachedCpuSession(input);
		await createCachedCpuSession({ ...input, modelSha256: 'different-model' });
		await createCachedCpuSession({ ...input, runtimeVersion: '1.28.0' });
		await createCachedCpuSession({ ...input, sessionOptions: { ...input.sessionOptions, intraOpNumThreads: 6 } });
		expect(calls.every(call => call.path === input.modelPath)).toBe(true);
		expect(graphs()).toHaveLength(1);
	});

	it('rejects same-length corruption before the native loader sees it', async () => {
		const { input, calls, graph } = fixture();
		await createCachedCpuSession(input);
		const bytes = readFileSync(graph()); bytes[0] ^= 1; writeFileSync(graph(), bytes);
		await createCachedCpuSession(input);
		expect(calls.every(call => call.path === input.modelPath)).toBe(true);
		expect(readFileSync(graph(), 'utf8')).toBe('compiled graph');
	});

	it('rebuilds a verified cache that the current runtime cannot load', async () => {
		const { input, calls, graph } = fixture();
		await createCachedCpuSession(input);
		const cached = graph();
		const result = await createCachedCpuSession({ ...input, load: async (path, options) => {
			if (path === toNamespacedPath(cached)) throw new Error('unsupported compiled operator');
			return input.load(path, options);
		} });
		expect(result.path).toBe(input.modelPath);
		expect(calls).toHaveLength(2);
	});

	it('keeps inference available when the cache directory or graph export is unwritable', async () => {
		const { input, dir } = fixture();
		const blocked = join(dir, 'not-a-directory'); writeFileSync(blocked, 'keep');
		expect((await createCachedCpuSession({ ...input, cacheDir: blocked })).path).toBe(input.modelPath);
		const result = await createCachedCpuSession({ ...input, load: async (path, options) => {
			if (options.optimizedModelFilePath) {
				writeFileSync(String(options.optimizedModelFilePath), 'partial');
				throw new Error('export failed');
			}
			return input.load(path, options);
		} });
		expect(result.path).toBe(input.modelPath);
		expect(readdirSync(input.cacheDir)).toEqual([]);
	});

	it('returns the already loaded session if hard links are unsupported and cleans its export', async () => {
		const { input, calls } = fixture(); failures.link = true;
		expect((await createCachedCpuSession(input)).path).toBe(input.modelPath);
		expect(calls).toHaveLength(1);
		expect(readdirSync(input.cacheDir)).toEqual([]);
	});

	it('ignores an interrupted legacy lease and removes only exports from confirmed dead processes', async () => {
		const { input, graph } = fixture(); mkdirSync(input.cacheDir);
		const dead = '.htdemucs.cpu-v2.987654321.aaaa-bbbb.tmp.onnx';
		const live = `.htdemucs.cpu-v2.${process.pid}.aaaa-bbbb.tmp.onnx`;
		const denied = '.htdemucs.cpu-v2.987654320.aaaa-bbbb.tmp.onnx';
		for (const file of [dead, live, denied, 'htdemucs.lock']) writeFileSync(join(input.cacheDir, file), 'partial');
		vi.spyOn(process, 'kill').mockImplementation((pid) => {
			if (pid === 987654321) throw Object.assign(new Error('dead'), { code: 'ESRCH' });
			if (pid === 987654320) throw Object.assign(new Error('unknown'), { code: 'EPERM' });
			return true;
		});
		await createCachedCpuSession(input);
		expect(readdirSync(input.cacheDir)).not.toContain(dead);
		expect(readdirSync(input.cacheDir)).toEqual(expect.arrayContaining([live, denied, 'htdemucs.lock']));
		expect((await createCachedCpuSession(input)).path).toBe(toNamespacedPath(graph()));
	});

	it('does not publish oversized exports and retains valid inference', async () => {
		const { input } = fixture();
		const result = await createCachedCpuSession({ ...input, load: async (path, options) => {
			const loaded = await input.load(path, options);
			if (options.optimizedModelFilePath) truncateSync(String(options.optimizedModelFilePath), 512 * 1024 ** 2 + 1);
			return loaded;
		} });
		expect(result.path).toBe(input.modelPath);
		expect(readdirSync(input.cacheDir)).toEqual([]);
	});

	it('falls back safely if another configuration prunes a verified graph before native opening', async () => {
		const { input, graph, graphs } = fixture(); await createCachedCpuSession(input);
		const cached = graph();
		let announce!: () => void; const entered = new Promise<void>(resolve => { announce = resolve; });
		let resume!: () => void; const paused = new Promise<void>(resolve => { resume = resolve; });
		const first = createCachedCpuSession({ ...input, load: async (path, options) => {
			if (path === toNamespacedPath(cached)) { announce(); await paused; }
			return input.load(path, options);
		} });
		await entered;
		await createCachedCpuSession({ ...input, runtimeVersion: 'different-runtime' });
		resume();
		expect((await first).path).toBe(input.modelPath);
		expect(graphs()).toHaveLength(1);
		expect(readFileSync(graph(), 'utf8')).toBe('compiled graph');
	});
});
