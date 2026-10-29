import { randomUUID } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One stage of Striker 2.0's graph (a `net/<stage>` module), in the order the data passes. */
export interface Striker2Stage {
	id: string;
	kind: 'stem' | 'linear' | 'conv' | 'transformer' | 'down' | 'up' | 'head';
	/** Frames a second it computes at. */
	hz: number;
	/** Channels it hands on; the stem's are its channels times the frequency rows it leaves. */
	width: number;
	/** Repeated layers: transformer or conv blocks, or the stem's convolutions. */
	blocks: number;
	/** Multiply-accumulates for one chunk. */
	macs: number;
}

/** A residual stream: the channels every layer at one rate and width writes into. */
export interface Striker2Space {
	width: number;
	hz: number;
}

/** A layer the model view reads: a block of a stack or of the 100 Hz path, or a stage without blocks. */
export interface Striker2Layer {
	id: string;
	stage: string;
	/** Index into `spaces`. */
	space: number;
	/** The graph tensor holding its result, [1, frames, width]. */
	tensor: string;
}

/** A learned convolution between two streams, and where its weights lie in the file. */
export interface Striker2Link {
	stage: string;
	from: number;
	to: number;
	/** ConvTranspose weights are [in, out, k]; Conv weights [out, in, k]. */
	transposed: boolean;
	dims: number[];
	/** Byte offset and length of its float32 weights. */
	data: { offset: number; length: number } | null;
}

/** A linear head: the layer it reads, its [in, out] weights, and the graph outputs its columns split into. */
export interface Striker2Readout {
	stage: string;
	/** Index into `layers`. */
	layer: number;
	dims: number[];
	data: { offset: number; length: number } | null;
	outputs: string[];
}

export interface Striker2Graph {
	parameters: number;
	stages: Striker2Stage[];
	/** Additions that bring an earlier stage's output back: `from` joins the input of `to`. */
	skips: { from: string; to: string }[];
	spaces: Striker2Space[];
	layers: Striker2Layer[];
	links: Striker2Link[];
	readouts: Striker2Readout[];
}

interface GraphNode {
	name: string;
	op: string;
	inputs: string[];
	outputs: string[];
	ints: Record<string, number[]>;
}

/** Minimal protobuf reading: varints and length-delimited fields are all an ONNX header needs. */
class Pb {
	pos = 0;
	readonly buf: Uint8Array;
	constructor(buf: Uint8Array) {
		this.buf = buf;
	}
	more(): boolean {
		return this.pos < this.buf.length;
	}
	varint(): number {
		let value = 0;
		let scale = 1;
		let b: number;
		do {
			if (this.pos >= this.buf.length) throw new RangeError('protobuf varint runs past its buffer');
			b = this.buf[this.pos++];
			value += (b & 0x7f) * scale;
			scale *= 128;
		} while (b & 0x80);
		return value;
	}
	key(): [field: number, wire: number] {
		const k = this.varint();
		return [Math.floor(k / 8), k % 8];
	}
	bytes(): Uint8Array {
		const n = this.varint();
		if (this.pos + n > this.buf.length) throw new RangeError('protobuf field runs past its buffer');
		const out = this.buf.subarray(this.pos, this.pos + n);
		this.pos += n;
		return out;
	}
	text(): string {
		return new TextDecoder().decode(this.bytes());
	}
	skip(wire: number): void {
		if (wire === 0) this.varint();
		else if (wire === 1) this.pos += 8;
		else if (wire === 2) {
			// The length first: `pos += varint()` would read pos before the varint moves it.
			const length = this.varint();
			this.pos += length;
		} else if (wire === 5) this.pos += 4;
		else throw new Error(`unsupported protobuf wire type ${wire}`);
	}
	/** Repeated integers, packed or not. */
	ints(wire: number, into: number[]): void {
		if (wire !== 2) {
			into.push(this.varint());
			return;
		}
		const packed = new Pb(this.bytes());
		while (packed.more()) into.push(packed.varint());
	}
}

