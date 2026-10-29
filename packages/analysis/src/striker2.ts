import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ACTIVITY_STEMS, type ActivityStem, type OnsetStream } from '@mv/core';
import { hashFile } from './fileHash.ts';
import {
	QUIET_THREADS, openSession, type OnnxSession, type OnnxTensor, type OpenSession
} from './onnxSession.ts';
import {
	STRIKER2_CLASSES, activitySpans, bassOnsets, coarseHits, type PeakRule, type Striker2Class
} from './striker2Decode.ts';
import { dbnBeats } from './striker2Dbn.ts';
import { STRIKER2_FRONT_END, Striker2FrontEnd } from './striker2Frontend.ts';
import { exposedGraph } from './striker2Graph.ts';
import type { Striker2Watch } from './striker2View.ts';

/** Striker 2.0 (striker-2 `python -m striker.export`): this manifest beside its graph. */
export const STRIKER2_MANIFEST = 'striker2.json';

/** Each graph output's width, in the graph's order; activity runs at 100 / `activity_stride` fps. */
export const STRIKER2_OUTPUTS = {
	drum_onset: 18, drum_offset: 18, drum_level: 18, beat: 2, beat_offset: 1, bass: 3, activity: 4
} as const;
const OUTPUTS = STRIKER2_OUTPUTS;
export type Striker2Output = keyof typeof OUTPUTS;
export type Striker2Outputs = Record<Striker2Output, Float32Array>;

export interface Striker2GoldenFile {
	path: string;
	bytes: number;
	sha256: string;
}

/**
 * One chunk the export ran through PyTorch: its features ([chunk, bins] float32) and PyTorch's
 * outputs on them (each [rows, width], in the graph's order, concatenated). Only the first
 * `frames` rows are music; the rest is zero padding.
 */
export interface Striker2GoldenChunk {
	source: string;
	frames: number;
	features: Striker2GoldenFile;
	outputs: Striker2GoldenFile;
}

export interface Striker2Model {
	/** The manifest's name, `<release> (<first 8 hex of the graph's SHA-256>)`; analyses record it. */
	name: string;
	graph: string;
	sha256: string;
	input: string;
	/** Every shape fixed (batch 1), which Core ML and DirectML need to take the whole graph. */
	static: boolean;
	/** The chunks that check a runtime against PyTorch, or why there are none. */
	golden: { chunks: Striker2GoldenChunk[] } | { problem: string };
	/** Frames per graph run and frames each neighbour overwrites at either end. */
	chunk: number;
	border: number;
	activityStride: number;
	taps: Float32Array;
	drums: { firstColumn: number; rules: Record<Striker2Class, PeakRule> };
	bass: PeakRule;
	levelFloor: number;
	/** Notes worth a log line that do not stop the model, such as an unchecked runtime. */
	warnings: string[];
}

export interface Striker2Result {
	/** The model's name (see `Striker2Model.name`). */
	name: string;
	drums: Record<Striker2Class, OnsetStream>;
	/** DBN beats and downbeats, seconds to 1 ms, every downbeat one of the beats. */
	beats: number[];
	downbeats: number[];
	bass: OnsetStream;
	activity: Record<ActivityStem, [number, number][]>;
}

/** What analysis takes from Striker 2.0 besides the beats and downbeats, which set the grid. */
export type Transcription = Omit<Striker2Result, 'beats' | 'downbeats'>;

type Json = Record<string, unknown>;

function fail(what: string): never {
	throw new Error(what);
}

function object(value: unknown, what: string): Json {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail(`${what} is not an object`);
	}
	return value as Json;
}

function number(value: unknown, what: string, check = (v: number) => Number.isFinite(v)): number {
	if (typeof value !== 'number' || !check(value)) fail(`${what} is ${JSON.stringify(value)}`);
	return value;
}

const integer = (value: unknown, what: string, min = 0) =>
	number(value, what, (v) => Number.isInteger(v) && v >= min);

function same(value: unknown, want: unknown, what: string): void {
	const [got, wanted] = [JSON.stringify(value), JSON.stringify(want)];
	if (got !== wanted) fail(`${what} is ${got}, the app reads ${wanted}`);
}

