import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Striker2, readStriker2 } from './striker2.ts';
import { readStriker2Graph } from './striker2Graph.ts';

const FIXTURE = join(import.meta.dirname, 'testdata', 'striker2');
const GRAPH = join(FIXTURE, 'striker2.onnx');

describe("reading Striker 2.0's structure from its graph", () => {
	// Every count below is ONNX shape inference's on the same graph (onnx 1.x, Python).
	it('finds the stages in order, with their rates, widths, blocks and arithmetic', async () => {
		const graph = await readStriker2Graph(GRAPH, { chunk: 400, fps: 100, bins: 179 });
		expect(graph.parameters).toBe(244766);
		expect(graph.stages.map((s) => [s.id, s.kind, s.hz, s.width, s.blocks, s.macs])).toEqual([
			['stem', 'stem', 100, 368, 4, 67824000],
			['proj', 'linear', 100, 64, 1, 9420800],
			['hi', 'conv', 100, 64, 2, 13465600],
			['moves.0', 'down', 25, 96, 1, 2457600],
			['stacks.0', 'transformer', 25, 96, 1, 12979200],
			['activity', 'head', 25, 4, 1, 38400],
			['back', 'up', 100, 64, 1, 2457600],
			['post', 'conv', 100, 64, 1, 6732800],
			['heads', 'head', 100, 60, 1, 1536000]
		]);
	});

	it('finds the skip connection the decoder adds back in', async () => {
		const graph = await readStriker2Graph(GRAPH, { chunk: 400, fps: 100, bins: 179 });
		expect(graph.skips).toEqual([{ from: 'hi', to: 'post' }]);
	});

	it('finds the layers that write each residual stream, and the convolutions between streams', async () => {
		const graph = await readStriker2Graph(GRAPH, { chunk: 400, fps: 100, bins: 179 });
		expect(graph.spaces).toEqual([{ width: 64, hz: 100 }, { width: 96, hz: 25 }]);
		expect(graph.layers.map((l) => `${l.id}@${l.space}`)).toEqual(['proj@0', 'hi.0@0', 'hi.1@0', 'stacks.0.0@1', 'post@0']);
		expect(graph.links.map((l) => [l.stage, l.from, l.to, l.transposed, l.dims, l.data?.length])).toEqual([
			['moves.0', 0, 1, false, [96, 64, 4], 96 * 64 * 4 * 4],
			['back', 1, 0, true, [96, 64, 4], 96 * 64 * 4 * 4]
		]);
	});

	it('finds the heads, the layer each reads, and the outputs its columns split into', async () => {
		const graph = await readStriker2Graph(GRAPH, { chunk: 400, fps: 100, bins: 179 });
		expect(graph.readouts.map((r) => [r.stage, graph.layers[r.layer].id, r.dims, r.data?.length, r.outputs])).toEqual([
			['activity', 'stacks.0.0', [96, 4], 96 * 4 * 4, ['activity']],
			['heads', 'post', [64, 60], 64 * 60 * 4, ['drum_onset', 'drum_offset', 'drum_level', 'beat', 'beat_offset', 'bass']]
		]);
	});
});

describe('exposing inner activations', () => {
	it('hands out every layer without changing a single bit of the outputs', async () => {
		const graph = await readStriker2Graph(GRAPH, { chunk: 400, fps: 100, bins: 179 });
		const model = await readStriker2(FIXTURE);
		const buf = readFileSync(join(FIXTURE, 'features.f32'));
		const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice(0, model.chunk * 179);
		const plain = await Striker2.create(model);
		const exposing = await Striker2.create(model, { expose: graph.layers.map((l) => l.tensor) });
		try {
			const a = await plain.chunk(x);
			const b = await exposing.chunk(x);
			for (const name of Object.keys(a) as (keyof typeof a)[]) expect(b[name]).toEqual(a[name]);
			expect(exposing.exposes).toBe(true);
		} finally {
			await plain.close();
			await exposing.close();
		}
	});
});
