import { METAL_SOURCE } from './kernels.ts';
import { convBlocks, gemmBlocks } from './mlas.ts';
import { subgraphModel, type OnnxGraph, type OnnxNode, type OnnxTensor } from './onnx.ts';

/** The native binding (packages/analysis/native/metal.mm). */
export interface MetalAddon {
	deviceName(): string | null;
	createLibrary(source: string): unknown;
	createPipeline(library: unknown, name: string): unknown;
	createBuffer(bytes: number): unknown;
	freeBuffer(buffer: unknown): void;
	writeBuffer(buffer: unknown, offset: number, data: ArrayBufferView): void;
	readBuffer(buffer: unknown, offset: number, target: ArrayBufferView): void;
	record(commands: Command[]): unknown;
	execute(recording: unknown): number;
	normStats(buffer: unknown, byteOffset: number, instances: number, size: number, stride: number, channels: number,
		epsilon: number, gamma: Float32Array, beta: Float32Array, affine: unknown): number;
	gemmRows(a: unknown, aOffset: number, b: unknown, bOffset: number, y: unknown, yOffset: number, rows: unknown,
		bias: unknown, guard: unknown, outSlot: number, dims: number[]): void;
}

/** The slice of onnxruntime-node that islands use. */
export interface OrtRuntime {
	InferenceSession: {
		create(model: Uint8Array, options: Record<string, unknown>): Promise<IslandSession>;
	};
	Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
}
interface IslandSession {
	run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>;
	release(): Promise<void>;
}

interface Command {
	pipeline: unknown;
	bindings: [unknown, number][];
	params?: Uint8Array;
	groups: number[];
	threads: number[];
	flush?: boolean;
}

const BM = 64;
const BN = 64;
/** kernels.ts ROWS_PER_THREAD. */
const ROWS_PER_THREAD = 8;
const RANK = 6;
const NO_MINIMUM = 0x7f800000;
/** Instance norm and gelu inputs must be zero or at least this (kernels.ts). */
const ELEMENTWISE_MINIMUM = 2 ** -40;

interface Storage {
	bytes: number;
	slot: number;
	buffer?: unknown;
	first: number;
	last: number;
	pinned: boolean;
	/** Padded geometry whose zero border every value sharing this storage keeps intact. */
	halo?: string;
}

/** A logical tensor: element i (row-major index tuple) lives at offset + sum(i_d * strides_d). */
interface Value {
	name: string;
	shape: number[];
	strides: number[];
	offset: number;
	storage: Storage;
}

interface Step {
	reads: Value[];
	writes: Value[];
	emit?: () => Command[];
	island?: Island;
	/** CPU work on the shared buffers between GPU segments; returns guard flags. */
	native?: () => number;
}

interface Island {
	nodes: OnnxNode[];
	inputs: Value[];
	outputs: Value[];
	hostInputs: string[];
	session?: IslandSession;
}

export class UnsupportedGraph extends Error {}

function fail(message: string): never { throw new UnsupportedGraph(message); }

function params(fields: number[], floats: Set<number> = new Set()): Uint8Array {
	const out = new ArrayBuffer(fields.length * 4);
	const ints = new Int32Array(out);
	const reals = new Float32Array(out);
	fields.forEach((v, i) => {
		if (floats.has(i)) reals[i] = v;
		else ints[i] = v;
	});
	return new Uint8Array(out);
}

const product = (dims: number[]) => dims.reduce((a, b) => a * b, 1);

function rowMajor(shape: number[]): number[] {
	const strides = new Array(shape.length).fill(1);
	for (let d = shape.length - 2; d >= 0; d--) strides[d] = strides[d + 1] * shape[d + 1];
	return strides;
}

function contiguous(v: Value): boolean {
	const s = rowMajor(v.shape);
	return v.shape.every((n, d) => n === 1 || v.strides[d] === s[d]);
}

function attr(node: OnnxNode, name: string, fallback?: number | number[] | string): any {
	const v = node.attributes.get(name);
	if (v === undefined) {
		if (fallback === undefined) fail(`${node.opType} lacks ${name}`);
		return fallback;
	}
	return v;
}

function floats(t: OnnxTensor | undefined, what: string): Float32Array {
	if (!t || !(t.data instanceof Float32Array)) fail(`${what} is not a float initializer`);
	return t.data;
}

function ints(t: OnnxTensor | undefined, what: string): number[] {
	if (!t || !(t.data instanceof BigInt64Array)) fail(`${what} is not an int64 initializer`);
	return [...t.data].map(Number);
}

/**
 * Below this an operand may break the granularity argument for a product sum with these
 * weights: with a at least 2^ea and w at least 2^ew, every product is a multiple of
 * 2^(ea + ew - 46), so ea + ew >= base keeps all partial sums on the 2^-126 grid.
 */
function tinyFor(weights: Float32Array, what: string, base = -80): number {
	return 2 ** (base - smallestExponent(weights, what));
}

/** The granularity base once products are scaled by alpha (its lowest set bit). */
function tinyBase(alpha: number): number {
	const bits = new Uint32Array(Float32Array.of(alpha).buffer)[0];
	const exponent = (bits >>> 23) & 0xff, mantissa = (bits & 0x7fffff) | (exponent ? 0x800000 : 0);
	if (!mantissa || exponent === 0xff) fail('GEMM alpha');
	const lowest = Math.log2(mantissa & -mantissa) + Math.max(exponent, 1) - 150;
	return -80 - Math.min(0, lowest);
}

/** Conv padding as [top, left, bottom, right]; a 1-D convolution pads only its width. */
function convPads(node: OnnxNode, rank: number): number[] {
	const pads = attr(node, 'pads', rank === 3 ? [0, 0] : [0, 0, 0, 0]) as number[];
	return rank === 3 ? [0, pads[0], 0, pads[1]] : pads;
}

function haloShape(shape: number[], [pt, pl, pb, pr]: number[]): number[] {
	return shape.length === 3 ? [shape[0], shape[1], shape[2] + pl + pr]
		: [shape[0], shape[1], shape[2] + pt + pb, shape[3] + pl + pr];
}

/** The offset of a padded value's first interior element. */
function haloLead(strides: number[], [pt, pl]: number[]): number {
	return strides.length === 3 ? pl * strides[2] : pt * strides[2] + pl * strides[3];
}

/** A bias added to a sum on the 2^-126 grid must lie on it too. */
function checkBias(bias: Float32Array, what: string): void {
	if (bias.some((v) => !Number.isFinite(v) || (v !== 0 && Math.abs(v) < 2 ** -103))) fail(`${what} bias range`);
}

/**
 * The smallest nonzero magnitude's bits: 0x7f800000 when the data holds a non-finite value,
 * 0x80000000 when it is all zero.
 */
function smallestBits(data: Float32Array): number {
	const bits = new Uint32Array(data.buffer, data.byteOffset, data.length);
	let least = 0x80000000, largest = 0;
	for (let i = 0; i < bits.length; i++) {
		const mag = bits[i] & 0x7fffffff;
		if (mag > largest) largest = mag;
		if (mag !== 0 && mag < least) least = mag;
	}
	return largest >= 0x7f800000 ? 0x7f800000 : least;
}

function smallestExponent(weights: Float32Array, what: string): number {
	const least = smallestBits(weights);
	if (least === 0x7f800000) fail(`${what} has a non-finite weight`);
	if (least < 0x00800000) fail(`${what} has a subnormal weight`);
	return least === 0x80000000 ? 0 : (least >>> 23) - 127;
}

/** Ops that run on the GPU; everything else runs in ONNX Runtime islands. */
const GPU_OPS = new Set([
	'ai.onnx:Reshape', 'ai.onnx:Conv', 'ai.onnx:ConvTranspose', 'ai.onnx:Transpose',
	'ai.onnx:InstanceNormalization', 'com.microsoft:Gelu', 'ai.onnx:MatMul', 'ai.onnx:Gemm',
	'com.microsoft:FusedMatMul', 'ai.onnx:Add', 'ai.onnx:Sub', 'ai.onnx:Mul', 'ai.onnx:Div',
	'ai.onnx:Sqrt', 'ai.onnx:Concat', 'ai.onnx:Split', 'ai.onnx:Slice', 'ai.onnx:Unsqueeze',
	'ai.onnx:Squeeze', 'ai.onnx:Pad', 'ai.onnx:LayerNormalization', 'ai.onnx:Sigmoid', 'ai.onnx:Softmax'
]);

const opName = (node: OnnxNode) => `${node.domain || 'ai.onnx'}:${node.opType}`;

export interface MetalPlanOptions {
	/** MLAS's maximum thread count for the CPU session being reproduced. */
	parallelism: number;
	/** The CPU session's options, which islands share. */
	cpu: Record<string, unknown>;
	ort: OrtRuntime;
	/** Ops forced into islands, for checking a GPU op against ORT. */
	islandOps?: Set<string>;
}

