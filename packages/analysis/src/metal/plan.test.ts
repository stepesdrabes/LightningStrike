import * as ort from 'onnxruntime-node';
import { describe, expect, it } from 'vitest';
import { loadMetalAddon } from './addon.ts';
import { mlasParallelism } from './mlas.ts';
import { parseOnnx } from './onnx.ts';
import { MetalPlan, type OrtRuntime } from './plan.ts';

const addon = loadMetalAddon();
const cpu = { executionProviders: ['cpu'], graphOptimizationLevel: 'disabled', enableCpuMemArena: false,
	intraOpNumThreads: 4, interOpNumThreads: 1 };

// A minimal ONNX writer: enough protobuf for the nodes, attributes and float tensors below.
type Attribute = number | number[] | { float: number };
interface Node { op: string; domain?: string; inputs: string[]; outputs: string[]; attributes?: Record<string, Attribute> }

const utf8 = (text: string) => new TextEncoder().encode(text);
function varint(value: number | bigint): number[] {
	let v = BigInt.asUintN(64, BigInt(value));
	const out: number[] = [];
	while (v >= 0x80n) { out.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
	out.push(Number(v));
	return out;
}
function bytes(...parts: (Uint8Array | number[])[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) { out.set(p, at); at += p.length; }
	return out;
}
const field = (number: number, payload: Uint8Array | number[]) => bytes(varint(number * 8 + 2), varint(payload.length), payload);
const scalar = (number: number, value: number) => [...varint(number * 8), ...varint(value)];

function attribute(name: string, value: Attribute): Uint8Array {
	if (Array.isArray(value)) return bytes(field(1, utf8(name)), ...value.map((v) => scalar(8, v)), scalar(20, 7));
	if (typeof value === 'object') {
		const f = new Uint8Array(new Float32Array([value.float]).buffer);
		return bytes(field(1, utf8(name)), [21], f, scalar(20, 1));
	}
	return bytes(field(1, utf8(name)), scalar(3, value), scalar(20, 2));
}

function valueInfo(name: string, dims: number[]): Uint8Array {
	const shape = bytes(...dims.map((d) => field(1, scalar(1, d))));
	return bytes(field(1, utf8(name)), field(2, field(1, bytes(scalar(1, 1), field(2, shape)))));
}

function model(nodes: Node[], initializers: Record<string, { dims: number[]; data: Float32Array }>,
	inputs: Record<string, number[]>, outputs: Record<string, number[]>): Uint8Array {
	const graph = bytes(
		...nodes.map((n, i) => field(1, bytes(
			...n.inputs.map((x) => field(1, utf8(x))), ...n.outputs.map((y) => field(2, utf8(y))),
			field(3, utf8(`n${i}`)), field(4, utf8(n.op)), ...(n.domain ? [field(7, utf8(n.domain))] : []),
			...Object.entries(n.attributes ?? {}).map(([k, v]) => field(5, attribute(k, v)))
		))),
		field(2, utf8('test')),
		...Object.entries(initializers).map(([name, t]) => field(5, bytes(
			...t.dims.map((d) => scalar(1, d)), scalar(2, 1), field(8, utf8(name)),
			field(9, new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength))
		))),
		...Object.entries(inputs).map(([name, dims]) => field(11, valueInfo(name, dims))),
		...Object.entries(outputs).map(([name, dims]) => field(12, valueInfo(name, dims)))
	);
	const opset = (domain: string, version: number) => field(8, bytes(...(domain ? [field(1, utf8(domain))] : []), scalar(2, version)));
	return bytes(scalar(1, 8), opset('', 17), opset('com.microsoft', 1), field(7, graph));
}

function random(seed: number) {
	let s = seed;
	const uniform = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 0.5) / 4294967296;
	return (n: number, scale = 1) => Float32Array.from({ length: n },
		() => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform()) * scale);
}

