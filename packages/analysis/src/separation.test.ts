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
			provider: 'dml', modelDir: 'mock-models', threads: 4, lanes: 2
		}) as DrumSeparator;
		const releases = vi.fn(async () => undefined);
		const calls: any[] = [];
		const open = async (_path: string, options: any) => {
			calls.push(options);
			if (options.executionProviders[0] === 'dml') throw new Error('device unavailable');
			return { detached: true, inputNames: [], release: releases, run: async (feeds: any) => {
				expect(feeds.mix.dims).toEqual([1, 2, 343980]);
				expect(feeds.magnitude.dims).toEqual([1, 4, 2048, 336]);
				return { time_output: { data: new Float32Array(2 * 343980), dims: [1, 1, 2, 343980] },
					freq_output: { data: new Float32Array(4 * 2048 * 336), dims: [1, 1, 4, 2048, 336] } };
			} };
		};
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const input = Float32Array.of(-.2, .1, .2, -.1);
			const result = await (separator as any).stage([input, input], 'drums', open);
			expect(result[0][0]).toHaveLength(4);
			expect(calls.map(options => options.executionProviders[0])).toEqual(['dml', 'cpu']);
			expect(calls[0].extra.ep.dml.disable_graph_fusion).toBe('1');
			expect(calls[0].enableMemPattern).toBe(false);
			expect(releases).toHaveBeenCalledOnce();
		} finally { warn.mockRestore(); }
	});
	it('feeds the kit model the raw stereo drum spectrogram and keeps kick, snare, hi-hat and cymbal stems', async () => {
		const separator = Object.assign(Object.create(DrumSeparator.prototype), {
			provider: 'cpu', modelDir: 'mock-models', threads: 4, lanes: 1
		}) as DrumSeparator;
		const length = 30000;
		const left = Float32Array.from({ length }, (_, i) => 3 * Math.sin(.013 * i));
		const right = Float32Array.from({ length }, (_, i) => 2 * Math.cos(.007 * i));
		const open = async () => ({ detached: true, inputNames: [], release: async () => undefined, run: async (feeds: any) => {
			expect(feeds.spec.dims).toEqual([1, 4, 1024, 1024]);
			// Stem s answers (s + 1) times the input, so each kept stem names the network output it came from.
			const spec = feeds.spec.data as Float32Array;
			const sources = new Float32Array(5 * spec.length);
			for (let s = 0; s < 5; s++) for (let i = 0; i < spec.length; i++) sources[s * spec.length + i] = (s + 1) * spec[i];
			return { sources: { data: sources, dims: [1, 5, 4, 1024, 1024] } };
		} });
		const [kick, snare, hat, cymbal] = await (separator as any).stage([left, right], 'kit', open);
		for (const [stem, gain] of [[kick, 1], [snare, 2], [hat, 4], [cymbal, 5]] as const) {
			for (const i of [0, 777, 15000, length - 1]) {
				expect(Math.abs(stem[0][i] - gain * left[i])).toBeLessThan(2e-3 * gain);
				expect(Math.abs(stem[1][i] - gain * right[i])).toBeLessThan(2e-3 * gain);
			}
		}
	}, 60_000);
	it('commits concurrent lanes in chunk order, identical to one lane', async () => {
		const length = 343980 * 3 + 1234;
		const left = Float32Array.from({ length }, (_, i) => .3 * Math.sin(.013 * i) + .01 * Math.cos(i));
		const right = Float32Array.from({ length }, (_, i) => .2 * Math.cos(.007 * i));
		const separate = async (lanes: number) => {
			const separator = Object.assign(Object.create(DrumSeparator.prototype), {
				provider: 'cpu', modelDir: 'mock-models', threads: 4, lanes
			}) as DrumSeparator;
			let opened = 0;
			let active = 0;
			let overlap = 0;
			const releases = vi.fn(async () => undefined);
			const open = async () => {
				const lane = opened++;
				return { detached: true, inputNames: [], release: releases, run: async (feeds: any) => {
					overlap = Math.max(overlap, ++active);
					// Later lanes answer first, so completion order differs from chunk order.
					await new Promise(accept => setTimeout(accept, lane === 0 ? 30 : 5));
					active--;
					const time = Float32Array.from(feeds.mix.data);
					const frequency = Float32Array.from(feeds.magnitude.data);
					return { time_output: { data: time, dims: [1, 1, 2, 343980] },
						freq_output: { data: frequency, dims: [1, 1, 4, 2048, 336] } };
				} };
			};
			const events: string[] = [];
			const result = await (separator as any).stage([left, right], 'drums', open,
				(p: { completed: number; total: number }) => events.push(`${p.completed}/${p.total}`));
			expect(releases).toHaveBeenCalledTimes(opened);
			return { result, events, opened, overlap };
		};
		const one = await separate(1);
		const two = await separate(2);
		expect(one.opened).toBe(1);
		expect(two.opened).toBe(2);
		expect(two.overlap).toBe(2);
		expect(two.events).toEqual(one.events);
		expect(one.events).toEqual(['0/5', '1/5', '2/5', '3/5', '4/5', '5/5']);
		for (const c of [0, 1]) {
			const [twoLanes, oneLane] = [two.result[0][c], one.result[0][c]];
			expect(Buffer.from(twoLanes.buffer).equals(Buffer.from(oneLane.buffer))).toBe(true);
		}
	});
	it('releases every lane after a failed chunk without starting queued work', async () => {
		const separator = Object.assign(Object.create(DrumSeparator.prototype), {
			provider: 'cpu', modelDir: 'mock-models', threads: 4, lanes: 2
		}) as DrumSeparator;
		const releases = vi.fn(async () => undefined);
		let runs = 0;
		const open = async () => ({ detached: true, inputNames: [], release: releases, run: async () => {
			const call = runs++;
			await new Promise(accept => setTimeout(accept, 5));
			const time = new Float32Array(2 * 343980).fill(call === 0 ? NaN : 0);
			return { time_output: { data: time, dims: [1, 1, 2, 343980] },
				freq_output: { data: new Float32Array(4 * 2048 * 336), dims: [1, 1, 4, 2048, 336] } };
		} });
		const input = Float32Array.from({ length: 343980 * 6 }, (_, i) => Math.sin(i));
		await expect((separator as any).stage([input, input], 'drums', open)).rejects.toThrow('Non-finite drums');
		expect(releases).toHaveBeenCalledTimes(2);
		expect(runs).toBeLessThanOrEqual(3);
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
			for (const kind of ['drums', 'kick', 'snare', 'hat', 'cymbal'] as const) {
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
		writeFileSync(join(dir, 'drumsep-mdx23c.onnx'), 'wrong export');
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
				for (const pcm of [result.drums, result.kick, result.snare, result.hat, result.cymbal]) {
					expect(pcm.length).toBe(input.length);
					expect(pcm.every(Number.isFinite)).toBe(true);
				}
				expect(events).toEqual(['drums:0/1', 'drums:1/1', 'kit:0/1', 'kit:1/1']);
			}
		} finally { await separator!.close(); }
		await expect(separator!.run(new Float32Array(0), new Float32Array(0))).rejects.toThrow('closed');
	}, 180_000);
});