/**
 * A compiled graph: weights resident on the GPU, buffers planned, dispatches recorded, and
 * the ops it does not reproduce grouped into ONNX Runtime islands between GPU segments.
 */
export class MetalPlan {
	readonly inputNames: string[];
	readonly outputNames: string[];
	private addon: MetalAddon;
	private graph: OnnxGraph;
	private options: MetalPlanOptions;
	private values = new Map<string, Value>();
	private storages: Storage[] = [];
	private steps: Step[] = [];
	private consumers = new Map<string, number[]>();
	private nodeIndex = new Map<OnnxNode, number>();
	private fused = new Set<OnnxNode>();
	private pipelines = new Map<string, unknown>();
	private library: unknown;
	private guard: unknown = null;
	private weights: unknown[] = [];
	private buffers: unknown[] = [];
	private inputs: Value[] = [];
	private outputs: Value[] = [];
	private minimums: { value: Value; minimum: number }[] = [];
	private segments: ({ recording: unknown } | { island: Island; checks: unknown } | { native: () => number })[] = [];
	private checks: unknown[] = [];
	private dummy: unknown = null;
	private scratches = new Map<string, { buffer: unknown; count: number }>();

	static async create(addon: MetalAddon, graph: OnnxGraph, options: MetalPlanOptions): Promise<MetalPlan> {
		const plan = new MetalPlan(addon, graph, options);
		await plan.build();
		return plan;
	}

	private constructor(addon: MetalAddon, graph: OnnxGraph, options: MetalPlanOptions) {
		this.addon = addon;
		this.graph = graph;
		this.options = options;
		this.inputNames = graph.inputs.map((i) => i.name);
		this.outputNames = graph.outputs;
	}

	private async build(): Promise<void> {
		const { addon, graph } = this;
		this.library = addon.createLibrary(METAL_SOURCE);
		this.dummy = addon.createBuffer(16);
		this.weights.push(this.dummy);
		this.inputs = graph.inputs.map((i) => {
			if (i.dims.some((d) => d <= 0)) fail(`input ${i.name} has a dynamic shape`);
			return this.produce(i.name, i.dims);
		});
		graph.nodes.forEach((node, index) => {
			this.nodeIndex.set(node, index);
			for (const input of node.inputs) this.consumers.set(input, [...(this.consumers.get(input) ?? []), index]);
		});
		let pending: OnnxNode[] = [];
		for (const node of graph.nodes) {
			const gpu = GPU_OPS.has(opName(node)) && !this.options.islandOps?.has(opName(node))
				&& !this.fused.has(node) && this.gpuCan(node);
			if (this.fused.has(node)) continue;
			if (gpu && pending.length) {
				await this.island(pending);
				pending = [];
			}
			if (gpu) this.compile(node);
			else pending.push(node);
		}
		if (pending.length) await this.island(pending);
		this.outputs = graph.outputs.map((name) => {
			let v = this.values.get(name) ?? fail(`output ${name} is never produced`);
			if (!contiguous(v)) v = this.materialize(v, name);
			return v;
		});
		this.guard = addon.createBuffer(4 * (1 + this.storages.length));
		for (const held of this.scratches.values()) {
			held.buffer = addon.createBuffer(held.count * 4);
			this.weights.push(held.buffer);
		}
		this.allocate();
		this.record();
	}

	/** Forms of GPU ops this engine does not reproduce yet; they run in islands instead. */
	private gpuCan(node: OnnxNode): boolean {
		const op = opName(node);
		const x = this.values.get(node.inputs[0]);
		if (op === 'com.microsoft:Gelu') {
			// MLAS runs the last elements of a tensor that is not a multiple of four through a scalar erf.
			return !!x && product(x.shape) % 4 === 0;
		}
		if (op === 'ai.onnx:ConvTranspose') {
			return !!x && x.shape[0] === 1 && !node.attributes.has('output_shape') && attr(node, 'group', 1) === 1;
		}
		return true;
	}

	private pipeline(name: string): unknown {
		let p = this.pipelines.get(name);
		if (!p) {
			p = this.addon.createPipeline(this.library, name);
			this.pipelines.set(name, p);
		}
		return p;
	}

	private upload(data: ArrayBufferView): unknown {
		const buffer = this.addon.createBuffer(data.byteLength);
		this.addon.writeBuffer(buffer, 0, data);
		this.weights.push(buffer);
		return buffer;
	}

	/** A new value with its own storage, laid out in the given axis order (outermost first). */
	private produce(name: string, shape: number[], order?: number[], strided = false): Value {
		// A producer that writes through strides can write a padded convolution's input in place.
		const pads = strided ? this.haloFor(name, shape.length) : null;
		const full = pads ? haloShape(shape, pads) : shape;
		const storage: Storage = { bytes: product(full) * 4, slot: this.storages.length, first: -1, last: -1, pinned: false };
		this.storages.push(storage);
		const axes = order ?? shape.map((_, d) => d);
		const strides = new Array(shape.length).fill(0);
		let stride = 1;
		for (let i = axes.length - 1; i >= 0; i--) {
			strides[axes[i]] = stride;
			stride *= full[axes[i]];
		}
		const offset = pads ? haloLead(strides, pads) : 0;
		if (pads) storage.halo = `${full.join('x')}/${axes.join()}/${pads.join()}`;
		const v: Value = { name, shape, strides, offset, storage };
		this.values.set(name, v);
		return v;
	}

	/** The padding a value can carry: its only consumers are convolutions that pad it alike. */
	private haloFor(name: string, rank: number): number[] | null {
		if ((rank !== 3 && rank !== 4) || this.graph.outputs.includes(name)) return null;
		let pads: number[] | null = null;
		for (const user of (this.consumers.get(name) ?? []).map((i) => this.graph.nodes[i])) {
			if (opName(user) !== 'ai.onnx:Conv' || user.inputs.lastIndexOf(name) !== 0) return null;
			const own = convPads(user, rank);
			if (!own.some((v) => v > 0) || (pads && own.join() !== pads.join())) return null;
			pads = own;
		}
		return pads;
	}

	private view(name: string, from: Value, shape: number[], strides: number[], offset: number): Value {
		const v: Value = { name, shape, strides, offset, storage: from.storage };
		this.values.set(name, v);
		return v;
	}

	private input(node: OnnxNode, i: number): Value {
		return this.values.get(node.inputs[i]) ?? fail(`${node.opType} input ${node.inputs[i]} is not computed`);
	}

	private initializer(node: OnnxNode, i: number): OnnxTensor | undefined {
		return node.inputs[i] ? this.graph.initializers.get(node.inputs[i]) : undefined;
	}

	/** An initializer used as an operand, uploaded once. */
	private constant(node: OnnxNode, i: number): Value {
		const name = node.inputs[i];
		const existing = this.values.get(name);
		if (existing) return existing;
		const t = this.graph.initializers.get(name) ?? fail(`${name} is neither computed nor constant`);
		const data = floats(t, name);
		const least = smallestBits(data);
		if (least < 0x00800000 || least === 0x7f800000) fail(`${name} holds a subnormal or non-finite value`);
		const storage: Storage = { bytes: data.byteLength, slot: this.storages.length, first: -1, last: -1, pinned: true };
		this.storages.push(storage);
		storage.buffer = this.upload(data);
		const v: Value = { name, shape: t.dims, strides: rowMajor(t.dims), offset: 0, storage };
		this.values.set(name, v);
		return v;
	}

	private operand(node: OnnxNode, i: number): Value {
		return this.values.get(node.inputs[i]) ?? this.constant(node, i);
	}

	/** Conv-heavy 4-D values live row-interleaved ([H][C][W]); others row-major. */
	private orderFor(shape: number[]): number[] | undefined {
		return shape.length === 4 && shape[0] === 1 ? [0, 2, 1, 3] : undefined;
	}

	private step(reads: Value[], writes: Value[], emit: () => Command[]): void {
		this.steps.push({ reads, writes, emit });
	}

	private require(value: Value, minimum: number): void {
		this.minimums.push({ value, minimum });
	}