/** Runs the model on ORT's CPU kernels and on the Metal plan; the plan must agree bit for bit. */
async function compare(bytesOfModel: Uint8Array, feeds: Record<string, { dims: number[]; data: Float32Array }>) {
	const session = await ort.InferenceSession.create(bytesOfModel, cpu as ort.InferenceSession.SessionOptions);
	const results = await session.run(Object.fromEntries(Object.entries(feeds)
		.map(([name, t]) => [name, new ort.Tensor('float32', t.data.slice(), t.dims)])));
	await session.release();
	const want = Object.fromEntries(Object.entries(results).map(([name, t]) => [name, { data: t.data as Float32Array }]));
	const plan = await MetalPlan.create(addon!, parseOnnx(Buffer.from(bytesOfModel)),
		{ parallelism: mlasParallelism(4), cpu, ort: ort as unknown as OrtRuntime });
	try {
		const got = await plan.run(Object.fromEntries(Object.entries(feeds).map(([name, t]) => [name, t.data])));
		if ('doubt' in got) throw new Error(`the plan doubted its result: ${got.doubt}`);
		for (const [name, { data }] of Object.entries(want)) {
			expect(new Uint32Array(got.outputs[name].buffer), name).toEqual(new Uint32Array(data.buffer, data.byteOffset, data.length));
		}
		return want;
	} finally {
		await plan.release();
	}
}

const subnormals = (data: Float32Array) => new Uint32Array(data.buffer, data.byteOffset, data.length)
	.filter((bits) => (bits & 0x7fffffff) !== 0 && (bits & 0x7fffffff) < 0x00800000).length;