/** Reads ahead 64 KB at a time: nodes sit together, and a weight's header is all that is read of it. */
class FileWindow {
	private buf = Buffer.alloc(0);
	private at = 0;
	private readonly file: FileHandle;
	private readonly size: number;
	constructor(file: FileHandle, size: number) {
		this.file = file;
		this.size = size;
	}
	async bytes(pos: number, n: number): Promise<Uint8Array> {
		if (pos < this.at || pos + n > this.at + this.buf.length) {
			const length = Math.min(Math.max(n, 1 << 16), this.size - pos);
			this.buf = Buffer.alloc(length);
			await this.file.read(this.buf, 0, length, pos);
			this.at = pos;
		}
		return this.buf.subarray(pos - this.at, pos - this.at + n);
	}
}

/** A field's number, wire type, and where its value starts and ends. */
async function field(window: FileWindow, pos: number, end: number) {
	const head = new Pb(await window.bytes(pos, Math.min(20, end - pos)));
	const [number, wire] = head.key();
	const length = wire === 2 ? head.varint() : 0;
	const start = pos + head.pos;
	return { number, wire, start, end: wire === 2 ? start + length : start };
}

function parseNode(buf: Uint8Array): GraphNode {
	const p = new Pb(buf);
	const node: GraphNode = { name: '', op: '', inputs: [], outputs: [], ints: {} };
	while (p.more()) {
		const [f, wire] = p.key();
		if (f === 1) node.inputs.push(p.text());
		else if (f === 2) node.outputs.push(p.text());
		else if (f === 3) node.name = p.text();
		else if (f === 4) node.op = p.text();
		else if (f === 5) parseAttribute(p.bytes(), node.ints);
		else p.skip(wire);
	}
	return node;
}

function parseAttribute(buf: Uint8Array, into: Record<string, number[]>): void {
	const p = new Pb(buf);
	let name = '';
	const values: number[] = [];
	while (p.more()) {
		const [f, wire] = p.key();
		if (f === 1) name = p.text();
		else if (f === 3 && wire === 0) values.push(p.varint());
		else if (f === 8) p.ints(wire, values);
		else p.skip(wire);
	}
	if (values.length > 0) into[name] = values;
}

/** A weight's name and shape, and where its raw data starts within `buf`; the data is not read. */
function parseTensorHead(buf: Uint8Array): { name: string; dims: number[]; data: { at: number; length: number } | null } {
	const p = new Pb(buf);
	const dims: number[] = [];
	let name = '';
	let data: { at: number; length: number } | null = null;
	try {
		while (p.more()) {
			const [f, wire] = p.key();
			if (f === 1) p.ints(wire, dims);
			else if (f === 8) name = p.text();
			else if (f === 9) {
				const length = p.varint();
				data = { at: p.pos, length };
				break;
			} else p.skip(wire);
		}
	} catch (e) {
		if (!(e instanceof RangeError)) throw e;
	}
	return { name, dims, data };
}

function varint(value: number): number[] {
	const out: number[] = [];
	while (value >= 0x80) {
		out.push((value % 0x80) | 0x80);
		value = Math.floor(value / 0x80);
	}
	out.push(value);
	return out;
}

/** A graph output named `tensor`, float32 of any shape: ValueInfoProto { name, TypeProto { tensor_type { elem_type 1 } } }. */
function outputEntry(tensor: string): number[] {
	const name = [...new TextEncoder().encode(tensor)];
	const type = [0x0a, 2, 0x08, 0x01];
	const info = [0x0a, ...varint(name.length), ...name, 0x12, ...varint(type.length), ...type];
	return [0x62, ...varint(info.length), ...info];
}

/**
 * A copy of the graph at `path` that also outputs `tensors`, written to a temporary file whose path
 * is returned; the caller deletes it once a session has read it. Nothing else changes: the nodes,
 * weights and the existing outputs are copied byte for byte.
 */
