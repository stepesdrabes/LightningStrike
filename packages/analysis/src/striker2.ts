import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ACTIVITY_STEMS, type ActivityStem, type OnsetStream } from '@mv/core';
import { hashFile } from './cpuGraphCache.ts';
import type { DrumStream } from './drums.ts';
import { QUIET_THREADS, openSession, type OnnxSession, type OpenSession } from './onnxSession.ts';
import {
	STRIKER2_CLASSES, activitySpans, bassOnsets, coarseHits, type PeakRule, type Striker2Class
} from './striker2Decode.ts';
import { dbnBeats } from './striker2Dbn.ts';
import { STRIKER2_FRONT_END, striker2Features } from './striker2Frontend.ts';

/** Striker 2.0 (striker-2 `python -m striker.export`): this manifest beside its graph. */
export const STRIKER2_MANIFEST = 'striker2.json';

/** Each graph output's width; activity runs at 100 / `activity_stride` fps. */
const OUTPUTS = {
	drum_onset: 18, drum_offset: 18, drum_level: 18, beat: 2, beat_offset: 1, bass: 3, activity: 4
} as const;
export type Striker2Output = keyof typeof OUTPUTS;
export type Striker2Outputs = Record<Striker2Output, Float32Array>;

export interface Striker2Model {
	/** The manifest's name, `<release> (<first 8 hex of the graph's SHA-256>)`; analyses record it. */
	name: string;
	graph: string;
	input: string;
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
	drums: Record<Striker2Class, DrumStream>;
	/** DBN beats and downbeats, seconds to 1 ms, every downbeat one of the beats. */
	beats: number[];
	downbeats: number[];
	bass: OnsetStream;
	activity: Record<ActivityStem, [number, number][]>;
}

type Json = Record<string, unknown>;

function fail(what: string): never {
	throw new Error(`${STRIKER2_MANIFEST}: ${what}`);
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

function runtimeVersion(): string | null {
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

/** A parsed manifest, before the graph's hash is checked. Throws on anything the app cannot honour. */
export function parseStriker2Manifest(
	json: unknown, dir: string
): Striker2Model & { sha256: string; bytes: number } {
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
		name: m.name, graph: join(dir, m.file), input: graph.input, chunk, border, activityStride, taps: firTaps(fir),
		drums: { firstColumn, rules }, bass: rule(bass, 'decoding.bass'), levelFloor,
		warnings: warnings(m.checked === undefined ? {} : object(m.checked, 'checked')),
		sha256: m.sha256, bytes
	};
}

/** Reads and verifies `striker2.json` in `dir` and the graph it names (size and SHA-256). */
export async function readStriker2(dir: string): Promise<Striker2Model> {
	const text = await readFile(join(dir, STRIKER2_MANIFEST), 'utf8');
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (e) {
		fail(`not JSON (${e instanceof Error ? e.message : String(e)})`);
	}
	const { sha256, bytes, ...model } = parseStriker2Manifest(json, dir);
	const size = (await stat(model.graph).catch(() => fail(`${model.graph} is missing`))).size;
	if (size !== bytes) fail(`the graph has ${size} bytes, the manifest ${bytes}`);
	if (await hashFile(model.graph) !== sha256) fail('the graph does not match its SHA-256');
	return model;
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

export class Striker2 {
	private session!: OnnxSession;
	private model!: Striker2Model;

	static async create(model: Striker2Model, open: OpenSession = openSession): Promise<Striker2> {
		const self = new Striker2();
		self.model = model;
		self.session = await open(model.graph, {
			executionProviders: ['cpu'], graphOptimizationLevel: 'all', ...QUIET_THREADS
		});
		return self;
	}

	async close(): Promise<void> {
		await this.session.release();
	}

	/** Whole-song outputs from features: each chunk's middle kept; activity held over its frames. */
	async outputs(features: { data: Float32Array; frames: number; bins: number }): Promise<Striker2Outputs> {
		const { chunk, border, input, activityStride } = this.model;
		const { data, frames, bins } = features;
		const starts = chunkStarts(frames, chunk, border);
		const merged = Object.fromEntries(Object.entries(OUTPUTS)
			.map(([name, width]) => [name, new Float32Array(frames * width)])) as Striker2Outputs;
		for (let c = 0; c < starts.length; c++) {
			const s = starts[c];
			const x = new Float32Array(chunk * bins);
			x.set(data.subarray(s * bins, Math.min(frames, s + chunk) * bins));
			const out = await this.session.run({ [input]: { data: x, dims: [1, chunk, bins] } }, { transfer: true });
			const lo = c === 0 ? 0 : border;
			const hi = Math.min(c === starts.length - 1 ? chunk : chunk - border, frames - s);
			for (const [name, width] of Object.entries(OUTPUTS) as [Striker2Output, number][]) {
				const stride = name === 'activity' ? activityStride : 1;
				const got = out[name];
				if (!got || got.dims.join() !== [1, chunk / stride, width].join()) {
					throw new Error(`Striker 2.0's graph returned ${name} as [${got?.dims.join(', ')}]`);
				}
				for (let t = lo; t < hi; t++) {
					const row = Math.floor(t / stride) * width;
					merged[name].set(got.data.subarray(row, row + width), (s + t) * width);
				}
			}
		}
		return merged;
	}

	/** 44.1 kHz mono, (L + R) / 2, as ingest decodes it for the model. */
	async run(mono: Float32Array): Promise<Striker2Result> {
		return decodeStriker2(this.model, await this.outputs(striker2Features(mono, this.model.taps)));
	}
}
