import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrumSeparator } from './separation.ts';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('optional drum separator', () => {
	it('rejects unsupported providers instead of silently reporting CPU as an accelerator', async () => {
		await expect(DrumSeparator.create('missing', { provider: 'coreml' as 'cpu' })).rejects.toThrow('Unsupported separator provider');
	});
	it('restarts failed DirectML stages on CPU and retains the FFT graph contracts', async () => {
		const separator = Object.assign(Object.create(DrumSeparator.prototype), {
			provider: 'dml', modelDir: 'mock-models', threads: 4
		}) as DrumSeparator;
		const releases = vi.fn(async () => undefined);
		const calls: any[] = [];
		const fakeOrt = {
			Tensor: class { constructor(public type: string, public data: Float32Array, public dims: number[]) {} },
			InferenceSession: { create: async (_path: string, options: any) => {
				calls.push(options);
				if (options.executionProviders[0] === 'dml') throw new Error('device unavailable');
				return { release: releases, run: async (feeds: any) => {
					expect(feeds.mix.dims).toEqual([1, 2, 343980]);
					expect(feeds.magnitude.dims).toEqual([1, 4, 2048, 336]);
					return { time_output: { data: new Float32Array(2 * 343980), dims: [1, 1, 2, 343980] },
						freq_output: { data: new Float32Array(4 * 2048 * 336), dims: [1, 1, 4, 2048, 336] } };
				} };
			} }
		};
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const input = Float32Array.of(-.2, .1, .2, -.1);
			const result = await (separator as any).stage([input, input], 'drums', fakeOrt);
			expect(result[0][0]).toHaveLength(4);
			expect(calls.map(options => options.executionProviders[0])).toEqual(['dml', 'cpu']);
			expect(calls[0].extra.ep.dml.disable_graph_fusion).toBe('1');
			expect(calls[0].enableMemPattern).toBe(false);
			expect(releases).toHaveBeenCalledOnce();
		} finally { warn.mockRestore(); }
	});
	it.skipIf(!process.env.MV_SEPARATION_TEST_MODELS)('reopens compiled CPU graphs without changing PCM', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'lightningstrike-separation-graphs-'));
		directories.push(dir);
		const input = Float32Array.from({ length: 129920 }, (_, i) =>
			(.2 * Math.sin(.017 * i) + .1 * Math.cos(.191 * i)) * Math.exp(-i / 8000));
		const separator = await DrumSeparator.create(undefined, { threads: 4, graphCacheDir: dir });
		expect(separator).not.toBeNull();
		try {
			const fresh = await separator!.run(input, input);
			expect(readdirSync(dir).filter(name => name.endsWith('.onnx'))).toHaveLength(2);
			const cached = await separator!.run(input, input);
			for (const kind of ['drums', 'kick', 'snare', 'cymbal'] as const) {
				expect(Buffer.from(cached[kind].buffer).equals(Buffer.from(fresh[kind].buffer))).toBe(true);
			}
		} finally { await separator!.close(); }
	}, 180_000);

	it('stays unavailable when either model is absent', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'lightningstrike-separation-'));
		directories.push(dir);
		expect(await DrumSeparator.create(dir)).toBeNull();
		writeFileSync(join(dir, 'htdemucs.onnx'), 'incomplete installation');
		expect(await DrumSeparator.create(dir)).toBeNull();
	});
	it('refuses an unverified export before loading native inference', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'lightningstrike-separation-'));
		directories.push(dir);
		writeFileSync(join(dir, 'htdemucs.onnx'), 'wrong export');
		writeFileSync(join(dir, 'drumsep.onnx'), 'wrong attention mask');
		await expect(DrumSeparator.create(dir)).rejects.toThrow('checksum mismatch');
	});
	it.skipIf(!process.env.MV_SEPARATION_TEST_MODELS)('keeps silence silent, validates inputs and preserves a very short tail', async () => {
		const separator = await DrumSeparator.create(undefined, { threads: 2 });
		expect(separator).not.toBeNull();
		try {
			const silent = await separator!.run(new Float32Array(0), new Float32Array(0));
			expect(silent.snare.length).toBe(0);
			const dc = await separator!.run(new Float32Array(1025).fill(.2), new Float32Array(1025).fill(.2));
			expect(dc.kick.every(x => x === 0)).toBe(true);
			await expect(separator!.run(new Float32Array(2), new Float32Array(1))).rejects.toThrow('equal lengths');
			await expect(separator!.run(Float32Array.of(NaN), Float32Array.of(0))).rejects.toThrow('finite');
			for (const length of [1025, 129920]) {
				const input = Float32Array.from({ length },
					(_, i) => .2 * Math.sin(.17 * i) * Math.exp(-i / 300));
				const events: string[] = [];
				const result = await separator!.run(input, input,
					p => events.push(`${p.stage}:${p.completed}/${p.total}`));
				for (const pcm of [result.drums, result.kick, result.snare, result.cymbal]) {
					expect(pcm.length).toBe(input.length);
					expect(pcm.every(Number.isFinite)).toBe(true);
				}
				expect(events).toEqual(['drums:0/1', 'drums:1/1', 'kit:0/1', 'kit:1/1']);
			}
		} finally { await separator!.close(); }
		await expect(separator!.run(new Float32Array(0), new Float32Array(0))).rejects.toThrow('closed');
	}, 180_000);
});
