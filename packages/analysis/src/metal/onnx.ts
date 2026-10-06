import { readFileSync } from 'node:fs';

/** The parts of an ONNX model the Metal planner reads, with each message's original bytes. */
export interface OnnxNode {
	opType: string;
	domain: string;
	inputs: string[];
	outputs: string[];
	attributes: Map<string, OnnxAttribute>;
	raw: Uint8Array;
}
export type OnnxAttribute = number | string | number[] | Float32Array;
export interface OnnxTensor {
	dims: number[];
	dataType: number;
	data: Float32Array | BigInt64Array | Int32Array;
	raw: Uint8Array;
}
export interface OnnxGraph {
	nodes: OnnxNode[];
	initializers: Map<string, OnnxTensor>;
	inputs: { name: string; dims: number[] }[];
	outputs: string[];
	irVersion: number;
	opsets: Uint8Array[];
}

const FLOAT = 1;
const INT32 = 6;
const INT64 = 7;

class Reader {
	readonly buf: Buffer;
	readonly end: number;
	pos: number;
	constructor(buf: Buffer, start = 0, end = buf.length) {
		this.buf = buf;
		this.pos = start;
		this.end = end;
	}
	get done(): boolean { return this.pos >= this.end; }
	varint(): number {
		let result = 0;
		let shift = 1;
		for (;;) {
			const byte = this.buf[this.pos++];
			result += (byte & 0x7f) * shift;
			if (byte < 0x80) return result;
			shift *= 128;
		}
	}
	/** Two's complement int64, which ONNX uses for negative axes and pads. */
	int64(): number {
		let result = 0n;
		let shift = 0n;
		for (;;) {
			const byte = this.buf[this.pos++];
			result |= BigInt(byte & 0x7f) << shift;
			shift += 7n;
			if (byte < 0x80) return Number(BigInt.asIntN(64, result));
		}
	}
	key(): { field: number; wire: number } {
		const key = this.varint();
		return { field: Math.floor(key / 8), wire: key % 8 };
	}
	bytes(): Buffer {
		const length = this.varint();
		const out = this.buf.subarray(this.pos, this.pos + length);
		this.pos += length;
		return out;
	}
	sub(): Reader {
		const length = this.varint();
		const r = new Reader(this.buf, this.pos, this.pos + length);
		this.pos += length;
		return r;
	}
	skip(wire: number): void {
		if (wire === 0) this.varint();
		else if (wire === 1) this.pos += 8;
		else if (wire === 2) {
			const length = this.varint();
			this.pos += length;
		}
		else if (wire === 5) this.pos += 4;
		else throw new Error(`Unsupported protobuf wire type ${wire}`);
	}
}

function aligned(bytes: Buffer, width: number): ArrayBuffer {
	const copy = new ArrayBuffer(bytes.length);
	new Uint8Array(copy).set(bytes);
	if (copy.byteLength % width !== 0) throw new Error('Tensor payload is not a whole number of elements.');
	return copy;
}

function tensor(r: Reader): OnnxTensor & { name: string } {
	const message = r.buf.subarray(r.pos, r.end);
	const dims: number[] = [];
	let dataType = 0;
	let name = '';
	let raw: Buffer | null = null;
	const floats: number[] = [];
	const ints: number[] = [];
	while (!r.done) {
		const { field, wire } = r.key();
		if (field === 1) {
			if (wire === 2) { const s = r.sub(); while (!s.done) dims.push(s.int64()); }
			else dims.push(r.int64());
		} else if (field === 2) dataType = r.varint();
		else if (field === 4) {
			if (wire === 2) { const b = r.bytes(); for (let i = 0; i < b.length; i += 4) floats.push(b.readFloatLE(i)); }
			else { floats.push(r.buf.readFloatLE(r.pos)); r.pos += 4; }
		} else if (field === 5 || field === 7) {
			if (wire === 2) { const s = r.sub(); while (!s.done) ints.push(s.int64()); }
			else ints.push(r.int64());
		} else if (field === 8) name = r.bytes().toString('utf8');
		else if (field === 9) raw = r.bytes();
		else if (field === 13 || field === 14) throw new Error(`Tensor ${name || '?'} uses external data.`);
		else r.skip(wire);
	}
	let data: OnnxTensor['data'];
	if (dataType === FLOAT) data = raw ? new Float32Array(aligned(raw, 4)) : Float32Array.from(floats);
	else if (dataType === INT64) data = raw ? new BigInt64Array(aligned(raw, 8)) : BigInt64Array.from(ints.map(BigInt));
	else if (dataType === INT32) data = raw ? new Int32Array(aligned(raw, 4)) : Int32Array.from(ints);
	else throw new Error(`Tensor ${name} has unsupported data type ${dataType}.`);
	return { name, dims, dataType, data, raw: message };
}

function attribute(r: Reader): { name: string; value: OnnxAttribute } {
	let name = '';
	let value: OnnxAttribute = 0;
	const ints: number[] = [];
	const floats: number[] = [];
	let type = 0;
	while (!r.done) {
		const { field, wire } = r.key();
		if (field === 1) name = r.bytes().toString('utf8');
		else if (field === 2) { value = r.buf.readFloatLE(r.pos); r.pos += 4; }
		else if (field === 3) value = r.int64();
		else if (field === 4) value = r.bytes().toString('utf8');
		else if (field === 5) value = tensor(r.sub()).data as Float32Array;
		else if (field === 7) {
			if (wire === 2) { const b = r.bytes(); for (let i = 0; i < b.length; i += 4) floats.push(b.readFloatLE(i)); }
			else { floats.push(r.buf.readFloatLE(r.pos)); r.pos += 4; }
		} else if (field === 8) {
			if (wire === 2) { const s = r.sub(); while (!s.done) ints.push(s.int64()); }
			else ints.push(r.int64());
		} else if (field === 20) type = r.varint();
		else r.skip(wire);
	}
	// AttributeProto.AttributeType: FLOATS 6, INTS 7.
	if (type === 7) value = ints;
	else if (type === 6) value = floats;
	return { name, value };
}

