import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	STRIKER2_OUTPUTS, Striker2, decodeStriker2, readStriker2, type Striker2Model, type Striker2Output,
	type Striker2Outputs, type Striker2Result
} from './striker2.ts';
import {
	RULE_P, checkParity, chunkFrames, compareEvents, readGolden, streamEqual, type GoldenChunk
} from './striker2Parity.ts';

const FIXTURE = join(import.meta.dirname, 'testdata', 'striker2');
const NAMES = Object.keys(STRIKER2_OUTPUTS) as Striker2Output[];

let model: Striker2Model;
let golden: GoldenChunk[];
let striker: Striker2;
beforeAll(async () => {
	model = await readStriker2(FIXTURE);
	golden = await readGolden(model);
	striker = await Striker2.create(model);
});
afterAll(async () => {
	await striker?.close();
});

const clone = (out: Striker2Outputs) =>
	Object.fromEntries(NAMES.map((name) => [name, Float32Array.from(out[name])])) as Striker2Outputs;

/** A runtime that answers each golden chunk with PyTorch's outputs, edited. */
function edited(edit: (out: Striker2Outputs, chunk: number) => void) {
	let calls = 0;
	return async () => {
		const chunk = calls++;
		const out = clone(golden[chunk].outputs);
		edit(out, chunk);
		return out;
	};
}

function add(out: Striker2Outputs, names: Striker2Output[], by: number) {
	for (const name of names) for (let i = 0; i < out[name].length; i++) out[name][i] += by;
}

describe('the golden chunks', () => {
	it('hold two chunks of features and PyTorch outputs, the second zero-padded after its music', () => {
		expect(golden.map((g) => [g.frames, g.features.length, g.outputs.activity.length]))
			.toEqual([[400, 400 * 179, 100 * 4], [151, 400 * 179, 100 * 4]]);
		expect(golden[1].features.subarray(151 * 179).every((v) => v === 0)).toBe(true);
		expect(golden[1].features.subarray(150 * 179, 151 * 179).some((v) => v !== 0)).toBe(true);
	});

	it('are refused when a file is missing, resized or changed', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'lightningstrike-golden-'));
		try {
			for (const name of await readdir(FIXTURE)) {
				if (name.startsWith('striker2.')) await copyFile(join(FIXTURE, name), join(dir, name));
			}
			const outputs = join(dir, 'striker2.golden1.outputs.f32');
			const bytes = await readFile(outputs);
			bytes[100] ^= 1;
			await writeFile(outputs, bytes);
			await expect(readGolden(await readStriker2(dir))).rejects.toThrow(`${outputs} does not match its SHA-256`);
			await writeFile(outputs, bytes.subarray(4));
			await expect(readGolden(await readStriker2(dir))).rejects.toThrow('has 97596 bytes, not 97600');
			await rm(outputs);
			await expect(readGolden(await readStriker2(dir))).rejects.toThrow(`${outputs} is missing`);
			await expect(readGolden({ ...model, golden: { problem: 'none listed' } })).rejects.toThrow('none listed');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('decode over their music only, activity held over its stride', () => {
		const song = chunkFrames(model, golden[1].outputs, 151);
		expect(song.drum_onset.length).toBe(151 * 18);
		expect(song.activity.length).toBe(151 * 4);
		expect([...song.activity.subarray(5 * 4, 6 * 4)]).toEqual([...golden[1].outputs.activity.subarray(4, 8)]);
		expect([...song.activity.subarray(150 * 4)]).toEqual([...golden[1].outputs.activity.subarray(37 * 4, 38 * 4)]);
	});
});

