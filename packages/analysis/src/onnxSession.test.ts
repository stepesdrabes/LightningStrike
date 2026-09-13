import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openSession } from './onnxSession.ts';

/** Protocol-buffer bytes for an ONNX graph computing y = x + x over a dynamic float vector. */
function doublingModel(): Buffer {
	const varint = (value: number) => {
		const bytes: number[] = [];
		while (value > 127) {
			bytes.push((value & 127) | 128);
			value >>>= 7;
		}
		bytes.push(value);
		return bytes;
	};
	const field = (number: number, value: number | string | number[]): number[] => {
		if (typeof value === 'number') return [...varint(number << 3), ...varint(value)];
		const bytes = typeof value === 'string' ? [...Buffer.from(value)] : value;
		return [...varint((number << 3) | 2), ...varint(bytes.length), ...bytes];
	};
	const vector = (name: string) => field(1, name).concat(field(2, field(1, field(1, 1).concat(
		field(2, field(1, field(2, 'n')))))));
	const node = field(1, 'x').concat(field(1, 'x'), field(2, 'y'), field(4, 'Add'));
	const graph = field(1, node).concat(field(2, 'double'), field(11, vector('x')), field(12, vector('y')));
	return Buffer.from(field(1, 8).concat(field(8, field(2, 13)), field(7, graph)));
}

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function modelFile(): string {
	const dir = mkdtempSync(join(tmpdir(), 'lightningstrike-onnx-'));
	directories.push(dir);
	const path = join(dir, 'double.onnx');
	writeFileSync(path, doublingModel());
	return path;
}

describe('ONNX sessions on their own thread', () => {
	it('runs, transfers inputs on request and releases', async () => {
		const session = await openSession(modelFile(), { executionProviders: ['cpu'] });
		try {
			expect(session.detached).toBe(true);
			expect(session.inputNames).toEqual(['x']);
			const kept = Float32Array.of(1, 2.5, -3);
			const copied = await session.run({ x: { data: kept, dims: [3] } });
			expect(Array.from(copied.y.data)).toEqual([2, 5, -6]);
			expect(copied.y.dims).toEqual([3]);
			expect(kept.length).toBe(3);
			const moved = Float32Array.of(4);
			const transferred = await session.run({ x: { data: moved, dims: [1] } }, { transfer: true });
			expect(Array.from(transferred.y.data)).toEqual([8]);
			expect(moved.length).toBe(0);
		} finally {
			await session.release();
		}
	});

	it('rejects a model the runtime cannot load', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'lightningstrike-onnx-'));
		directories.push(dir);
		writeFileSync(join(dir, 'broken.onnx'), 'not a model');
		await expect(openSession(join(dir, 'broken.onnx'), {})).rejects.toThrow();
	});

	it('reports a failed run without losing the session', async () => {
		const session = await openSession(modelFile(), { executionProviders: ['cpu'] });
		try {
			await expect(session.run({ missing: { data: Float32Array.of(1), dims: [1] } })).rejects.toThrow();
			const outputs = await session.run({ x: { data: Float32Array.of(1), dims: [1] } });
			expect(Array.from(outputs.y.data)).toEqual([2]);
		} finally {
			await session.release();
		}
	});
});