	private compile(node: OnnxNode): void {
		switch (opName(node)) {
			case 'ai.onnx:Reshape': return this.reshape(node);
			case 'ai.onnx:Transpose': return this.transpose(node);
			case 'ai.onnx:Split': return this.split(node);
			case 'ai.onnx:Slice': return this.slice(node);
			case 'ai.onnx:Unsqueeze': return this.unsqueeze(node);
			case 'ai.onnx:Squeeze': return this.squeeze(node);
			case 'ai.onnx:Conv': return this.conv(node);
			case 'ai.onnx:ConvTranspose': return this.convTranspose(node);
			case 'ai.onnx:InstanceNormalization': return this.instanceNorm(node);
			case 'com.microsoft:Gelu': return this.gelu(node);
			case 'ai.onnx:MatMul': return this.matmul(node, false);
			case 'com.microsoft:FusedMatMul': return this.matmul(node, true);
			case 'ai.onnx:Gemm': return this.gemm(node);
			case 'ai.onnx:Add': return this.binary(node, 3);
			case 'ai.onnx:Sub': return this.binary(node, 4);
			case 'ai.onnx:Mul': return this.binary(node, 5);
			case 'ai.onnx:Div': return this.binary(node, 6);
			case 'ai.onnx:Sqrt': return this.unary(node, 2);
			case 'ai.onnx:Sigmoid': return this.sigmoid(node);
			case 'ai.onnx:Concat': return this.concat(node);
			case 'ai.onnx:Pad': return this.pad(node);
			case 'ai.onnx:LayerNormalization': return this.layerNorm(node);
			case 'ai.onnx:Softmax': return this.softmax(node);
			default: fail(`unsupported operator ${opName(node)}`);
		}
	}

	// --- generic elementwise ------------------------------------------------------------------

	/** Pads a shape and strides to six dimensions, broadcasting missing leading ones. */
	private padded(shape: number[], strides: number[], outShape: number[]): number[] {
		const out = new Array(RANK).fill(0);
		const shift = RANK - outShape.length;
		const align = outShape.length - shape.length;
		for (let d = 0; d < shape.length; d++) out[shift + align + d] = shape[d] === 1 ? 0 : strides[d];
		return out;
	}

	private nd(op: number, a: Value, y: Value, b?: Value, extra: { affine?: unknown; lo?: number[]; instanceDims?: number } = {}): Command {
		let dims = [...new Array(RANK - y.shape.length).fill(1), ...y.shape];
		const lo = new Array(RANK).fill(0);
		const inDims = new Array(RANK).fill(1);
		if (extra.lo) {
			const shift = RANK - y.shape.length;
			extra.lo.forEach((l, d) => { lo[shift + d] = l; inDims[shift + d] = a.shape[d]; });
		}
		let sa = extra.lo ? [...new Array(RANK - a.strides.length).fill(0), ...a.strides] : this.padded(a.shape, a.strides, y.shape);
		let sb = b ? this.padded(b.shape, b.strides, y.shape) : new Array(RANK).fill(0);
		let sy = [...new Array(RANK - y.strides.length).fill(0), ...y.strides];
		// Merge neighbouring dimensions that every operand walks contiguously.
		if (op < 7) {
			const md: number[] = [], ma: number[] = [], mb: number[] = [], my: number[] = [];
			for (const d of [0, 1, 2, 3, 4, 5].filter((d) => dims[d] !== 1)) {
				const n = md.length;
				if (n > 0 && ma[n - 1] === sa[d] * dims[d] && mb[n - 1] === sb[d] * dims[d] && my[n - 1] === sy[d] * dims[d]) {
					md[n - 1] *= dims[d];
					ma[n - 1] = sa[d];
					mb[n - 1] = sb[d];
					my[n - 1] = sy[d];
				} else {
					md.push(dims[d]);
					ma.push(sa[d]);
					mb.push(sb[d]);
					my.push(sy[d]);
				}
			}
			const fill = RANK - md.length;
			dims = [...new Array(fill).fill(1), ...md];
			sa = [...new Array(fill).fill(0), ...ma];
			sb = [...new Array(fill).fill(0), ...mb];
			sy = [...new Array(fill).fill(0), ...my];
		}
		const firstOuter = [0, 1, 2, 3].find((d) => dims[d] > 1) ?? 4;
		const z = dims[0] * dims[1] * dims[2] * dims[3];
		if (z > 65535 || dims[4] > 65535 * 4) fail('elementwise grid too large');
		return {
			pipeline: this.pipeline(`nd_${op}${firstOuter >= 3 ? '_flat' : ''}`),
			bindings: [[a.storage.buffer, a.offset * 4], [(b ?? a).storage.buffer, (b ?? a).offset * 4],
				[y.storage.buffer, y.offset * 4], [extra.affine ?? this.dummy, 0], [this.guard, 0]],
			params: params([...dims, ...sa, ...sb, ...sy, op, y.storage.slot, ...lo, ...inDims,
				extra.instanceDims ?? 0, firstOuter]),
			groups: [Math.ceil(dims[5] / 32), Math.ceil(dims[4] / 4), z],
			threads: [32, 4, 1]
		};
	}

	/** A contiguous (or row-interleaved) copy of a value for consumers that need one. */
	private materialize(v: Value, name = `${v.name}#copy`, order?: number[]): Value {
		const y = this.produce(name, v.shape, order);
		this.step([v], [y], () => [this.nd(0, v, y)]);
		return y;
	}

	private broadcastShape(a: number[], b: number[]): number[] {
		const rank = Math.max(a.length, b.length);
		const out: number[] = [];
		for (let i = 0; i < rank; i++) {
			const x = a[a.length - rank + i] ?? 1, y = b[b.length - rank + i] ?? 1;
			if (x !== y && x !== 1 && y !== 1) fail('incompatible broadcast');
			out.push(Math.max(x, y));
		}
		return out;
	}

	private binary(node: OnnxNode, op: number): void {
		const a = this.operand(node, 0);
		const b = this.operand(node, 1);
		// Elementwise kernels would read a subnormal operand as zero.
		this.require(a, 2 ** -126);
		this.require(b, 2 ** -126);
		const shape = this.broadcastShape(a.shape, b.shape);
		if (shape.length > RANK) fail('rank above six');
		const y = this.produce(node.outputs[0], shape, this.orderFor(shape), true);
		this.step([a, b], [y], () => [this.nd(op, a, y, b)]);
	}

	private unary(node: OnnxNode, op: number): void {
		const a = this.input(node, 0);
		this.require(a, 2 ** -126);
		const y = this.produce(node.outputs[0], a.shape, this.orderFor(a.shape), true);
		this.step([a], [y], () => [this.nd(op, a, y)]);
	}

	/** The logistic's final + 0.5 absorbs a flushed operand, so it needs no range condition. */
	private sigmoid(node: OnnxNode): void {
		const a = this.input(node, 0);
		const y = this.produce(node.outputs[0], a.shape, this.orderFor(a.shape), true);
		this.step([a], [y], () => [this.nd(10, a, y)]);
	}

	private gelu(node: OnnxNode): void {
		const a = this.input(node, 0);
		this.require(a, ELEMENTWISE_MINIMUM);
		const y = this.produce(node.outputs[0], a.shape, this.orderFor(a.shape), true);
		this.step([a], [y], () => [this.nd(1, a, y)]);
	}

	// --- views ---------------------------------------------------------------------------------

	private reshape(node: OnnxNode): void {
		let x = this.input(node, 0);
		if (attr(node, 'allowzero', 0) !== 0) fail('Reshape allowzero');
		const dims = ints(this.initializer(node, 1), 'Reshape shape');
		const known = dims.reduce((a, d, i) => a * (d === -1 ? 1 : d === 0 ? x.shape[i] : d), 1);
		const shape = dims.map((d, i) => (d === -1 ? product(x.shape) / known : d === 0 ? x.shape[i] : d));
		if (product(shape) !== product(x.shape)) fail('Reshape changes the element count');
		if (!contiguous(x)) x = this.materialize(x);
		this.view(node.outputs[0], x, shape, rowMajor(shape), x.offset);
	}

	private transpose(node: OnnxNode): void {
		const x = this.input(node, 0);
		const perm = attr(node, 'perm', x.shape.map((_, d) => x.shape.length - 1 - d)) as number[];
		this.view(node.outputs[0], x, perm.map((d) => x.shape[d]), perm.map((d) => x.strides[d]), x.offset);
	}

	private split(node: OnnxNode): void {
		const x = this.input(node, 0);
		const axis = (attr(node, 'axis', 0) as number + x.shape.length) % x.shape.length;
		const sizes = node.inputs[1] ? ints(this.initializer(node, 1), 'Split sizes')
			: (attr(node, 'split', []) as number[]);
		const parts = sizes.length ? sizes : new Array(node.outputs.length).fill(x.shape[axis] / node.outputs.length);
		let start = 0;
		node.outputs.forEach((name, i) => {
			const shape = [...x.shape];
			shape[axis] = parts[i];
			this.view(name, x, shape, x.strides, x.offset + start * x.strides[axis]);
			start += parts[i];
		});
	}

