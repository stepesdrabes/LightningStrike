import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
	opened: [] as { model: string; provider: string }[], runs: [] as string[], released: [] as string[],
	failWarmup: false, silentDrums: false
}));
vi.mock('./onnxSession.ts', () => ({
	openSession: async (path: string, options: { executionProviders: string[] }) => {
		const model = path.replace(/^.*[\\/]/, '');
		const provider = options.executionProviders[0];
		const name = `${model}:${provider}:${calls.opened.length}`;
		calls.opened.push({ model, provider });
		return {
			detached: true, inputNames: [],
			release: async () => { calls.released.push(name); },
			run: async (feeds: Record<string, { data: Float32Array; dims: number[] }>) => {
				const input = feeds.spec ?? feeds.mix;
				const warmup = input.data.every(v => v === 0);
				calls.runs.push(`${name}${warmup ? ':warmup' : ''}`);
				if (warmup && calls.failWarmup) throw new Error('device removed');
				if (feeds.spec) {
					const sources = new Float32Array(5 * input.data.length);
					for (let s = 0; s < 5; s++) sources.set(input.data, s * input.data.length);
					return { sources: { data: sources, dims: [1, 5, ...input.dims.slice(1)] } };
				}
				const time = calls.silentDrums ? new Float32Array(input.data.length) : input.data.slice();
				return {
					time_output: { data: time, dims: [1, 1, 2, input.dims[2]] },
					freq_output: { data: new Float32Array(feeds.magnitude.data.length), dims: [1, 1, ...feeds.magnitude.dims.slice(1)] }
				};
			}
		};
	}
}));
const checksums = vi.hoisted(() => ({
	wrong: false, waiting: [] as (() => void)[],
	expected: {
		'htdemucs.onnx': 'a6eabce31c0866a7ad7ac545dc7b12fbe4ccd0c86731e94e99fd5b583da504df',
		'drumsep-mdx23c.onnx': 'e2ec140f5487c79b0be512d705746e2ac017bf3ab06d899d561ca963d91755c2'
	} as Record<string, string>
}));
vi.mock('./cpuGraphCache.ts', () => ({
	createCachedCpuSession: (input: {
		modelPath: string; sessionOptions: Record<string, unknown>;
		load: (path: string, options: Record<string, unknown>) => Promise<unknown>;
	}) => input.load(input.modelPath, input.sessionOptions),
	hashFile: (path: string) => new Promise<string>(resolve => checksums.waiting.push(() =>
		resolve(checksums.wrong ? 'mismatch' : checksums.expected[path.replace(/^.*[\\/]/, '')])))
}));
const { DrumSeparator } = await import('./separation.ts');

afterEach(() => {
	calls.opened.length = 0;
	calls.runs.length = 0;
	calls.released.length = 0;
	calls.failWarmup = false;
	calls.silentDrums = false;
	checksums.wrong = false;
	checksums.waiting.length = 0;
});

function separator(provider: 'cpu' | 'dml') {
	return Object.assign(Object.create(DrumSeparator.prototype), {
		provider, modelDir: 'mock-models', threads: 4, lanes: 2
	}) as import('./separation.ts').DrumSeparator;
}

const input = Float32Array.from({ length: 50000 }, (_, i) => .2 * Math.sin(.01 * i));

describe('DirectML kit warm-up', () => {
	it('compiles the kit model beside HTDemucs and reuses that session for the kit chunks', async () => {
		const result = await (separator('dml') as any).separate([input, input]);
		expect(result.kick).toHaveLength(input.length);
		expect(calls.opened).toEqual([
			{ model: 'drumsep-mdx23c.onnx', provider: 'dml' },
			{ model: 'htdemucs.onnx', provider: 'dml' }
		]);
		expect(calls.runs).toEqual(['drumsep-mdx23c.onnx:dml:0:warmup', 'htdemucs.onnx:dml:1', 'drumsep-mdx23c.onnx:dml:0']);
		expect([...calls.released].sort()).toEqual(['drumsep-mdx23c.onnx:dml:0', 'htdemucs.onnx:dml:1']);
	});

	it('restarts the kit stage on CPU when the warm-up fails', async () => {
		calls.failWarmup = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const result = await (separator('dml') as any).separate([input, input]);
			expect(result.snare).toHaveLength(input.length);
		} finally { warn.mockRestore(); }
		expect(calls.opened.at(-1)).toEqual({ model: 'drumsep-mdx23c.onnx', provider: 'cpu' });
		expect(calls.released).toHaveLength(calls.opened.length);
	});

	it('releases an unused warm session when the track has no drums', async () => {
		calls.silentDrums = true;
		const result = await (separator('dml') as any).separate([input, input]);
		expect(result.kick.every((v: number) => v === 0)).toBe(true);
		expect(calls.runs).toEqual(['drumsep-mdx23c.onnx:dml:0:warmup', 'htdemucs.onnx:dml:1']);
		expect([...calls.released].sort()).toEqual(['drumsep-mdx23c.onnx:dml:0', 'htdemucs.onnx:dml:1']);
	});

	it('does not warm DirectML sessions for CPU separation', async () => {
		await (separator('cpu') as any).separate([input, input]);
		expect(calls.opened.every(({ provider }) => provider === 'cpu')).toBe(true);
		expect(calls.runs.some(run => run.endsWith(':warmup'))).toBe(false);
	});
});

describe('DirectML HTDemucs compilation during model verification', () => {
	const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
	const directories: string[] = [];
	beforeEach(() => Object.defineProperty(process, 'platform', { ...platform, value: 'win32' }));
	afterEach(() => {
		Object.defineProperty(process, 'platform', platform);
		for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
	});

	async function verifying() {
		const directory = mkdtempSync(join(tmpdir(), 'separator-models-'));
		directories.push(directory);
		for (const name of ['htdemucs.onnx', 'drumsep-mdx23c.onnx']) writeFileSync(join(directory, name), '');
		const created = DrumSeparator.create(directory, { provider: 'dml' });
		created.catch(() => {});
		await vi.waitFor(() => expect(checksums.waiting).toHaveLength(2));
		expect(calls.opened).toEqual([{ model: 'htdemucs.onnx', provider: 'dml' }]);
		for (const settle of checksums.waiting.splice(0)) settle();
		return created;
	}

	it('opens HTDemucs before the checksums finish and separates with that session', async () => {
		const separator = (await verifying())!;
		const result = await separator.run(input, input);
		await separator.close();
		expect(result.kick).toHaveLength(input.length);
		expect(calls.opened).toEqual([
			{ model: 'htdemucs.onnx', provider: 'dml' },
			{ model: 'drumsep-mdx23c.onnx', provider: 'dml' }
		]);
		expect(calls.runs).toEqual(['drumsep-mdx23c.onnx:dml:1:warmup', 'htdemucs.onnx:dml:0', 'drumsep-mdx23c.onnx:dml:1']);
		expect([...calls.released].sort()).toEqual(['drumsep-mdx23c.onnx:dml:1', 'htdemucs.onnx:dml:0']);
	});

	it('releases that session when a checksum fails', async () => {
		checksums.wrong = true;
		await expect(verifying()).rejects.toThrow('checksum mismatch');
		expect(calls.released).toEqual(['htdemucs.onnx:dml:0']);
	});

	it('releases that session when the separator closes without a run', async () => {
		await (await verifying())!.close();
		expect(calls.runs).toEqual([]);
		expect(calls.released).toEqual(['htdemucs.onnx:dml:0']);
	});
});