function node(r: Reader): OnnxNode {
	const out: OnnxNode = {
		opType: '', domain: '', inputs: [], outputs: [], attributes: new Map(), raw: r.buf.subarray(r.pos, r.end)
	};
	while (!r.done) {
		const { field, wire } = r.key();
		if (field === 1) out.inputs.push(r.bytes().toString('utf8'));
		else if (field === 2) out.outputs.push(r.bytes().toString('utf8'));
		else if (field === 4) out.opType = r.bytes().toString('utf8');
		else if (field === 5) { const a = attribute(r.sub()); out.attributes.set(a.name, a.value); }
		else if (field === 7) out.domain = r.bytes().toString('utf8');
		else r.skip(wire);
	}
	return out;
}

function valueInfo(r: Reader): { name: string; dims: number[] } {
	let name = '';
	const dims: number[] = [];
	while (!r.done) {
		const { field, wire } = r.key();
		if (field === 1) name = r.bytes().toString('utf8');
		else if (field === 2) {
			const type = r.sub();
			while (!type.done) {
				const t = type.key();
				if (t.field !== 1) { type.skip(t.wire); continue; }
				const tt = type.sub();
				while (!tt.done) {
					const k = tt.key();
					if (k.field !== 2) { tt.skip(k.wire); continue; }
					const shape = tt.sub();
					while (!shape.done) {
						const d = shape.key();
						if (d.field !== 1) { shape.skip(d.wire); continue; }
						const dim = shape.sub();
						let size = -1;
						while (!dim.done) {
							const dd = dim.key();
							if (dd.field === 1) size = dim.int64();
							else dim.skip(dd.wire);
						}
						dims.push(size);
					}
				}
			}
		} else r.skip(wire);
	}
	return { name, dims };
}

export function parseOnnx(bytes: Buffer): OnnxGraph {
	const model = new Reader(bytes);
	let graphReader: Reader | null = null;
	let irVersion = 8;
	const opsets: Uint8Array[] = [];
	while (!model.done) {
		const { field, wire } = model.key();
		if (field === 7) graphReader = model.sub();
		else if (field === 1) irVersion = model.varint();
		else if (field === 8) opsets.push(model.bytes());
		else model.skip(wire);
	}
	if (!graphReader) throw new Error('The ONNX model has no graph.');
	const graph: OnnxGraph = { nodes: [], initializers: new Map(), inputs: [], outputs: [], irVersion, opsets };
	const declared: { name: string; dims: number[] }[] = [];
	while (!graphReader.done) {
		const { field, wire } = graphReader.key();
		if (field === 1) graph.nodes.push(node(graphReader.sub()));
		else if (field === 5) { const t = tensor(graphReader.sub()); graph.initializers.set(t.name, t); }
		else if (field === 11) declared.push(valueInfo(graphReader.sub()));
		else if (field === 12) graph.outputs.push(valueInfo(graphReader.sub()).name);
		else graphReader.skip(wire);
	}
	graph.inputs = declared.filter((input) => !graph.initializers.has(input.name));
	return graph;
}

export function readOnnx(path: string): OnnxGraph {
	return parseOnnx(readFileSync(path));
}

function varint(value: number): number[] {
	const out: number[] = [];
	let v = value;
	while (v >= 0x80) {
		out.push((v % 128) | 0x80);
		v = Math.floor(v / 128);
	}
	out.push(v);
	return out;
}

function field(number: number, payload: Uint8Array | number[]): Uint8Array {
	const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
	const head = [...varint(number * 8 + 2), ...varint(bytes.length)];
	const out = new Uint8Array(head.length + bytes.length);
	out.set(head);
	out.set(bytes, head.length);
	return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

const utf8 = (text: string) => new TextEncoder().encode(text);

/** A float tensor's value info; null dims leave the shape for ORT to infer. */
function floatInfo(name: string, dims: number[] | null): Uint8Array {
	const shape = dims && concat(dims.map((d) => field(1, [8, ...varint(d)])));
	const tensorType = concat([Uint8Array.from([8, 1]), ...(shape ? [field(2, shape)] : [])]);
	return concat([field(1, utf8(name)), field(2, field(1, tensorType))]);
}

/**
 * A model holding some of a graph's nodes verbatim, with the initializers they read. ORT runs
 * it with optimization disabled, so each node executes exactly as in the full session.
 */
export function subgraphModel(
	graph: OnnxGraph, nodes: OnnxNode[], inputs: { name: string; dims: number[] }[],
	outputs: { name: string; dims: number[] | null }[]
): Uint8Array {
	const used = new Set(nodes.flatMap((n) => n.inputs));
	const initializers = [...graph.initializers.entries()].filter(([name]) => used.has(name)).map(([, t]) => t.raw);
	const body = concat([
		...nodes.map((n) => field(1, n.raw)),
		field(2, utf8('island')),
		...initializers.map((raw) => field(5, raw)),
		...inputs.map((i) => field(11, floatInfo(i.name, i.dims))),
		...outputs.map((o) => field(12, floatInfo(o.name, o.dims)))
	]);
	return concat([Uint8Array.from([8, ...varint(graph.irVersion)]), ...graph.opsets.map((o) => field(8, o)), field(7, body)]);
}