	private slice(node: OnnxNode): void {
		const x = this.input(node, 0);
		const starts = ints(this.initializer(node, 1), 'Slice starts');
		const ends = ints(this.initializer(node, 2), 'Slice ends');
		const axes = node.inputs[3] ? ints(this.initializer(node, 3), 'Slice axes') : starts.map((_, i) => i);
		const steps = node.inputs[4] ? ints(this.initializer(node, 4), 'Slice steps') : starts.map(() => 1);
		const shape = [...x.shape], strides = [...x.strides];
		let offset = x.offset;
		axes.forEach((rawAxis, i) => {
			const axis = (rawAxis + x.shape.length) % x.shape.length;
			const n = x.shape[axis];
			if (steps[i] !== 1) fail('strided Slice');
			const clamp = (v: number) => Math.min(n, Math.max(0, v < 0 ? v + n : v));
			const s = clamp(starts[i]), e = clamp(ends[i]);
			shape[axis] = Math.max(0, e - s);
			offset += s * strides[axis];
		});
		this.view(node.outputs[0], x, shape, strides, offset);
	}

	private unsqueeze(node: OnnxNode): void {
		const x = this.input(node, 0);
		const axes = node.inputs[1] ? ints(this.initializer(node, 1), 'Unsqueeze axes') : attr(node, 'axes') as number[];
		const rank = x.shape.length + axes.length;
		const at = new Set(axes.map((a) => (a + rank) % rank));
		const shape: number[] = [], strides: number[] = [];
		let src = 0;
		for (let d = 0; d < rank; d++) {
			if (at.has(d)) { shape.push(1); strides.push(0); }
			else { shape.push(x.shape[src]); strides.push(x.strides[src]); src++; }
		}
		this.view(node.outputs[0], x, shape, strides, x.offset);
	}

	private squeeze(node: OnnxNode): void {
		const x = this.input(node, 0);
		const axes = node.inputs[1] ? ints(this.initializer(node, 1), 'Squeeze axes')
			: (attr(node, 'axes', x.shape.map((n, d) => (n === 1 ? d : -1)).filter((d) => d >= 0)) as number[]);
		const drop = new Set(axes.map((a) => (a + x.shape.length) % x.shape.length));
		this.view(node.outputs[0], x, x.shape.filter((_, d) => !drop.has(d)), x.strides.filter((_, d) => !drop.has(d)), x.offset);
	}

	private concat(node: OnnxNode): void {
		const parts = node.inputs.map((_, i) => this.operand(node, i));
		const rank = parts[0].shape.length;
		const axis = ((attr(node, 'axis') as number) + rank) % rank;
		const shape = [...parts[0].shape];
		shape[axis] = parts.reduce((a, p) => a + p.shape[axis], 0);
		const y = this.produce(node.outputs[0], shape, this.orderFor(shape), true);
		this.step(parts, [y], () => {
			let at = 0;
			return parts.map((p) => {
				const target: Value = { ...y, shape: p.shape, offset: y.offset + at * y.strides[axis] };
				at += p.shape[axis];
				return this.nd(0, p, target);
			});
		});
	}

	private pad(node: OnnxNode): void {
		const x = this.input(node, 0);
		if (attr(node, 'mode', 'constant') !== 'constant') fail('non-constant Pad');
		if (node.inputs[2]) fail('Pad with a fill value');
		const pads = ints(this.initializer(node, 1), 'Pad pads');
		const rank = x.shape.length;
		if (pads.some((p) => p < 0)) fail('negative Pad');
		const shape = x.shape.map((n, d) => n + pads[d] + pads[d + rank]);
		const y = this.produce(node.outputs[0], shape, this.orderFor(shape), true);
		this.step([x], [y], () => [this.nd(9, x, y, undefined, { lo: pads.slice(0, rank) })]);
	}

	// --- product sums -------------------------------------------------------------------------

	/** Implicit-GEMM convolution, mode 0, or a stride-sized transposed one, mode 1. */
	private convSteps(x: Value, y: Value, opts: {
		weights: Float32Array; rows: number; outRows: number; K: number; ktab: Int32Array;
		blocks: { start: number; end: number; kBlock: number }[];
		geometry: number[]; mode: number; kh: number; kw: number; tiny: number; bias?: Float32Array; batch: number;
	}): void {
		const { rows, outRows, K, blocks, geometry, mode, kh, kw, tiny, batch } = opts;
		const K8 = Math.ceil(K / 8) * 8;
		const wbuf = this.upload(opts.weights);
		const kbuf = this.upload(opts.ktab);
		const bbuf = opts.bias ? this.upload(opts.bias) : this.dummy;
		const [cin, h, wd, ho, wo, sh, sw] = geometry;
		const rank = x.shape.length;
		// x is [N, C, (H,) W]; the 1-D case has a height of one.
		const isn = x.strides[0], isc = x.strides[1], ish = rank === 4 ? x.strides[2] : 0;
		const osn = y.strides[0], osc = y.strides[1], osh = y.shape.length === 4 ? y.strides[2] : 0;
		this.step([x], [y], () => blocks.flatMap(({ start, end, kBlock }) => {
			const p = params([cin, h, wd, rows, ho, wo, sh, sw, K8, kBlock >= K ? K8 : kBlock, start, end,
				isc, ish, osc, osh, mode, kh, kw, outRows, x.storage.slot, y.storage.slot, tiny,
				isn, osn, opts.bias ? 1 : 0], new Set([22]));
			return [{
				pipeline: this.pipeline(`conv${mode === 1 ? '_scatter' : ''}${opts.bias ? '_bias' : ''}`),
				bindings: [[x.storage.buffer, x.offset * 4], [wbuf, 0], [y.storage.buffer, y.offset * 4], [kbuf, 0],
					[this.guard, 0], [bbuf, 0]],
				params: p,
				groups: [Math.ceil((end - start) / BN), rows / BM, batch],
				threads: [128, 1, 1]
			}, {
				pipeline: this.pipeline('conv_correct'),
				bindings: [[x.storage.buffer, x.offset * 4], [wbuf, 0], [kbuf, 0], [this.guard, 0],
					[y.storage.buffer, y.offset * 4], [bbuf, 0]],
				params: p,
				groups: [Math.ceil((end - start) / 64), batch, 1],
				threads: [64, 1, 1]
			}] as Command[];
		}));
	}

	/** Conv inputs need a unit width stride; anything else is copied first. */
	private convInput(x: Value): Value {
		return x.strides[x.strides.length - 1] === 1 ? x : this.materialize(x, undefined, this.orderFor(x.shape));
	}

	private conv(node: OnnxNode): void {
		let x = this.convInput(this.input(node, 0));
		const w = this.initializer(node, 1);
		const weights = floats(w, 'Conv weight');
		if (attr(node, 'group', 1) !== 1) fail('grouped Conv');
		if (attr(node, 'auto_pad', 'NOTSET') !== 'NOTSET') fail('Conv auto_pad');
		const oneD = x.shape.length === 3;
		if (!oneD && x.shape.length !== 4) fail('Conv rank');
		const [batch, cin] = x.shape;
		const h = oneD ? 1 : x.shape[2], wd = x.shape[x.shape.length - 1];
		const [cout, wcin] = w!.dims;
		const kh = oneD ? 1 : w!.dims[2], kw = w!.dims[w!.dims.length - 1];
		if (wcin !== cin) fail('Conv channel mismatch');
		const strides = attr(node, 'strides', oneD ? [1] : [1, 1]) as number[];
		const dil = attr(node, 'dilations', oneD ? [1] : [1, 1]) as number[];
		const pads = attr(node, 'pads', oneD ? [0, 0] : [0, 0, 0, 0]) as number[];
		const [sh, sw] = oneD ? [1, strides[0]] : strides;
		const [dh, dw] = oneD ? [1, dil[0]] : dil;
		const [pt, pl, pb, pr] = oneD ? [0, pads[0], 0, pads[1]] : pads;
		const ho = Math.floor((h + pt + pb - (dh * (kh - 1) + 1)) / sh) + 1;
		const wo = Math.floor((wd + pl + pr - (dw * (kw - 1) + 1)) / sw) + 1;
		if (pt + pl + pb + pr > 0) {
			// The kernel reads windows without bounds checks, so the zero border must exist: built
			// into the input's storage by its producer, or copied here.
			const pads = [pt, pl, pb, pr];
			const shape = haloShape(x.shape, pads);
			const lead = haloLead(x.strides, pads);
			if (x.storage.halo?.endsWith(`/${pads.join()}`) && x.storage.halo.startsWith(`${shape.join('x')}/`) && x.offset === lead) {
				x = { ...x, name: `${x.name}#halo`, shape, offset: 0 };
			} else {
				const source = x;
				const halo = this.produce(`${node.outputs[0]}#halo`, shape, this.orderFor(shape));
				this.step([source], [halo], () => [this.nd(9, source, halo, undefined, { lo: oneD ? [0, 0, pl] : [0, 0, pt, pl] })]);
				x = halo;
			}
		}
		const bias = this.initializer(node, 2) ? floats(this.initializer(node, 2), 'Conv bias') : undefined;
		if (bias) checkBias(bias, 'Conv');
		const tiny = tinyFor(weights, 'Conv');
		const outShape = oneD ? [batch, cout, wo] : [batch, cout, ho, wo];
		const y = this.produce(node.outputs[0], outShape, this.orderFor(outShape), true);
		const K = cin * kh * kw;
		const K8 = Math.ceil(K / 8) * 8;
		const rows = Math.ceil(cout / BM) * BM;
		const padded = new Float32Array(rows * K8);
		for (let m = 0; m < cout; m++) padded.set(weights.subarray(m * K, (m + 1) * K), m * K8);
		const blocks = convBlocks(cout, ho * wo, K, cin, this.options.parallelism, {
			stridesOne: sh === 1 && sw === 1, paddingZero: pt === 0 && pl === 0 && pb === 0 && pr === 0, batch
		});
		const isc = x.strides[1], ish = oneD ? 0 : x.strides[2];
		const ktab = new Int32Array((K8 + 8) * 4);
		for (let k = 0; k < K8 + 8; k++) {
			if (k < K) {
				const ci = Math.floor(k / (kh * kw)), r = k % (kh * kw);
				const oy = Math.floor(r / kw) * dh, ox = (r % kw) * dw;
				ktab.set([ci * isc + oy * ish + ox, oy, ox, 0], k * 4);
			} else ktab.set([0, 1 << 20, 0, 0], k * 4);
		}
		this.convSteps(x, y, { weights: padded, rows, outRows: cout, K, ktab, blocks,
			geometry: [cin, h + pt + pb, wd + pl + pr, ho, wo, sh, sw], mode: 0, kh: 1, kw: 1, tiny, bias, batch });
	}

