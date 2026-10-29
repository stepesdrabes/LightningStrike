import { describe, expect, it } from 'vitest';
import { HEARING_HEADS, readHearing } from '@mv/core';
import type { Striker2Model, Striker2Outputs } from './striker2.ts';
import { STRIKER2_OUTPUTS } from './striker2.ts';
import { GLIMPSE_COLS, Striker2Recorder, type Striker2Glimpse } from './striker2View.ts';

const CHUNK = 40;
const BINS = 179;
const model = { name: 'test (00000000)', chunk: CHUNK, activityStride: 4, drums: { firstColumn: 13 } } as Striker2Model;

/** Outputs whose every logit is `logit`, except kick's onset at the frames given (a sure hit). */
function outputs(logit: number, kicks: number[] = []): Striker2Outputs {
	const out = Object.fromEntries(Object.entries(STRIKER2_OUTPUTS).map(([name, width]) => {
		const rows = name === 'activity' ? CHUNK / 4 : CHUNK;
		return [name, new Float32Array(rows * width).fill(logit)];
	})) as Striker2Outputs;
	for (const t of kicks) out.drum_onset[t * STRIKER2_OUTPUTS.drum_onset + 13] = 20;
	return out;
}

describe('recording what Striker 2.0 heard', () => {
	it('keeps only the frames each chunk owns, and the loudest band of each pair', () => {
		const recorder = new Striker2Recorder(model);
		recorder.begin(60, 2);
		const x = new Float32Array(CHUNK * BINS);
		x[3 * BINS + 0] = 1.3; // frame 3, branch A's lowest band: half the ceiling
		x[3 * BINS + 1] = 2.6; // its pair, at the ceiling: the row keeps this one
		recorder.input(0, 0, x);
		recorder.output(0, 0, 0, 30, outputs(-20, [5, 35]), 12);
		recorder.output(1, 20, 10, 40, outputs(-20, [22]), 12);
		const { header, features, heads } = readHearing(recorder.bytes());
		const height = header.featureRows.a + header.featureRows.b;
		expect(header.featureRows).toEqual({ a: 42, b: 48 });
		expect(features[1 * height + 0]).toBe(255);
		const kick = (f: number) => heads[f * HEARING_HEADS.length];
		// Chunk 0's frame 35 lies in its border, which chunk 1 owns; chunk 1's frame 22 is song frame 42.
		expect([kick(5), kick(35), kick(42)]).toEqual([255, 0, 255]);
	});

	it('records a layer\'s real activations in standard deviations, and sends their summary live', () => {
		const seen: Striker2Glimpse[] = [];
		const source = {
			graph: '', links: [],
			spaces: [{ width: 2, hz: 100 }],
			layers: [{ id: 'hi.0', stage: 'hi', space: 0, tensor: 'h' }]
		};
		const recorder = new Striker2Recorder(model, (g) => seen.push(g), source);
		// Channel 0 swings +1, -1 around 0, a deviation of 1; channel 1 never moves.
		const data = new Float32Array(CHUNK * 2);
		for (let f = 0; f < CHUNK; f++) data[f * 2] = f % 2 ? -1 : 1;
		recorder.begin(CHUNK, 1);
		recorder.output(0, 0, 0, CHUNK, outputs(-20), 5, { h: { data, dims: [1, CHUNK, 2] } });
		const { header, inner } = readHearing(recorder.bytes());
		expect(header.inner?.spaces[0].channels).toEqual([0, 1]);
		expect([inner[0], inner[1]]).toEqual([128 + 32, 128]);
		const out = seen.find((g) => g.kind === 'output') as Extract<Striker2Glimpse, { kind: 'output' }>;
		expect(out.structure?.layers.map((l) => l.id)).toEqual(['hi.0']);
		expect(out.inner.length).toBe(24 * 1 * 12);
	});

	it('tells the view each chunk as it goes in and comes out, one column a pixel', () => {
		const seen: Striker2Glimpse[] = [];
		const recorder = new Striker2Recorder(model, (g) => seen.push(g));
		// A square wave at half scale: every column of its waveform spans -0.5 to 0.5.
		const mono = Float32Array.from({ length: 30 * 441 }, (_, i) => (i % 2 ? 0.5 : -0.5));
		recorder.begin(30, 1, mono);
		recorder.input(0, 0, new Float32Array(CHUNK * BINS));
		recorder.output(0, 0, 0, 30, outputs(0), 7);
		expect(seen.map((g) => g.kind)).toEqual(['begin', 'input', 'output']);
		const input = seen[1] as Extract<Striker2Glimpse, { kind: 'input' }>;
		expect(input.wave.length).toBe(GLIMPSE_COLS * 2);
		expect([input.wave[0], input.wave[1]]).toEqual([64, 191]);
		const out = seen[2] as Extract<Striker2Glimpse, { kind: 'output' }>;
		expect([out.frames, out.cols, out.ms, out.heads.length]).toEqual([30, GLIMPSE_COLS, 7, GLIMPSE_COLS * 14]);
		// A logit of 0 is a probability of a half.
		expect(out.heads[0]).toBe(128);
	});
});