export async function exposedGraph(path: string, tensors: string[]): Promise<string> {
	const source = await open(path);
	const target = join(tmpdir(), `striker2-${randomUUID()}.onnx`);
	const out = await open(target, 'w');
	try {
		const size = (await source.stat()).size;
		const window = new FileWindow(source, size);
		let graph: { key: number; start: number; end: number } | null = null;
		for (let pos = 0; pos < size && !graph;) {
			const f = await field(window, pos, size);
			if (f.number === 7 && f.wire === 2) graph = { key: pos, start: f.start, end: f.end };
			else if (f.wire === 2) pos = f.end;
			else {
				const p = new Pb(await window.bytes(pos, Math.min(20, size - pos)));
				p.key();
				p.skip(f.wire);
				pos += p.pos;
			}
		}
		if (!graph) throw new Error(`${path} has no graph`);
		const added = Uint8Array.from(tensors.flatMap(outputEntry));
		const copy = async (from: number, to: number) => {
			const buf = Buffer.alloc(8 << 20);
			for (let at = from; at < to;) {
				const { bytesRead } = await source.read(buf, 0, Math.min(buf.length, to - at), at);
				await out.write(buf, 0, bytesRead);
				at += bytesRead;
			}
		};
		await copy(0, graph.key);
		await out.write(Uint8Array.from([0x3a, ...varint(graph.end - graph.start + added.length)]));
		await copy(graph.start, graph.end);
		await out.write(added);
		await copy(graph.end, size);
	} finally {
		await source.close();
		await out.close();
	}
	return target;
}

/** Nodes, weight shapes and output names, read from the file without loading the weights. */
async function readGraph(path: string) {
	const file = await open(path);
	try {
		const size = (await file.stat()).size;
		const window = new FileWindow(file, size);
		let graph: { start: number; end: number } | null = null;
		for (let pos = 0; pos < size && !graph;) {
			const f = await field(window, pos, size);
			if (f.number === 7 && f.wire === 2) graph = f;
			else if (f.wire === 2) pos = f.end;
			else {
				const p = new Pb(await window.bytes(pos, Math.min(20, size - pos)));
				p.key();
				p.skip(f.wire);
				pos += p.pos;
			}
		}
		if (!graph) throw new Error(`${path} has no graph`);
		const nodes: GraphNode[] = [];
		const dims = new Map<string, number[]>();
		const raw = new Map<string, { offset: number; length: number }>();
		const outputs: string[] = [];
		for (let pos = graph.start; pos < graph.end;) {
			const f = await field(window, pos, graph.end);
			if (f.wire !== 2) throw new Error('unexpected field in the ONNX graph');
			if (f.number === 1) nodes.push(parseNode(await window.bytes(f.start, f.end - f.start)));
			else if (f.number === 5) {
				const head = parseTensorHead(await window.bytes(f.start, Math.min(4096, f.end - f.start)));
				dims.set(head.name, head.dims);
				if (head.data) raw.set(head.name, { offset: f.start + head.data.at, length: head.data.length });
			} else if (f.number === 12) {
				const p = new Pb(await window.bytes(f.start, f.end - f.start));
				while (p.more()) {
					const [n, wire] = p.key();
					if (n === 1) outputs.push(p.text());
					else p.skip(wire);
				}
			}
			pos = f.end;
		}
		return { nodes, dims, raw, outputs };
	} finally {
		await file.close();
	}
}

/** `/net/stacks.0/stacks.0.3/attn/MatMul` belongs to `stacks.0`; `/net/Add` to no stage. */
function stageOf(node: GraphNode): string | null {
	const parts = node.name.split('/').filter(Boolean);
	return parts[0] === 'net' && parts.length > 2 ? parts[1] : null;
}

const product = (xs: number[]) => xs.reduce((a, b) => a * b, 1);

/**
 * Striker 2.0's stages from its ONNX graph: the order the data passes, the rate each runs at (from
 * its strided convolutions), widths and block counts from the weights' shapes, and the arithmetic
 * of one chunk of `chunk` frames at `fps` with `bins` feature rows.
 */