function rule(source: Json, what: string): PeakRule {
	return {
		threshold: number(source.threshold, `${what} threshold`, (v) => v > 0 && v <= 1),
		gap: integer(source.gap_frames, `${what} gap_frames`, 1),
		reach: number(source.offset_reach_frames, `${what} offset_reach_frames`, (v) => v > 0)
	};
}

/** The front end is code: the manifest must describe exactly what striker2Frontend computes. */
function checkFrontEnd(front: Json): { taps: number; sha256: string; base64: string } {
	const { sampleRate, fps, hop, a, b, bins } = STRIKER2_FRONT_END;
	same([front.sample_rate, front.fps, front.hop, front.bins], [sampleRate, fps, hop, bins],
		'front_end rates and bins');
	const fa = object(front.a, 'front_end.a');
	same([fa.frame, fa.per_octave, fa.fmin, fa.fmax, fa.bands],
		[a.frame, a.perOctave, a.fmin, a.fmax, a.bands], 'front_end.a');
	const fb = object(front.b, 'front_end.b');
	same([fb.decimate, fb.rate, fb.hop, fb.frame, fb.per_octave, fb.fmin, fb.fmax, fb.bands, fb.fir_taps],
		[b.decimate, b.rate, b.hop, b.frame, b.perOctave, b.fmin, b.fmax, b.bands, b.firTaps],
		'front_end.b');
	if (typeof fb.fir_sha256 !== 'string' || typeof fb.fir_f32le_base64 !== 'string') {
		fail('front_end.b has no FIR');
	}
	return { taps: b.firTaps, sha256: fb.fir_sha256, base64: fb.fir_f32le_base64 };
}

/** The bass FIR's taps from the manifest, refused unless their bytes hash to the recorded SHA-256. */
function firTaps(fir: { taps: number; sha256: string; base64: string }): Float32Array {
	const bytes = Buffer.from(fir.base64, 'base64');
	if (bytes.length !== fir.taps * 4) fail(`the FIR has ${bytes.length} bytes, not ${fir.taps * 4}`);
	if (createHash('sha256').update(bytes).digest('hex') !== fir.sha256) {
		fail('the FIR does not match its SHA-256');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return Float32Array.from({ length: fir.taps }, (_, i) => view.getFloat32(4 * i, true));
}

export function runtimeVersion(): string | null {
	try {
		const ort = createRequire(import.meta.url)('onnxruntime-node/package.json') as { version: string };
		return ort.version;
	} catch {
		return null;
	}
}

function warnings(checked: Json): string[] {
	if (typeof checked.onnxruntime_node !== 'string') {
		return ['no onnxruntime-node parity check is recorded for this graph'];
	}
	const running = runtimeVersion();
	return running && running !== checked.onnxruntime_node
		? [`checked with onnxruntime-node ${checked.onnxruntime_node}, running ${running}`]
		: [];
}

function goldenFile(value: unknown, what: string, dir: string, bytes: number): Striker2GoldenFile {
	const f = object(value, what);
	if (typeof f.file !== 'string' || !/^[\w.-]+\.f32$/.test(f.file)) fail(`${what}.file is not a .f32 beside the graph`);
	same(f.bytes, bytes, `${what}.bytes`);
	if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) fail(`${what}.sha256 is not a SHA-256`);
	return { path: join(dir, f.file), bytes, sha256: f.sha256 };
}