	private convTranspose(node: OnnxNode): void {
		const x = this.convInput(this.input(node, 0));
		const w = this.initializer(node, 1);
		const weights = floats(w, 'ConvTranspose weight');
		if (attr(node, 'group', 1) !== 1) fail('grouped ConvTranspose');
		const oneD = x.shape.length === 3;
		const [batch, cin] = x.shape;
		const h = oneD ? 1 : x.shape[2], wd = x.shape[x.shape.length - 1];
		const [wcin, cout] = w!.dims;
		const kh = oneD ? 1 : w!.dims[2], kw = w!.dims[w!.dims.length - 1];
		if (wcin !== cin) fail('ConvTranspose channel mismatch');
		const strides = attr(node, 'strides', oneD ? [1] : [1, 1]) as number[];
		const [sh, sw] = oneD ? [1, strides[0]] : strides;
		const dils = attr(node, 'dilations', oneD ? [1] : [1, 1]) as number[];
		const [dh, dw] = oneD ? [1, dils[0]] : dils;
		const pads = attr(node, 'pads', oneD ? [0, 0] : [0, 0, 0, 0]) as number[];
		const [pt, pl, pb, pr] = oneD ? [0, pads[0], 0, pads[1]] : pads;
		const extra = attr(node, 'output_padding', oneD ? [0] : [0, 0]) as number[];
		const [eh, ew] = oneD ? [0, extra[0]] : extra;
		const bias = this.initializer(node, 2) ? floats(this.initializer(node, 2), 'ConvTranspose bias') : undefined;
		if (bias) checkBias(bias, 'ConvTranspose');
		const tiny = tinyFor(weights, 'ConvTranspose');
		const ho = (h - 1) * sh - pt - pb + dh * (kh - 1) + 1 + eh;
		const wo = (wd - 1) * sw - pl - pr + dw * (kw - 1) + 1 + ew;
		const outShape = oneD ? [batch, cout, wo] : [batch, cout, ho, wo];
		const y = this.produce(node.outputs[0], outShape, this.orderFor(outShape), true);
		if (batch !== 1) fail('batched ConvTranspose');
		// ORT prepacks the filter as its transpose: rows (co, kh, kw), columns ci.
		const M = cout * kh * kw;
		const K = cin;
		const K8 = Math.ceil(K / 8) * 8;
		const rows = Math.ceil(M / BM) * BM;
		const packed = new Float32Array(rows * K8);
		for (let ci = 0; ci < cin; ci++) for (let m = 0; m < M; m++) packed[m * K8 + ci] = weights[ci * M + m];
		const blocks = gemmBlocks(M, h * wd, K, this.options.parallelism);
		if (sh === kh && sw === kw && dh === 1 && dw === 1 && pt + pl + pb + pr + eh + ew === 0) {
			// Each output receives one product sum, added to zero, which leaves it unchanged (never -0).
			const ktab = new Int32Array((K8 + 8) * 4);
			for (let k = 0; k < K8 + 8; k++) ktab.set(k < K ? [k * x.strides[1], 0, 0, 0] : [0, 1 << 20, 0, 0], k * 4);
			this.convSteps(x, y, { weights: packed, rows, outRows: M, K, ktab, blocks, geometry: [cin, h, wd, h, wd, 1, 1],
				mode: 1, kh, kw, tiny, bias, batch });
			return;
		}
		// Overlapping windows: the GEMM into a column buffer, then col2im's ordered sums.
		const xr = oneD || x.strides[2] === wd ? x : this.materialize(x);
		const ktab = new Int32Array((K8 + 8) * 4);
		for (let k = 0; k < K8 + 8; k++) ktab.set(k < K ? [k * xr.strides[1], 0, 0, 0] : [0, 1 << 20, 0, 0], k * 4);
		const col = this.produce(`${node.outputs[0]}#col`, [1, M, h, wd]);
		const col3: Value = { ...col, shape: [1, M, h * wd], strides: [M * h * wd, h * wd, 1] };
		const x3: Value = oneD ? xr : { ...xr, shape: [1, cin, h * wd], strides: [xr.strides[0], xr.strides[1], 1] };
		this.convSteps(x3, col3, { weights: packed, rows, outRows: M, K, ktab, blocks, geometry: [cin, 1, h * wd, 1, h * wd, 1, 1],
			mode: 0, kh: 1, kw: 1, tiny, batch });
		const bbuf = bias ? this.upload(bias) : this.dummy;
		const osc = y.strides[1], osh = oneD ? 0 : y.strides[2];
		this.step([col], [y], () => [{
			pipeline: this.pipeline('col2im'),
			bindings: [[col.storage.buffer, col.offset * 4], [y.storage.buffer, y.offset * 4], [bbuf, 0], [this.guard, 0]],
			params: params([cout, h, wd, ho, wo, kh, kw, sh, sw, dh, dw, pt, pl, osc, osh, bias ? 1 : 0, y.storage.slot]),
			groups: [Math.ceil(wo / 32), Math.ceil(ho / 4), cout],
			threads: [32, 4, 1]
		}]);
	}

	/**
	 * A 2-D view as the kernel reads it: a leading dimension, and whether it is stored
	 * transposed relative to its logical shape. Null when neither axis is contiguous.
	 */
	private matrix(v: Value): { ld: number; columnMajor: boolean } | null {
		const r = v.strides.length;
		const [rows, cols] = v.shape.slice(r - 2), [outer, inner] = v.strides.slice(r - 2);
		if (inner === 1 || cols === 1) return { ld: cols === 1 && inner !== 1 ? 1 : outer, columnMajor: false };
		if (outer === 1 || rows === 1) return { ld: inner, columnMajor: true };
		return null;
	}

	/** Scratch that GEMMs share, since steps run in order; sized while planning. */
	private reserve(name: string, count: number): void {
		this.scratches.set(name, { buffer: null, count: Math.max(count, this.scratches.get(name)?.count ?? 0) });
	}

	private scratch(name: string): unknown {
		return this.scratches.get(name)?.buffer ?? fail(`scratch ${name} was not reserved`);
	}