export async function readStriker2Graph(
	path: string, shape: { chunk: number; fps: number; bins: number }
): Promise<Striker2Graph> {
	const { nodes, dims, raw, outputs } = await readGraph(path);
	const order: string[] = [];
	const members = new Map<string, GraphNode[]>();
	const producer = new Map<string, GraphNode>();
	const consumers = new Map<string, GraphNode[]>();
	for (const node of nodes) {
		const stage = stageOf(node);
		if (stage) {
			if (!members.has(stage)) {
				members.set(stage, []);
				order.push(stage);
			}
			members.get(stage)!.push(node);
		}
		for (const o of node.outputs) producer.set(o, node);
		for (const i of node.inputs) consumers.set(i, [...(consumers.get(i) ?? []), node]);
	}

	// Follows a tensor forward through stageless reshapes to whether it becomes a graph output.
	const finals = new Set(outputs);
	const reachesOutput = (tensor: string, seen = new Set<string>()): boolean => {
		if (finals.has(tensor)) return true;
		if (seen.has(tensor)) return false;
		seen.add(tensor);
		return (consumers.get(tensor) ?? []).some((n) => !stageOf(n) && n.outputs.some((o) => reachesOutput(o, seen)));
	};

	let hz = shape.fps;
	let rows = shape.bins;
	const stages: Striker2Stage[] = order.map((id) => {
		const own = members.get(id)!;
		const frames = () => shape.chunk * hz / shape.fps;
		let macs = 0;
		let width = 0;
		let kind: Striker2Stage['kind'] = 'linear';
		let convs = 0;
		for (const node of own) {
			const w = dims.get(node.inputs[1] ?? '');
			if (node.op === 'MatMul' && w?.length === 2) {
				macs += frames() * w[0] * w[1];
				width = w[1];
			} else if ((node.op === 'Conv' || node.op === 'ConvTranspose') && w) {
				const group = node.ints.group?.[0] ?? 1;
				const stride = node.ints.strides ?? [1];
				const kernel = node.ints.kernel_shape ?? w.slice(2);
				convs++;
				if (kernel.length === 2) {
					const pad = node.ints.pads?.[0] ?? 0;
					rows = Math.floor((rows + 2 * pad - kernel[0]) / stride[0]) + 1;
					macs += frames() * rows * w[0] * w[1] * product(kernel);
					width = w[0] * rows;
					kind = 'stem';
				} else if (node.op === 'ConvTranspose') {
					macs += frames() * w[0] * w[1] * product(kernel);
					hz *= stride[0];
					width = w[1] * group;
					kind = 'up';
				} else {
					hz /= stride[0];
					macs += frames() * w[0] * w[1] * product(kernel);
					if (stride[0] > 1) {
						width = w[0];
						kind = 'down';
					} else if (kind === 'linear') {
						kind = 'conv';
					}
				}
			}
		}
		const attention = own.filter((n) => n.op === 'Softmax').length;
		if (attention > 0) {
			kind = 'transformer';
			const first = own.map((n) => dims.get(n.inputs[1] ?? '')).find((w) => w?.length === 2);
			const model = first ? first[0] : width;
			// Scores and their weighted sum: two (frames x frames x width) products a layer.
			macs += attention * 2 * frames() ** 2 * model;
		}
		const sub = new Set(own.map((n) => n.name.split('/').filter(Boolean)[2]).filter((p) => p?.startsWith(`${id}.`)));
		const blocks = kind === 'stem' ? convs : Math.max(1, sub.size);
		if (kind === 'linear' && own.some((n) => n.outputs.some((o) => reachesOutput(o)))) kind = 'head';
		return { id, kind, hz, width, blocks, macs };
	});

	// Follows a tensor back through stageless reshapes to the stage that made it.
	const madeBy = (tensor: string, depth = 0): string | null => {
		const node = producer.get(tensor);
		if (!node || depth > 32) return null;
		return stageOf(node) ?? (node.inputs[0] ? madeBy(node.inputs[0], depth + 1) : null);
	};
	const takenBy = (tensor: string, depth = 0): string | null => {
		for (const node of consumers.get(tensor) ?? []) {
			const stage = stageOf(node) ?? (depth < 32 ? node.outputs.map((o) => takenBy(o, depth + 1)).find(Boolean) : null);
			if (stage) return stage;
		}
		return null;
	};
	const skips: { from: string; to: string }[] = [];
	for (const node of nodes) {
		if (node.op !== 'Add' || stageOf(node) || node.inputs.length !== 2) continue;
		const [a, b] = node.inputs.map((t) => madeBy(t));
		const to = takenBy(node.outputs[0]);
		if (!a || !b || a === b || !to) continue;
		skips.push({ from: order.indexOf(a) < order.indexOf(b) ? a : b, to });
	}

	const parameters = [...dims.values()].reduce((sum, d) => sum + product(d), 0);
	return { parameters, stages, skips, ...streams(nodes, stages, dims, raw, finals, consumers) };
}