/** The golden section. A malformed one leaves the model usable, but nothing can check a runtime. */
function goldenChunks(value: unknown, dir: string, chunk: number, stride: number): Striker2Model['golden'] {
	if (value === undefined) return { problem: 'the manifest lists no golden chunks' };
	try {
		const chunks = object(value, 'golden').chunks;
		if (!Array.isArray(chunks) || chunks.length === 0) fail('golden.chunks is empty');
		const values = Object.entries(OUTPUTS)
			.reduce((n, [name, width]) => n + (name === 'activity' ? chunk / stride : chunk) * width, 0);
		return {
			chunks: chunks.map((value: unknown, i) => {
				const what = `golden.chunks[${i}]`;
				const c = object(value, what);
				return {
					source: typeof c.source === 'string' ? c.source : what,
					frames: number(c.frames, `${what}.frames`, (v) => Number.isInteger(v) && v > 0 && v <= chunk),
					features: goldenFile(c.features, `${what}.features`, dir, chunk * STRIKER2_FRONT_END.bins * 4),
					outputs: goldenFile(c.outputs, `${what}.outputs`, dir, values * 4)
				};
			})
		};
	} catch (e) {
		return { problem: e instanceof Error ? e.message : String(e) };
	}
}

/** A parsed manifest, before the graph's hash is checked. Throws on anything the app cannot honour. */
function parseManifest(json: unknown, dir: string): Striker2Model & { bytes: number } {
	const m = object(json, 'the manifest');
	same([m.format, m.version], ['striker2-model', 1], 'format and version');
	if (typeof m.name !== 'string' || !m.name) fail('name is missing');
	if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) fail('sha256 is not a SHA-256');
	if (typeof m.file !== 'string' || !/^[\w.-]+\.onnx$/.test(m.file)) fail('file is not a graph beside it');
	const bytes = integer(m.bytes, 'bytes', 1);
	const graph = object(m.graph, 'graph');
	if (typeof graph.input !== 'string') fail('graph.input is missing');
	const chunk = integer(graph.chunk, 'graph.chunk', 1);
	const border = number(graph.border, 'graph.border', (v) => Number.isInteger(v) && v >= 0 && 2 * v < chunk);
	const widths = object(graph.outputs, 'graph.outputs');
	for (const [name, width] of Object.entries(OUTPUTS)) same(widths[name], width, `graph.outputs.${name}`);
	const activityStride = number(graph.activity_stride, 'graph.activity_stride',
		(v) => Number.isInteger(v) && v > 0 && chunk % v === 0);
	if (graph.static !== undefined && typeof graph.static !== 'boolean') fail('graph.static is not a boolean');
	if (graph.static) {
		const shape = Array.isArray(graph.input_shape) ? graph.input_shape.slice(0, 2) : graph.input_shape;
		same(shape, [1, chunk], 'a static graph.input_shape');
	}
	const fir = checkFrontEnd(object(m.front_end, 'front_end'));
	const decoding = object(m.decoding, 'decoding');
	const drums = object(decoding.drums, 'decoding.drums');
	same(object(drums.columns, 'decoding.drums.columns').coarse, STRIKER2_CLASSES,
		'decoding.drums.columns.coarse');
	const firstColumn = integer(drums.coarse_column_offset, 'decoding.drums.coarse_column_offset');
	same(firstColumn + STRIKER2_CLASSES.length, OUTPUTS.drum_onset, 'coarse columns end');
	const thresholds = object(drums.threshold, 'decoding.drums.threshold');
	const gaps = object(drums.gap_frames, 'decoding.drums.gap_frames');
	const rules = Object.fromEntries(STRIKER2_CLASSES.map((cls) => [cls, rule(
		{ threshold: thresholds[cls], gap_frames: gaps[cls], offset_reach_frames: drums.offset_reach_frames },
		`decoding.drums ${cls}`
	)])) as Record<Striker2Class, PeakRule>;
	const bass = object(decoding.bass, 'decoding.bass');
	same(bass.columns, ['onset', 'offset', 'level'], 'decoding.bass.columns');
	const activity = object(decoding.activity, 'decoding.activity');
	same([activity.columns, activity.stride_frames, activity.logits], [ACTIVITY_STEMS, activityStride, true],
		'decoding.activity');
	const rounding = object(decoding.rounding, 'decoding.rounding');
	same([rounding.time_s, rounding.level], [0.001, 0.01], 'decoding.rounding');
	const levelFloor = number(rounding.level_floor, 'decoding.rounding.level_floor', (v) => v >= 0 && v < 1);
	return {
		name: m.name, graph: join(dir, m.file), sha256: m.sha256, input: graph.input, static: graph.static === true,
		golden: goldenChunks(m.golden, dir, chunk, activityStride), chunk, border, activityStride,
		taps: firTaps(fir), drums: { firstColumn, rules }, bass: rule(bass, 'decoding.bass'), levelFloor,
		warnings: warnings(m.checked === undefined ? {} : object(m.checked, 'checked')), bytes
	};
}