	/**
	 * One MLAS GEMM per batch entry over 2-D views; transA/transB are the logical flags. A
	 * computed B sets A's operand thresholds at run time; a constant one passes aTiny.
	 */
	private gemmStep(a: Value, b: Value, y: Value, o: {
		M: number; N: number; K: number; transA: boolean; transB: boolean; alpha: number; accumulate: boolean;
		batch: number; batchA: number; batchB: number; batchC: number; kBlock: number; aTiny: number;
		bActivation: boolean; bias?: Value; nativeCorrection?: boolean;
	}): Command[] {
		const ma = this.matrix(a) ?? fail('A has no contiguous axis');
		const mb = this.matrix(b) ?? fail('B has no contiguous axis');
		const my = this.matrix(y);
		if (!my || my.columnMajor) fail('GEMM output must be row-major');
		const p = params([o.M, o.N, o.K, o.kBlock >= o.K ? o.K : o.kBlock, ma.ld, mb.ld, my.ld,
			o.transA !== ma.columnMajor ? 1 : 0, o.transB !== mb.columnMajor ? 1 : 0, o.accumulate ? 1 : 0, o.alpha,
			o.batchA, o.batchB, o.batchC,
			a.storage.slot, o.bActivation ? b.storage.slot : -1, y.storage.slot, o.aTiny, tinyBase(o.alpha)],
		new Set([10, 17]));
		const flags = this.scratch('rows');
		const tiny = o.bActivation ? this.scratch('tiny') : this.dummy;
		const ab: [unknown, number][] = [[a.storage.buffer, a.offset * 4], [b.storage.buffer, b.offset * 4]];
		return [{
			pipeline: this.pipeline('gemm'),
			bindings: [...ab, [y.storage.buffer, y.offset * 4], [this.guard, 0]],
			params: p,
			groups: [Math.ceil(o.N / BN), Math.ceil(o.M / BM), o.batch],
			threads: [128, 1, 1]
		}, ...(o.bActivation ? [{
			pipeline: this.pipeline('gemm_kmin'),
			bindings: [ab[1], [this.guard, 0], [tiny, 0]] as [unknown, number][],
			params: p,
			groups: [Math.ceil(o.K / 64), o.batch, 1],
			threads: [64, 1, 1]
		}] : []), {
			pipeline: this.pipeline('gemm_mark'),
			bindings: [ab[0], [this.guard, 0], [flags, 0], [tiny, 0]],
			params: p,
			groups: [Math.ceil(o.M / 8), o.batch, 1],
			threads: [256, 1, 1]
		}, ...(o.nativeCorrection ? [] : [{
			pipeline: this.pipeline('gemm_correct'),
			bindings: [...ab, [y.storage.buffer, y.offset * 4], [this.guard, 0],
				[o.bias ? o.bias.storage.buffer : this.dummy, 0], [flags, 0]] as [unknown, number][],
			params: p,
			groups: [Math.ceil(o.N / 32), Math.ceil(o.M / ROWS_PER_THREAD), o.batch],
			threads: [32, 1, 1]
		}])];
	}

	private matmul(node: OnnxNode, fusedAttributes: boolean): void {
		const alpha = fusedAttributes ? attr(node, 'alpha', 1) as number : 1;
		const transA = fusedAttributes && attr(node, 'transA', 0) === 1;
		const transB = fusedAttributes && attr(node, 'transB', 0) === 1;
		const batchA = fusedAttributes && attr(node, 'transBatchA', 0) === 1;
		const batchB = fusedAttributes && attr(node, 'transBatchB', 0) === 1;
		const constantB = this.initializer(node, 1);
		let a = this.input(node, 0);
		if (constantB) {
			// A constant 2-D B is prepacked; packed GEMMs block K by 256 at any thread count.
			if (transA || batchA || batchB || constantB.dims.length !== 2) fail('MatMul against a constant');
			const weights = floats(constantB, 'MatMul weight');
			const [K, N] = transB ? [constantB.dims[1], constantB.dims[0]] : constantB.dims;
			if (a.shape[a.shape.length - 1] !== K) fail('MatMul dimensions');
			if (!contiguous(a)) a = this.materialize(a);
			const M = product(a.shape) / K;
			const outShape = [...a.shape.slice(0, -1), N];
			const y = this.produce(node.outputs[0], outShape);
			const b = this.constant(node, 1);
			const a2: Value = { ...a, shape: [M, K], strides: [K, 1] };
			const b2: Value = { ...b, shape: transB ? [N, K] : [K, N], strides: transB ? [K, 1] : [N, 1] };
			const y2: Value = { ...y, shape: [M, N], strides: [N, 1] };
			const [{ kBlock }] = gemmBlocks(M, N, K, this.options.parallelism, { packedB: true });
			const tiny = tinyFor(weights, 'MatMul', tinyBase(alpha));
			this.reserve('rows', M);
			this.step([a], [y], () => this.gemmStep(a2, b2, y2, { M, N, K, transA: false, transB, alpha, accumulate: false,
				batch: 1, batchA: 0, batchB: 0, batchC: 0, kBlock, aTiny: tiny, bActivation: false }));
			return;
		}
		// Batched product of two computed values: [batch, M, K] x [batch, K, N], or the transBatch
		// forms [M, batch, K] / [K, batch, N] that FusedMatMul reads with strides.
		let b = this.input(node, 1);
		if (a.shape.length !== 3 || b.shape.length !== 3) fail('MatMul rank');
		const move = (v: Value, trans: boolean): Value => trans
			? { ...v, shape: [v.shape[1], v.shape[0], v.shape[2]], strides: [v.strides[1], v.strides[0], v.strides[2]] }
			: v;
		const twoD = (v: Value): Value => ({ ...v, shape: v.shape.slice(1), strides: v.strides.slice(1) });
		a = move(a, batchA);
		b = move(b, batchB);
		if (!this.matrix(twoD(a))) a = this.materialize(a);
		if (!this.matrix(twoD(b))) b = this.materialize(b);
		const batch = a.shape[0];
		if (b.shape[0] !== batch) fail('MatMul batch broadcast');
		const M = transA ? a.shape[2] : a.shape[1], K = transA ? a.shape[1] : a.shape[2];
		const N = transB ? b.shape[1] : b.shape[2];
		if ((transB ? b.shape[2] : b.shape[1]) !== K) fail('MatMul dimensions');
		const y = this.produce(node.outputs[0], [batch, M, N]);
		const [{ kBlock }] = gemmBlocks(M, N, K, this.options.parallelism, { transA, batch });
		this.reserve('rows', M * batch);
		this.reserve('tiny', K * batch);
		// Attention probabilities can be subnormal by the thousand, which the GPU only emulates;
		// marked rows of a plain row-major product are replayed natively instead.
		const ma = this.matrix(twoD(a))!, mb = this.matrix(twoD(b))!;
		const native = transA === ma.columnMajor && transB === mb.columnMajor;
		this.step([a, b], [y], () => this.gemmStep(twoD(a), twoD(b), twoD(y), { M, N, K, transA, transB, alpha,
			accumulate: false, batch, batchA: a.strides[0], batchB: b.strides[0], batchC: y.strides[0], kBlock,
			aTiny: 0, bActivation: true, nativeCorrection: native }));
		if (!native) return;
		this.steps.push({ reads: [a, b, y], writes: [y], native: () => {
			this.addon.gemmRows(a.storage.buffer, a.offset * 4, b.storage.buffer, b.offset * 4, y.storage.buffer,
				y.offset * 4, this.scratch('rows'), null, this.guard, y.storage.slot,
				[M, N, K, Math.min(kBlock, K), ma.ld, mb.ld, N, batch, a.strides[0], b.strides[0], y.strides[0], alpha]);
			return 0;
		} });
	}

	private gemm(node: OnnxNode): void {
		const transA = attr(node, 'transA', 0) === 1, transB = attr(node, 'transB', 0) === 1;
		const alpha = attr(node, 'alpha', 1) as number, beta = attr(node, 'beta', 1) as number;
		const bt = this.initializer(node, 1);
		const weights = floats(bt, 'Gemm weight');
		if (transA || beta !== 1 || alpha !== 1) fail('Gemm form');
		let a = this.input(node, 0);
		if (!contiguous(a) || a.shape.length !== 2) a = this.materialize(a);
		const [M, K] = a.shape;
		const N = transB ? bt!.dims[0] : bt!.dims[1];
		const y = this.produce(node.outputs[0], [M, N]);
		const b = this.constant(node, 1);
		const b2: Value = { ...b, shape: transB ? [N, K] : [K, N], strides: transB ? [K, 1] : [N, 1] };
		const c = this.initializer(node, 2);
		const bias = c ? floats(c, 'Gemm bias') : null;
		if (bias && !(c!.dims.length === 1 && c!.dims[0] === N)) fail('Gemm bias shape');
		if (bias) checkBias(bias, 'Gemm');
		const tiny = tinyFor(weights, 'Gemm');
		const [{ kBlock }] = gemmBlocks(M, N, K, this.options.parallelism, { packedB: true });
		this.reserve('rows', M);
		const biasValue = bias ? this.constant(node, 2) : null;
		this.step([a], [y], () => [
			// ORT copies the broadcast bias into Y, then MLAS fuses every block onto it.
			...(biasValue ? [this.nd(0, { ...biasValue, shape: [1, N], strides: [0, 1] }, y)] : []),
			...this.gemmStep(a, b2, y, { M, N, K, transA: false, transB, alpha, accumulate: !!biasValue, batch: 1,
				batchA: 0, batchB: 0, batchC: 0, kBlock, aTiny: tiny, bActivation: false, bias: biasValue ?? undefined })
		]);
	}

	// --- normalization --------------------------------------------------------------------------