/** `net/<a>/<b>/...` at depth 2 is the unit `<a>/<b>`, at depth 1 `<a>`; glue nodes have none. */
function unitOf(node: GraphNode, depth: number): string | null {
	const parts = node.name.split('/').filter(Boolean);
	return parts[0] === 'net' && parts.length > depth + 1 ? parts.slice(1, 1 + depth).join('/') : null;
}

/**
 * The layers whose results the model view reads, the residual streams they write into (one per
 * rate and width), and the learned convolutions that carry one stream into the next.
 */
function streams(
	nodes: GraphNode[], stages: Striker2Stage[], dims: Map<string, number[]>,
	raw: Map<string, { offset: number; length: number }>, finals: Set<string>, consumers: Map<string, GraphNode[]>
): Pick<Striker2Graph, 'spaces' | 'layers' | 'links' | 'readouts'> {
	// A unit's result: the last tensor it makes that something outside it reads.
	const results = (depth: number) => {
		const last = new Map<string, string>();
		for (const node of nodes) {
			const unit = unitOf(node, depth);
			if (!unit) continue;
			for (const o of node.outputs) {
				if (finals.has(o) || (consumers.get(o) ?? []).some((c) => unitOf(c, depth) !== unit)) last.set(unit, o);
			}
		}
		return last;
	};
	const stageResults = results(1);
	const blockResults = results(2);
	const spaces: Striker2Space[] = [];
	const layers: Striker2Layer[] = [];
	const links: Striker2Link[] = [];
	const spaceOf = (width: number, hz: number) => {
		let i = spaces.findIndex((s) => s.width === width && s.hz === hz);
		if (i < 0) i = spaces.push({ width, hz }) - 1;
		return i;
	};
	let pending: Omit<Striker2Link, 'to'> | null = null;
	for (const stage of stages) {
		if (stage.kind === 'down' || stage.kind === 'up') {
			const conv = nodes.find((n) => stageOf(n) === stage.id && (n.op === 'Conv' || n.op === 'ConvTranspose'));
			const weight = conv?.inputs[1] ?? '';
			pending = {
				stage: stage.id, from: layers.at(-1)?.space ?? -1, transposed: conv?.op === 'ConvTranspose',
				dims: dims.get(weight) ?? [], data: raw.get(weight) ?? null
			};
			continue;
		}
		if (stage.kind !== 'linear' && stage.kind !== 'conv' && stage.kind !== 'transformer') continue;
		const space = spaceOf(stage.width, stage.hz);
		if (pending) {
			links.push({ ...pending, to: space });
			pending = null;
		}
		const blocks = [...blockResults.keys()].filter((u) => u.startsWith(`${stage.id}/${stage.id}.`));
		if (blocks.length > 0) {
			for (const unit of blocks) layers.push({ id: unit.split('/')[1], stage: stage.id, space, tensor: blockResults.get(unit)! });
		} else if (stageResults.has(stage.id)) {
			layers.push({ id: stage.id, stage: stage.id, space, tensor: stageResults.get(stage.id)! });
		}
	}
	const readouts: Striker2Readout[] = [];
	for (const stage of stages.filter((s) => s.kind === 'head')) {
		const own = nodes.filter((n) => stageOf(n) === stage.id);
		const matmul = own.find((n) => n.op === 'MatMul');
		const layer = layers.findIndex((l) => l.tensor === matmul?.inputs[0]);
		if (!matmul || layer < 0) continue;
		const result = own.at(-1)!.outputs[0];
		const split = (consumers.get(result) ?? []).find((n) => n.op === 'Split' && !stageOf(n));
		const weight = matmul.inputs[1];
		readouts.push({
			stage: stage.id, layer, dims: dims.get(weight) ?? [], data: raw.get(weight) ?? null,
			outputs: split ? split.outputs : finals.has(result) ? [result] : []
		});
	}
	return { spaces, layers, links, readouts };
}
