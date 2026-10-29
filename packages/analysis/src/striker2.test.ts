import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	STRIKER2_MANIFEST, Striker2, decodeStriker2, readStriker2, type Striker2Model, type Striker2Output,
	type Striker2Outputs
} from './striker2.ts';
import { DBN, dbnBeats, dbnIntervals } from './striker2Dbn.ts';
import { STRIKER2_CLASSES, roundLevel, sigmoid32 } from './striker2Decode.ts';
import { striker2Features } from './striker2Frontend.ts';
import { openSession } from './onnxSession.ts';

// Written by striker-2's tools/m7_fixtures.py: a tiny random network, its PyTorch outputs and
// Python's decoded events.
const FIXTURE = join(import.meta.dirname, 'testdata', 'striker2');
const expected = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8'));
const NAMES = Object.keys(expected.widths) as Striker2Output[];

function f32(name: string): Float32Array {
	const buf = readFileSync(join(FIXTURE, name));
	return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function heads(prefix: string): Record<Striker2Output, Float32Array> {
	return Object.fromEntries(NAMES.map((name) => [name, f32(`${prefix}.${name}.f32`)])) as Striker2Outputs;
}

function mono(): Float32Array {
	const buf = readFileSync(join(FIXTURE, 'audio.s16'));
	return Float32Array.from({ length: buf.length / 2 }, (_, i) => buf.readInt16LE(2 * i) / 32768);
}

function largest(a: Float32Array, b: Float32Array): number {
	expect(a.length).toBe(b.length);
	let worst = 0;
	for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
	return worst;
}

let model: Striker2Model;
let striker: Striker2;
beforeAll(async () => {
	model = await readStriker2(FIXTURE);
	striker = await Striker2.create(model);
});
afterAll(async () => {
	await striker?.close();
});

describe('Striker 2.0 front end', () => {
	it('computes what PyTorch computes, within 1e-4', () => {
		const features = striker2Features(mono(), model.taps);
		expect([features.frames, features.bins]).toEqual([expected.frames, expected.bins]);
		expect(largest(features.data, f32('features.f32'))).toBeLessThan(1e-4);
	});
});

describe('Striker 2.0 graph', () => {
	it('runs one chunk as PyTorch does', async () => {
		const x = new Float32Array(expected.chunk * expected.bins);
		x.set(f32('features.f32').subarray(0, x.length));
		const options = { executionProviders: ['cpu'], graphOptimizationLevel: 'all' };
		const session = await openSession(model.graph, options);
		const out = await session.run({ features: { data: x, dims: [1, expected.chunk, expected.bins] } });
		for (const name of NAMES) expect(largest(out[name].data, f32(`chunk.${name}.f32`)), name).toBeLessThan(1e-4);
		await session.release();
	});

	it('stitches chunks with their borders as evaluate.chunked does', async () => {
		const features = { data: f32('features.f32'), frames: expected.frames, bins: expected.bins };
		const golden = heads('outputs');
		const got = await striker.outputs(features);
		for (const name of NAMES) expect(largest(got[name], golden[name]), name).toBeLessThan(1e-4);
		const fromAudio = await striker.outputs(striker2Features(mono(), model.taps));
		for (const name of NAMES) expect(largest(fromAudio[name], golden[name]), name).toBeLessThan(1e-3);
	});

	it('returns every stream from one call', async () => {
		const result = await striker.run(mono());
		expect(result.name).toBe(model.name);
		expect(Object.keys(result.drums)).toEqual([...STRIKER2_CLASSES]);
		expect(Object.keys(result.activity)).toEqual(['drums', 'bass', 'vocals', 'other']);
		expect(result.downbeats.every((d) => result.beats.includes(d))).toBe(true);
	});
});

describe('Striker 2.0 decoding', () => {
	const decoded = () => decodeStriker2(model, heads('decode'));

	it('picks drum hits, levels and times exactly as Python does', () => {
		const { drums } = decoded();
		for (const cls of STRIKER2_CLASSES) {
			expect(drums[cls].times, cls).toEqual(expected.decode.drums[cls].times);
			expect(drums[cls].levels, cls).toEqual(expected.decode.drums[cls].levels);
		}
	});

	it('floors every level at 0.02 so a crossed level never reads as missing', () => {
		const { drums, bass } = decoded();
		const kick = drums.kick.times.findIndex((t) => Math.abs(t - 1) <= 0.025);
		expect(drums.kick.levels[kick]).toBe(0.02);
		for (const stream of [...Object.values(drums), bass]) {
			expect(Math.min(...stream.levels)).toBeGreaterThanOrEqual(0.02);
		}
	});

	it('takes the first frame of a saturated plateau, as numpy float32 does', () => {
		expect(sigmoid32(17)).toBe(1);
		expect(sigmoid32(40)).toBe(1);
		expect(decoded().drums.snare.times.filter((t) => t > 2.95 && t < 3.05)).toEqual(
			expected.decode.drums.snare.times.filter((t: number) => t > 2.95 && t < 3.05));
		expect([0.125, 0.375, 0.625, 0.875].map(roundLevel)).toEqual([0.12, 0.38, 0.62, 0.88]);
	});

	it('decodes bass onsets and activity spans as Python does', () => {
		const { bass, activity } = decoded();
		expect(bass).toEqual(expected.decode.bass);
		expect(activity).toEqual(expected.decode.activity);
	});

	it('finds the DBN beats and downbeats Python finds, every downbeat one of the beats', () => {
		const { beats, downbeats } = decoded();
		expect(beats).toEqual(expected.decode.beats);
		expect(downbeats).toEqual(expected.decode.downbeats);
		const cases = Object.entries(expected.dbn.cases) as [string, { beats: number[]; downbeats: number[] }][];
		for (const [name, want] of cases) {
			const rows = f32(`dbn-${name}.f32`);
			const frames = rows.length / 3;
			const beat = Float32Array.from({ length: 2 * frames }, (_, i) => rows[3 * (i >> 1) + (i & 1)]);
			const offset = Float32Array.from({ length: frames }, (_, t) => rows[3 * t + 2]);
			const got = dbnBeats(beat, offset);
			expect(got.beats, name).toEqual(want.beats);
			expect(got.downbeats, name).toEqual(want.downbeats);
			expect(got.downbeats.every((d) => got.beats.includes(d))).toBe(true);
		}
		expect(dbnIntervals(6000 / DBN.maxBpm, 6000 / DBN.minBpm, DBN.tempi)).toEqual(expected.dbn.taus);
	});
});

describe('Striker 2.0 manifest', () => {
	let dir: string;
	const manifest = () => JSON.parse(readFileSync(join(FIXTURE, STRIKER2_MANIFEST), 'utf8'));
	const install = async (edit: (m: Record<string, any>) => void = () => {}) => {
		const m = manifest();
		edit(m);
		await writeFile(join(dir, STRIKER2_MANIFEST), JSON.stringify(m));
	};
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'lightningstrike-striker2-'));
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('reads the thresholds, gaps and chunking the run chose, and notes an unchecked runtime', async () => {
		expect(model.drums.rules.kick).toEqual({ threshold: 0.55, gap: 5, reach: 2.5 });
		expect(model.drums.rules.tom.threshold).toBe(0.7);
		expect(model.bass).toEqual({ threshold: 0.5, gap: 4, reach: 2.5 });
		expect([model.chunk, model.border, model.activityStride, model.levelFloor]).toEqual([400, 50, 4, 0.02]);
		expect(model.warnings).toEqual(['no onnxruntime-node parity check is recorded for this graph']);
	});

	it('refuses a graph whose bytes do not match the recorded SHA-256 or size', async () => {
		await install();
		const graph = await readFile(join(FIXTURE, 'striker2.onnx'));
		graph[graph.length >> 1] ^= 1;
		await writeFile(join(dir, 'striker2.onnx'), graph);
		await expect(readStriker2(dir)).rejects.toThrow('does not match its SHA-256');
		await writeFile(join(dir, 'striker2.onnx'), graph.subarray(1));
		await expect(readStriker2(dir)).rejects.toThrow('bytes');
		await rm(join(dir, 'striker2.onnx'));
		await expect(readStriker2(dir)).rejects.toThrow('missing');
	});

	it('refuses a changed FIR, front end or format it cannot honour', async () => {
		await copyFile(join(FIXTURE, 'striker2.onnx'), join(dir, 'striker2.onnx'));
		await install();
		await expect(readStriker2(dir)).resolves.toMatchObject({ name: model.name });
		await install((m) => {
			m.front_end.b.fir_f32le_base64 = `AAAAAA${m.front_end.b.fir_f32le_base64.slice(6)}`;
		});
		await expect(readStriker2(dir)).rejects.toThrow('FIR');
		await install((m) => { m.front_end.b.per_octave = 12; });
		await expect(readStriker2(dir)).rejects.toThrow('front_end.b');
		await install((m) => { m.format = 'striker2-model-v2'; });
		await expect(readStriker2(dir)).rejects.toThrow('format');
		await install((m) => { m.decoding.drums.threshold.snare = 'high'; });
		await expect(readStriker2(dir)).rejects.toThrow('snare threshold');
		await writeFile(join(dir, STRIKER2_MANIFEST), '{"format": "striker2-model"');
		await expect(readStriker2(dir)).rejects.toThrow('not JSON');
	});

	it('keeps its name whatever an older manifest says about beats, and notes another runtime', async () => {
		await install((m) => { m.app = { beats: 'striker2' }; m.checked.onnxruntime_node = '0.0.1'; });
		const older = await readStriker2(dir);
		expect(older.name).toBe(model.name);
		expect(older.warnings).toEqual([expect.stringMatching(/^checked with onnxruntime-node 0\.0\.1, running /)]);
	});
});