	private instanceNorm(node: OnnxNode): void {
		let x = this.input(node, 0);
		const rank = x.shape.length;
		if (rank < 3) fail('InstanceNormalization rank');
		const [N, C] = x.shape;
		const S = product(x.shape.slice(2));
		const gamma = floats(this.initializer(node, 1), 'InstanceNormalization scale');
		const beta = floats(this.initializer(node, 2), 'InstanceNormalization bias');
		for (const v of [...gamma, ...beta]) {
			if (!Number.isFinite(v) || (v !== 0 && Math.abs(v) < ELEMENTWISE_MINIMUM)) fail('InstanceNormalization parameter range');
		}
		this.require(x, ELEMENTWISE_MINIMUM);
		const epsilon = attr(node, 'epsilon', 1e-5) as number;
		// The reduction walks each instance as [H][W] rows: the last dimension is W, the rest H.
		const W = x.shape[rank - 1];
		const rows = (v: Value) => v.shape.slice(2, -1).every((_, i, all) => i === all.length - 1
			|| v.strides[2 + i] === v.strides[3 + i] * v.shape[3 + i]);
		if (x.strides[rank - 1] !== 1 || !rows(x) || (rank > 3 && N !== 1)) x = this.materialize(x);
		const sc = x.strides[1], sh = rank > 3 ? x.strides[rank - 2] : 0;
		const g = this.upload(gamma), b = this.upload(beta);
		const affine = this.addon.createBuffer(N * C * 8);
		this.weights.push(affine);
		// A Gelu that is the only consumer is applied in the same pass, with identical arithmetic.
		const users = this.consumers.get(node.outputs[0]) ?? [];
		const user = users.length === 1 ? this.graph.nodes[users[0]] : null;
		const fuse = !!user && opName(user) === 'com.microsoft:Gelu' && !this.graph.outputs.includes(node.outputs[0])
			&& (N * C * S) % 4 === 0 && !this.options.islandOps?.has('com.microsoft:Gelu');
		const outName = fuse ? user!.outputs[0] : node.outputs[0];
		const y = this.produce(outName, x.shape, this.orderFor(x.shape), true);
		if (fuse) this.fused.add(user!);
		const instances = N * C;
		// Batches of single-channel instances are contiguous and walk with the instance stride.
		const instanceStride = N > 1 ? x.strides[0] : sc;
		// A few large contiguous instances are eight sequential add chains each, which a CPU core
		// runs far faster than one GPU thread; their statistics are computed natively.
		if (sh === 0 && S >= 1 << 16 && instances <= 64) {
			this.steps.push({ reads: [x], writes: [], native: () => this.addon.normStats(x.storage.buffer, x.offset * 4,
				instances, S, instanceStride, C, epsilon, gamma, beta, affine) });
			this.step([x], [y], () => [this.nd(fuse ? 8 : 7, x, y, undefined, { affine, instanceDims: RANK - rank + 2 })]);
			return;
		}
		this.step([x], [y], () => [{
			pipeline: this.pipeline('norm_stats'),
			bindings: [[x.storage.buffer, x.offset * 4], [g, 0], [b, 0], [affine, 0], [this.guard, 0]],
			params: params([instances, S, W, instanceStride, sh, C, epsilon], new Set([6])),
			groups: [Math.ceil((instances * 8) / 256), 1, 1],
			threads: [256, 1, 1]
		}, this.nd(fuse ? 8 : 7, x, y, undefined, { affine, instanceDims: RANK - rank + 2 })]);
	}

	private layerNorm(node: OnnxNode): void {
		let x = this.input(node, 0);
		const rank = x.shape.length;
		if (((attr(node, 'axis', -1) as number) + rank) % rank !== rank - 1) fail('LayerNormalization off the last axis');
		if (attr(node, 'stash_type', 1) !== 1) fail('LayerNormalization stash type');
		const size = x.shape[rank - 1];
		const scale = floats(this.initializer(node, 1), 'LayerNormalization scale');
		const bias = this.initializer(node, 2) ? floats(this.initializer(node, 2), 'LayerNormalization bias') : null;
		if (scale.length !== size || (bias && bias.length !== size)) fail('LayerNormalization broadcast');
		if (node.outputs.slice(1).some((o) => o && this.consumers.has(o))) fail('LayerNormalization statistics outputs');
		if (!contiguous(x)) x = this.materialize(x);
		this.require(x, 2 ** -126);
		const y = this.produce(node.outputs[0], x.shape);
		const rows = product(x.shape) / size;
		const sbuf = this.upload(scale), bbuf = bias ? this.upload(bias) : this.dummy;
		this.step([x], [y], () => [{
			pipeline: this.pipeline('layer_norm'),
			bindings: [[x.storage.buffer, x.offset * 4], [y.storage.buffer, y.offset * 4], [sbuf, 0], [bbuf, 0], [this.guard, 0]],
			params: params([rows, size, bias ? 1 : 0, attr(node, 'epsilon', 1e-5) as number, y.storage.slot], new Set([3])),
			groups: [Math.ceil(rows / 64), 1, 1],
			threads: [64, 1, 1]
		}]);
	}

	private softmax(node: OnnxNode): void {
		let x = this.input(node, 0);
		const rank = x.shape.length;
		// Explicit, because opsets before 13 default to axis 1.
		if (!node.attributes.has('axis') || ((attr(node, 'axis', -1) as number) + rank) % rank !== rank - 1) {
			fail('Softmax off the last axis');
		}
		if (!contiguous(x)) x = this.materialize(x);
		// The maximum and the subtraction read operands the GPU would flush.
		this.require(x, 2 ** -126);
		const y = this.produce(node.outputs[0], x.shape);
		const n = x.shape[rank - 1], rows = product(x.shape) / n;
		this.step([x], [y], () => [{
			pipeline: this.pipeline('softmax'),
			bindings: [[x.storage.buffer, x.offset * 4], [y.storage.buffer, y.offset * 4], [this.guard, 0]],
			params: params([rows, n, y.storage.slot]),
			groups: [Math.ceil((rows * 4) / 256), 1, 1],
			threads: [256, 1, 1]
		}]);
	}

	// --- islands --------------------------------------------------------------------------------