describe('Rule P', () => {
	it('passes this CPU against PyTorch on both chunks, every stream counted', async () => {
		const report = await checkParity(model, golden, (x) => striker.chunk(x));
		expect(report.verdict).toBe('pass');
		for (const name of NAMES) expect(report.maxAbs[name], name).toBeLessThan(1e-4);
		expect(Object.keys(report.events)).toEqual(['kick', 'snare', 'hat', 'cymbal', 'tom', 'beats', 'downbeats',
			'bass', 'activity.drums', 'activity.bass', 'activity.vocals', 'activity.other']);
		expect(Object.values(report.events).every(streamEqual)).toBe(true);
		for (const stream of ['kick', 'snare', 'hat', 'beats', 'bass']) {
			expect(report.events[stream].reference, stream).toBeGreaterThan(0);
		}
	});

	it('passes outputs moved by less than 1e-3', async () => {
		const report = await checkParity(model, golden, edited((out) => add(out, NAMES, 9e-4)));
		expect(report.verdict).toBe('pass');
		expect(report.maxAbs.drum_onset).toBeCloseTo(9e-4, 5);
	});

	it('calls outputs moved further than 1e-3 close when every event still matches, and does not pass them', async () => {
		const report = await checkParity(model, golden, edited((out) => add(out, ['drum_level', 'beat_offset'], 3e-3)));
		expect(report.verdict).toBe('close');
		expect(report.reason).toBe('every event matched, but drum_level differs by 3.0e-3, beat_offset differs by 3.0e-3'
			+ ' (Rule P allows 1.0e-3)');
		expect(Object.values(report.events).every(streamEqual)).toBe(true);
	});

	it('weighs the padding in the 1e-3 bar but decodes the music only', async () => {
		const report = await checkParity(model, golden, edited((out, chunk) => {
			if (chunk === 1) for (let i = 200 * 18; i < out.drum_onset.length; i++) out.drum_onset[i] = 30;
		}));
		expect(report.verdict).toBe('close');
		expect(report.maxAbs.drum_onset).toBeGreaterThan(20);
	});

	it('fails a runtime that loses one kick', async () => {
		const reference = decodeStriker2(model, chunkFrames(model, golden[0].outputs, 400));
		const frame = Math.round(reference.drums.kick.times[3] * 100);
		const report = await checkParity(model, golden, edited((out, chunk) => {
			if (chunk !== 0) return;
			for (let t = frame - 3; t <= frame + 3; t++) out.drum_onset[t * 18 + 13] = -10;
		}));
		expect(report.verdict).toBe('fail');
		expect(report.reason).toMatch(/^kick: \d+ of \d+ PyTorch events matched in \d+$/);
		expect(report.events.kick.candidate).toBe(report.events.kick.reference - 1);
		expect(report.events.kick.flips).toBe(1);
	});

	it('fails a runtime whose activity flips, or that returns a non-finite value', async () => {
		const flipped = await checkParity(model, golden, edited((out, chunk) => {
			if (chunk === 0) for (let row = 40; row < 44; row++) out.activity[row * 4 + 2] *= -1;
		}));
		expect(flipped.verdict).toBe('fail');
		expect(flipped.reason).toMatch(/^activity\.vocals: /);
		const nan = await checkParity(model, golden, edited((out, chunk) => {
			if (chunk === 1) out.bass[10] = NaN;
		}));
		expect(nan).toMatchObject({ verdict: 'fail', reason: 'bass is not finite on audio.s16 from 6.5 s' });
	});
});

describe('event comparison', () => {
	const result = (kick: number[], levels: number[]): Striker2Result => {
		const none = { times: [], levels: [] };
		return {
			name: 'x', beats: [], downbeats: [], bass: none,
			drums: { kick: { times: kick, levels }, snare: none, hat: none, cymbal: none, tom: none },
			activity: { drums: [[0, 1.5]], bass: [], vocals: [], other: [] }
		};
	};

	it('pairs events within one frame and levels within 0.01, counting the rest as flips', () => {
		const a = result([1, 2, 3], [0.35, 0.5, 0.9]);
		const kick = (times: number[], levels: number[]) => compareEvents(a, result(times, levels)).kick;
		expect(kick([1, 2, 3], [0.35, 0.5, 0.9])).toEqual({ reference: 3, candidate: 3, exact: 3, within: 3, flips: 0 });
		expect(kick([1.01, 1.99, 3], [0.34, 0.51, 0.9])).toEqual({ reference: 3, candidate: 3, exact: 1, within: 3, flips: 0 });
		expect(streamEqual(kick([1.011, 2, 3], [0.35, 0.5, 0.9]))).toBe(false);
		expect(kick([1.011, 2, 3], [0.35, 0.5, 0.9]).flips).toBe(2);
		expect(kick([1, 2, 3], [0.33, 0.5, 0.9])).toMatchObject({ within: 2, flips: 0 });
		expect(kick([1, 2, 2.5, 3], [0.35, 0.5, 0.7, 0.9])).toMatchObject({ within: 3, flips: 1 });
		expect(RULE_P).toEqual({ maxAbs: 1e-3, frame: 0.01, level: 0.01 });
	});
});