/**
 * Reads and checks the manifest in `dir` and the graph it names: its size, and its SHA-256 unless
 * `verify` is false. Every refusal names the manifest.
 */
export async function readStriker2(
	dir: string, manifest = STRIKER2_MANIFEST, { verify = true } = {}
): Promise<Striker2Model> {
	try {
		const text = await readFile(join(dir, manifest), 'utf8');
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch (e) {
			fail(`not JSON (${e instanceof Error ? e.message : String(e)})`);
		}
		const { bytes, ...model } = parseManifest(json, dir);
		const size = (await stat(model.graph).catch(() => fail(`${model.graph} is missing`))).size;
		if (size !== bytes) fail(`the graph has ${size} bytes, the manifest ${bytes}`);
		if (verify && await hashFile(model.graph) !== model.sha256) fail('the graph does not match its SHA-256');
		return model;
	} catch (e) {
		throw new Error(`${manifest}: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** evaluate.chunked's starts: a step of chunk - 2 * border, the last one ending on the song. */
export function chunkStarts(frames: number, chunk: number, border: number): number[] {
	const out: number[] = [];
	for (let s = 0; s + chunk < frames; s += chunk - 2 * border) out.push(s);
	out.push(Math.max(0, frames - chunk));
	return out;
}

/** Every stream the app reads, from whole-song outputs ([frames, width] each, 100 fps). */
export function decodeStriker2(model: Striker2Model, out: Striker2Outputs): Striker2Result {
	const heads = { onset: out.drum_onset, offset: out.drum_offset, level: out.drum_level, width: OUTPUTS.drum_onset };
	return {
		name: model.name,
		drums: coarseHits(heads, model.drums.firstColumn, model.drums.rules, model.levelFloor),
		...dbnBeats(out.beat, out.beat_offset),
		bass: bassOnsets(out.bass, model.bass, model.levelFloor),
		activity: activitySpans(out.activity, ACTIVITY_STEMS)
	};
}

export interface Striker2Options {
	/** onnxruntime session options over the defaults: the CPU, every graph optimization. */
	session?: Record<string, unknown>;
	open?: OpenSession;
	/** Inner tensors to output as well, for the model view; the graph's own outputs stay bit-identical. */
	expose?: string[];
}

/** The exposed inner tensors of one chunk, by name. */
export type Striker2Inner = Record<string, OnnxTensor>;

/** A chunk's output, refused unless it has the graph's shape and only finite values. */
function checked(model: Striker2Model, name: Striker2Output, got: OnnxTensor | undefined): Float32Array {
	const rows = name === 'activity' ? model.chunk / model.activityStride : model.chunk;
	if (!got || got.dims.join() !== [1, rows, OUTPUTS[name]].join()) {
		throw new Error(`Striker 2.0's graph returned ${name} as [${got?.dims.join(', ')}]`);
	}
	for (const v of got.data) {
		if (!Number.isFinite(v)) throw new Error(`Striker 2.0's graph returned a non-finite ${name}`);
	}
	return got.data;
}

export class Striker2 {
	private session!: OnnxSession;
	private model!: Striker2Model;
	private exposed: string[] = [];

	static async create(model: Striker2Model, options: Striker2Options = {}): Promise<Striker2> {
		const { session = {}, open = openSession, expose = [] } = options;
		const self = new Striker2();
		self.model = model;
		self.exposed = expose;
		// The verified graph stays as it is; a session that exposes tensors reads a temporary copy.
		const graph = expose.length > 0 ? await exposedGraph(model.graph, expose) : model.graph;
		try {
			self.session = await open(graph, {
				executionProviders: ['cpu'], graphOptimizationLevel: 'all', ...QUIET_THREADS, ...session
			});
		} finally {
			if (graph !== model.graph) await rm(graph, { force: true });
		}
		return self;
	}

	/** Whether this session hands out inner tensors. */
	get exposes(): boolean {
		return this.exposed.length > 0;
	}

	async close(): Promise<void> {
		await this.session.release();
	}

	/** One chunk's outputs ([rows, width] each) from its [chunk, bins] features, left intact. */
	async chunk(features: Float32Array): Promise<Striker2Outputs> {
		return (await this.infer(Float32Array.from(features))).outputs;
	}

	/** Detaches `x`. */
	private async infer(x: Float32Array): Promise<{ outputs: Striker2Outputs; inner: Striker2Inner }> {
		const { chunk, input } = this.model;
		const out = await this.session.run(
			{ [input]: { data: x, dims: [1, chunk, x.length / chunk] } }, { transfer: true });
		const outputs = Object.fromEntries((Object.keys(OUTPUTS) as Striker2Output[])
			.map((name) => [name, checked(this.model, name, out[name])])) as Striker2Outputs;
		const inner: Striker2Inner = {};
		for (const name of this.exposed) if (out[name]) inner[name] = out[name];
		return { outputs, inner };
	}

	/**
	 * Whole-song outputs: each chunk's middle kept, activity held over its frames. `input(s)` is the
	 * zero-padded chunk from frame s; the next one is made while the session runs this one.
	 */
	private async stitched(
		frames: number, input: (start: number) => Float32Array, watch?: Striker2Watch, mono?: Float32Array
	): Promise<Striker2Outputs> {
		const { chunk, border, activityStride } = this.model;
		const starts = chunkStarts(frames, chunk, border);
		const merged = Object.fromEntries(Object.entries(OUTPUTS)
			.map(([name, width]) => [name, new Float32Array(frames * width)])) as Striker2Outputs;
		watch?.begin(frames, starts.length, mono);
		// The watch reads each chunk before infer detaches it.
		let next = input(starts[0]);
		watch?.input(0, starts[0], next);
		for (let c = 0; c < starts.length; c++) {
			const s = starts[c];
			const began = performance.now();
			const running = this.infer(next);
			running.catch(() => {});
			if (c + 1 < starts.length) {
				next = input(starts[c + 1]);
				watch?.input(c + 1, starts[c + 1], next);
			}
			const { outputs: out, inner } = await running;
			const ms = performance.now() - began;
			const lo = c === 0 ? 0 : border;
			const hi = Math.min(c === starts.length - 1 ? chunk : chunk - border, frames - s);
			for (const [name, width] of Object.entries(OUTPUTS) as [Striker2Output, number][]) {
				const stride = name === 'activity' ? activityStride : 1;
				for (let t = lo; t < hi; t++) {
					const row = Math.floor(t / stride) * width;
					merged[name].set(out[name].subarray(row, row + width), (s + t) * width);
				}
			}
			watch?.output(c, s, lo, hi, out, ms, inner);
		}
		return merged;
	}

	/** Whole-song outputs from [frames, bins] features. */
	async outputs(features: { data: Float32Array; frames: number; bins: number }): Promise<Striker2Outputs> {
		const { data, frames, bins } = features;
		const { chunk } = this.model;
		return this.stitched(frames, (s) => {
			const x = new Float32Array(chunk * bins);
			x.set(data.subarray(s * bins, Math.min(frames, s + chunk) * bins));
			return x;
		});
	}

	/** 44.1 kHz mono, (L + R) / 2, as ingest decodes it for the model; features chunk by chunk. */
	async run(mono: Float32Array, watch?: Striker2Watch): Promise<Striker2Result> {
		const front = new Striker2FrontEnd(mono, this.model.taps);
		const { chunk } = this.model;
		const { frames, bins, data } = front;
		return decodeStriker2(this.model, await this.stitched(frames, (s) => {
			const end = Math.min(frames, s + chunk);
			front.through(end);
			const x = new Float32Array(chunk * bins);
			x.set(data.subarray(s * bins, end * bins));
			return x;
		}, watch, mono));
	}
}