describe.skipIf(!addon)('Metal plan against ONNX Runtime', () => {
	it('reproduces attention whose probabilities and partial sums run subnormal', async () => {
		const [b, m, n, d] = [2, 72, 135, 16];
		const draw = random(7);
		// Wide logits give subnormal and zero probabilities; a few tiny queries mark rows of Q K^T.
		const q = draw(b * m * d, 60);
		for (let i = 0; i < q.length; i += 97) q[i] = 1e-30;
		const k = draw(b * n * d), v = draw(b * n * d, 0.5);
		const graph = model([
			{ op: 'FusedMatMul', domain: 'com.microsoft', inputs: ['q', 'k'], outputs: ['logits'],
				attributes: { transB: 1, alpha: { float: 0.125 } } },
			{ op: 'Softmax', inputs: ['logits'], outputs: ['p'], attributes: { axis: -1 } },
			{ op: 'MatMul', inputs: ['p', 'v'], outputs: ['out'] }
		], {}, { q: [b, m, d], k: [b, n, d], v: [b, n, d] }, { p: [b, m, n], out: [b, m, d] });
		const want = await compare(graph, { q: { dims: [b, m, d], data: q }, k: { dims: [b, n, d], data: k },
			v: { dims: [b, n, d], data: v } });
		expect(subnormals(want.p.data)).toBeGreaterThan(50);
	});

	it('replays product sums whose partial sums are subnormal', async () => {
		const [b, m, k, n] = [2, 24, 40, 20];
		const draw = random(3);
		// Rows of 1e-24 against 1e-16 make subnormal products and sums; the rest stay normal.
		const a = draw(b * m * k);
		for (let i = 0; i < b * 4 * k; i++) a[i] *= 1e-24;
		const right = draw(b * k * n, 1e-16), rightT = draw(b * n * k, 1e-16);
		const graph = model([
			{ op: 'MatMul', inputs: ['a', 'right'], outputs: ['plain'] },
			{ op: 'FusedMatMul', domain: 'com.microsoft', inputs: ['a', 'rightT'], outputs: ['transposed'],
				attributes: { transB: 1 } }
		], {}, { a: [b, m, k], right: [b, k, n], rightT: [b, n, k] }, { plain: [b, m, n], transposed: [b, m, n] });
		const want = await compare(graph, { a: { dims: [b, m, k], data: a }, right: { dims: [b, k, n], data: right },
			rightT: { dims: [b, n, k], data: rightT } });
		expect(subnormals(want.plain.data)).toBeGreaterThan(50);
		expect(subnormals(want.transposed.data)).toBeGreaterThan(50);
	});

	it('replays convolution windows over tiny inputs', async () => {
		const draw = random(5);
		const x = draw(4 * 12 * 14);
		// A zeroed patch around one subnormal input gives windows whose whole sum is subnormal.
		for (let c = 0; c < 4; c++) for (let h = 3; h < 9; h++) for (let w = 3; w < 9; w++) x[(c * 12 + h) * 14 + w] = 0;
		x[(1 * 12 + 5) * 14 + 6] = 5e-39;
		x[(2 * 12 + 6) * 14 + 5] = 1e-37;
		const graph = model([
			{ op: 'Conv', inputs: ['x', 'w'], outputs: ['out'], attributes: { pads: [1, 1, 1, 1] } }
		], { w: { dims: [6, 4, 3, 3], data: draw(6 * 4 * 9, 0.3) } }, { x: [1, 4, 12, 14] }, { out: [1, 6, 12, 14] });
		const want = await compare(graph, { x: { dims: [1, 4, 12, 14], data: x } });
		expect(subnormals(want.out.data)).toBeGreaterThan(10);
	});

	it('reproduces padded convolutions, norms and a transposed convolution over tiny inputs', async () => {
		const draw = random(11);
		const x = draw(8 * 20 * 22);
		x[5] = 1e-36;
		x[300] = 3e-39;
		const graph = model([
			{ op: 'Conv', inputs: ['x', 'w1', 'b1'], outputs: ['c1'], attributes: { pads: [1, 1, 1, 1] } },
			{ op: 'InstanceNormalization', inputs: ['c1', 'g', 'beta'], outputs: ['n1'], attributes: { epsilon: { float: 1e-5 } } },
			{ op: 'Gelu', domain: 'com.microsoft', inputs: ['n1'], outputs: ['a1'] },
			{ op: 'Conv', inputs: ['a1', 'w2'], outputs: ['c2'], attributes: { pads: [0, 2, 0, 2], strides: [1, 2] } },
			{ op: 'ConvTranspose', inputs: ['c2', 'w3', 'b3'], outputs: ['out'], attributes: { strides: [2, 2] } }
		], {
			w1: { dims: [16, 8, 3, 3], data: draw(16 * 8 * 9, 0.2) }, b1: { dims: [16], data: draw(16, 0.1) },
			g: { dims: [16], data: draw(16) }, beta: { dims: [16], data: draw(16, 0.1) },
			w2: { dims: [12, 16, 1, 3], data: draw(12 * 16 * 3, 0.2) },
			w3: { dims: [12, 6, 2, 2], data: draw(12 * 6 * 4, 0.2) }, b3: { dims: [6], data: draw(6, 0.1) }
		}, { x: [1, 8, 20, 22] }, { out: [1, 6, 40, 24] });
		await compare(graph, { x: { dims: [1, 8, 20, 22], data: x } });
	});

	it('reproduces linear layers with bias, layer norm and elementwise tails', async () => {
		const draw = random(23);
		const graph = model([
			{ op: 'Gemm', inputs: ['x', 'w', 'b'], outputs: ['h'], attributes: { transB: 1 } },
			{ op: 'LayerNormalization', inputs: ['h', 'scale', 'shift'], outputs: ['ln'], attributes: { axis: -1, epsilon: { float: 1e-5 } } },
			{ op: 'Sigmoid', inputs: ['ln'], outputs: ['s'] },
			{ op: 'Mul', inputs: ['s', 'h'], outputs: ['out'] }
		], {
			w: { dims: [96, 40], data: draw(96 * 40, 0.2) }, b: { dims: [96], data: draw(96, 0.1) },
			scale: { dims: [96], data: draw(96) }, shift: { dims: [96], data: draw(96, 0.1) }
		}, { x: [70, 40] }, { out: [70, 96] });
		await compare(graph, { x: { dims: [70, 40], data: draw(70 * 40) } });
	});
});