	/**
	 * Nodes that run in ONNX Runtime between GPU segments. Their GPU inputs are made contiguous,
	 * read back, run, and the outputs written to fresh GPU values that later nodes read.
	 */
	private island(nodes: OnnxNode[]): Promise<void> {
		const produced = new Set(nodes.flatMap((n) => n.outputs));
		const last = Math.max(...nodes.map((n) => this.nodeIndex.get(n)!));
		const external = [...new Set(nodes.flatMap((n) => n.inputs))]
			.filter((name) => name && !produced.has(name) && !this.graph.initializers.has(name));
		const hostInputs = external.filter((name) => this.inputNames.includes(name));
		const inputs = external.filter((name) => !this.inputNames.includes(name)).map((name) => {
			const v = this.values.get(name) ?? fail(`island input ${name} is not computed`);
			return contiguous(v) ? v : this.materialize(v, `${name}#island`);
		});
		const outputNames = nodes.flatMap((n) => n.outputs).filter((name) => name
			&& ((this.consumers.get(name) ?? []).some((i) => i > last) || this.graph.outputs.includes(name)));
		const island: Island = { nodes, inputs, outputs: [], hostInputs };
		this.steps.push({ reads: inputs, writes: [], island });
		const ready = (async () => {
			const graphInputs = [...inputs.map((v) => ({ name: v.name.replace(/#island$/, ''), dims: v.shape })),
				...hostInputs.map((name) => ({ name, dims: this.graph.inputs.find((i) => i.name === name)!.dims }))];
			const model = subgraphModel(this.graph, nodes, graphInputs, outputNames.map((name) => ({ name, dims: null })));
			island.session = await this.options.ort.InferenceSession.create(model,
				{ ...this.options.cpu, graphOptimizationLevel: 'disabled' });
			// Shapes come from one run on zeros; ops here do not change shape with values.
			const feeds = Object.fromEntries(graphInputs.map((i) =>
				[i.name, new this.options.ort.Tensor('float32', new Float32Array(product(i.dims)), i.dims)]));
			const out = await island.session.run(feeds);
			return out;
		})();
		// Island outputs must exist before later nodes compile, so planning waits here.
		return ready.then((out) => {
			island.outputs = outputNames.map((name) => this.produce(name, [...out[name].dims]));
			this.steps[this.steps.indexOf(this.steps.find((s) => s.island === island)!)].writes = island.outputs;
		});
	}

	// --- allocation and execution ---------------------------------------------------------------

	/**
	 * Liveness by step index; buffers of equal size are reused once their last reader ran. A
	 * padded storage only shares with its own geometry, so its border stays zero.
	 */
	private allocate(): void {
		this.steps.forEach((s, i) => {
			for (const v of [...s.reads, ...s.writes]) {
				const st = v.storage;
				if (st.first < 0) st.first = i;
				st.last = Math.max(st.last, i);
			}
		});
		for (const v of [...this.inputs, ...this.outputs]) v.storage.pinned = true;
		const free = new Map<string, unknown[]>();
		const pool = (st: Storage) => `${st.bytes}/${st.halo ?? ''}`;
		const ends = new Map<number, Storage[]>();
		for (const st of this.storages) {
			if (st.buffer) continue;
			if (st.pinned) {
				st.buffer = this.addon.createBuffer(st.bytes);
				this.buffers.push(st.buffer);
			} else if (st.last >= 0) ends.set(st.last, [...(ends.get(st.last) ?? []), st]);
		}
		const byStart = this.storages.filter((st) => !st.buffer && st.first >= 0).sort((a, b) => a.first - b.first);
		let cursor = 0;
		for (let i = 0; i < this.steps.length; i++) {
			while (cursor < byStart.length && byStart[cursor].first === i) {
				const st = byStart[cursor++];
				const reused = free.get(pool(st))?.pop();
				if (reused) st.buffer = reused;
				else {
					st.buffer = this.addon.createBuffer(st.bytes);
					this.buffers.push(st.buffer);
				}
			}
			for (const st of ends.get(i) ?? []) free.set(pool(st), [...(free.get(pool(st)) ?? []), st.buffer]);
		}
	}

	private checkCommand(v: Value): Command {
		const count = v.storage.bytes / 4;
		return {
			pipeline: this.pipeline('check_values'),
			bindings: [[v.storage.buffer, 0], [this.guard, 0]],
			params: params([count, v.storage.slot]),
			groups: [Math.ceil(count / 256), 1, 1],
			threads: [256, 1, 1]
		};
	}

	private record(): void {
		this.checks = this.inputs.map((v) => this.addon.record([this.checkCommand(v)]));
		let commands: Command[] = [];
		const flush = () => {
			if (commands.length) this.segments.push({ recording: this.addon.record(commands.map((c, i) => ({ ...c, flush: i % 48 === 47 }))) });
			commands = [];
		};
		for (const step of this.steps) {
			if (step.island) {
				flush();
				this.segments.push({ island: step.island, checks: this.addon.record(step.island.outputs.map((v) => this.checkCommand(v))) });
			} else if (step.native) {
				flush();
				this.segments.push({ native: step.native });
			} else commands.push(...step.emit!());
		}
		flush();
	}

	private resetGuard(): void {
		const reset = new Uint32Array(1 + this.storages.length).fill(NO_MINIMUM);
		reset[0] = 0;
		this.addon.writeBuffer(this.guard, 0, reset);
	}

	private readGuard(): Uint32Array {
		const guard = new Uint32Array(1 + this.storages.length);
		this.addon.readBuffer(this.guard, 0, guard);
		return guard;
	}

	/** Why the last run is not provably exact, or null when it is. */
	private doubt(guard: Uint32Array): string | null {
		if (guard[0] !== 0) return `guard flags ${guard[0]}`;
		const smallest = new Float32Array(guard.buffer, 4);
		for (const { value, minimum } of this.minimums) {
			if (smallest[value.storage.slot] < minimum) return `${value.name} holds ${smallest[value.storage.slot]}, under ${minimum}`;
		}
		return null;
	}

	private async runIsland(island: Island, feeds: Record<string, Float32Array>): Promise<void> {
		const { Tensor } = this.options.ort;
		const inputs: Record<string, unknown> = {};
		for (const v of island.inputs) {
			const data = new Float32Array(product(v.shape));
			this.addon.readBuffer(v.storage.buffer, v.offset * 4, data);
			inputs[v.name.replace(/#island$/, '')] = new Tensor('float32', data, v.shape);
		}
		for (const name of island.hostInputs) {
			inputs[name] = new Tensor('float32', feeds[name], this.graph.inputs.find((i) => i.name === name)!.dims);
		}
		const out = await island.session!.run(inputs);
		for (const v of island.outputs) this.addon.writeBuffer(v.storage.buffer, 0, out[v.name].data as Float32Array);
	}

	/** Runs the graph; reports why when the result is not provably what ORT's CPU kernels return. */
	async run(feeds: Record<string, Float32Array>):
		Promise<{ outputs: Record<string, Float32Array>; gpuMs: number; islandMs: number } | { doubt: string }> {
		for (const input of this.inputs) {
			const data = feeds[input.name];
			if (!data || data.length * 4 !== input.storage.bytes) throw new Error(`Metal plan input ${input.name} has the wrong size.`);
			this.addon.writeBuffer(input.storage.buffer, 0, data);
		}
		this.resetGuard();
		let gpuMs = 0, islandMs = 0, nativeFlags = 0;
		for (const c of this.checks) gpuMs += this.addon.execute(c);
		if (this.readGuard()[0] !== 0) return { doubt: `input guard flags ${this.readGuard()[0]}` };
		for (const segment of this.segments) {
			if ('recording' in segment) gpuMs += this.addon.execute(segment.recording);
			else if ('native' in segment) {
				const started = performance.now();
				nativeFlags |= segment.native();
				islandMs += performance.now() - started;
			} else {
				const started = performance.now();
				await this.runIsland(segment.island, feeds);
				islandMs += performance.now() - started;
				gpuMs += this.addon.execute(segment.checks);
			}
		}
		if (nativeFlags) return { doubt: `native flags ${nativeFlags}` };
		const doubt = this.doubt(this.readGuard());
		if (doubt) return { doubt };
		const outputs: Record<string, Float32Array> = {};
		for (const out of this.outputs) {
			const data = new Float32Array(product(out.shape));
			this.addon.readBuffer(out.storage.buffer, out.offset * 4, data);
			outputs[out.name] = data;
		}
		return { outputs, gpuMs, islandMs };
	}

	/** Diagnostic: GPU milliseconds per step kind, each step run on its own. */
	async profile(feeds: Record<string, Float32Array>): Promise<Record<string, number>> {
		for (const input of this.inputs) this.addon.writeBuffer(input.storage.buffer, 0, feeds[input.name]);
		this.resetGuard();
		const out: Record<string, number> = {};
		for (const step of this.steps) {
			if (step.island || step.native) {
				const started = performance.now();
				if (step.island) await this.runIsland(step.island, feeds);
				else step.native!();
				const name = step.island ? `island ${step.island.nodes.map((n) => n.opType).join(',').slice(0, 60)}`
					: `native ${step.reads[0]?.shape.join('x')}`;
				out[name] = (out[name] ?? 0) + performance.now() - started;
				continue;
			}
			for (const command of step.emit!()) {
				const kind = [...this.pipelines].find(([, p]) => p === command.pipeline)![0];
				const name = `${kind} ${step.writes[0]?.shape.join('x')}`;
				out[name] = (out[name] ?? 0) + this.addon.execute(this.addon.record([command]));
			}
		}
		return out;
	}

	/** Diagnostic: runs step by step and names the first step that raised the guard. */
	async debugRun(feeds: Record<string, Float32Array>): Promise<string> {
		for (const input of this.inputs) this.addon.writeBuffer(input.storage.buffer, 0, feeds[input.name]);
		this.resetGuard();
		for (const c of this.checks) this.addon.execute(c);
		if (this.readGuard()[0]) return `inputs flag ${this.readGuard()[0]}`;
		for (const [i, step] of this.steps.entries()) {
			let flags = 0;
			if (step.island) {
				await this.runIsland(step.island, feeds);
				this.addon.execute(this.addon.record(step.island.outputs.map((v) => this.checkCommand(v))));
			} else if (step.native) flags = step.native();
			else this.addon.execute(this.addon.record(step.emit!()));
			flags |= this.readGuard()[0];
			const what = step.island ? `island ${step.island.nodes.map((n) => n.opType).join(',')}`
				: step.native ? `native ${step.reads[0]?.name}` : step.writes.map((w) => w.name).join();
			if (flags) return `step ${i} (${what}) flag ${flags}`;
		}
		return this.doubt(this.readGuard()) ?? 'clean';
	}

	/** Diagnostic: the GPU value of an intermediate after a full run, contiguous. */
	read(name: string): { data: Float32Array; shape: number[] } | null {
		const v = this.values.get(name);
		if (!v || !v.storage.buffer) return null;
		const data = new Float32Array(product(v.shape));
		const full = new Float32Array(v.storage.bytes / 4);
		this.addon.readBuffer(v.storage.buffer, 0, full);
		const strides = v.strides;
		const idx = new Array(v.shape.length).fill(0);
		for (let i = 0; i < data.length; i++) {
			let off = v.offset;
			for (let d = 0; d < idx.length; d++) off += idx[d] * strides[d];
			data[i] = full[off];
			for (let d = idx.length - 1; d >= 0; d--) { if (++idx[d] < v.shape[d]) break; idx[d] = 0; }
		}
		return { data, shape: v.shape };
	}

	outputShape(name: string): number[] {
		return this.values.get(name)?.shape ?? fail(`unknown output ${name}`);
	}

	async release(): Promise<void> {
		for (const b of [...this.buffers, ...this.weights, this.guard]) if (b) this.addon.freeBuffer(b);
		this.buffers = [];
		this.weights = [];
		await Promise.all(this.steps.map((s) => s.island?.session?.release()));
	}
}
