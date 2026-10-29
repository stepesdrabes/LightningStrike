import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
	STRIKER2_OUTPUTS, decodeStriker2, type Striker2GoldenFile, type Striker2Model, type Striker2Output,
	type Striker2Outputs, type Striker2Result
} from './striker2.ts';
import { STRIKER2_CLASSES } from './striker2Decode.ts';

/**
 * Rule P (striker-2 research/2026-10-29-app-speed.md section 9): a runtime may run Striker 2.0 only
 * if, on every golden chunk, every output is finite and within `maxAbs` of PyTorch, and the app's
 * decoders find the same events: the same count in every stream, each within one frame (seconds)
 * and its level within `level`.
 */
export const RULE_P = { maxAbs: 1e-3, frame: 0.01, level: 0.01 } as const;

/** Rounded times and levels differ by a binary epsilon even when equal to two decimals. */
const SLACK = 1e-9;

const NAMES = Object.keys(STRIKER2_OUTPUTS) as Striker2Output[];

export interface GoldenChunk {
	source: string;
	frames: number;
	features: Float32Array;
	outputs: Striker2Outputs;
}

async function goldenBytes(file: Striker2GoldenFile): Promise<Float32Array> {
	const bytes = await readFile(file.path).catch(() => {
		throw new Error(`${file.path} is missing`);
	});
	if (bytes.length !== file.bytes) throw new Error(`${file.path} has ${bytes.length} bytes, not ${file.bytes}`);
	if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
		throw new Error(`${file.path} does not match its SHA-256`);
	}
	return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** The manifest's golden chunks, read and hash-checked; throws with the reason they cannot be used. */
export async function readGolden(model: Striker2Model): Promise<GoldenChunk[]> {
	if ('problem' in model.golden) throw new Error(model.golden.problem);
	return Promise.all(model.golden.chunks.map(async (chunk) => {
		const flat = await goldenBytes(chunk.outputs);
		const outputs = {} as Striker2Outputs;
		let at = 0;
		for (const name of NAMES) {
			const rows = name === 'activity' ? model.chunk / model.activityStride : model.chunk;
			outputs[name] = flat.subarray(at, at + rows * STRIKER2_OUTPUTS[name]);
			at += rows * STRIKER2_OUTPUTS[name];
		}
		return { source: chunk.source, frames: chunk.frames, features: await goldenBytes(chunk.features), outputs };
	}));
}

/** A chunk's outputs as whole-song outputs over its first `frames` frames, activity held. */
export function chunkFrames(model: Striker2Model, out: Striker2Outputs, frames: number): Striker2Outputs {
	const song = {} as Striker2Outputs;
	for (const name of NAMES) {
		const width = STRIKER2_OUTPUTS[name];
		if (name !== 'activity') {
			song[name] = out[name].slice(0, frames * width);
			continue;
		}
		song[name] = new Float32Array(frames * width);
		for (let t = 0; t < frames; t++) {
			const row = Math.floor(t / model.activityStride) * width;
			song[name].set(out[name].subarray(row, row + width), t * width);
		}
	}
	return song;
}

/** One stream's events: `reference` against `candidate`, paired in time order within a frame. */
export interface StreamComparison {
	reference: number;
	candidate: number;
	/** Pairs with equal time and level. */
	exact: number;
	/** Pairs within one frame and the level tolerance. */
	within: number;
	/** Events left without a partner within one frame, on either side. */
	flips: number;
}

function compareStream(
	a: readonly number[], b: readonly number[], la?: readonly number[], lb?: readonly number[]
): StreamComparison {
	let [i, j, pairs, exact, within] = [0, 0, 0, 0, 0];
	while (i < a.length && j < b.length) {
		const shift = a[i] - b[j];
		if (Math.abs(shift) > RULE_P.frame + SLACK) {
			if (shift < 0) i++;
			else j++;
			continue;
		}
		const level = la && lb ? Math.abs(la[i] - lb[j]) : 0;
		pairs++;
		if (level <= RULE_P.level + SLACK) within++;
		if (shift === 0 && level === 0) exact++;
		i++;
		j++;
	}
	return { reference: a.length, candidate: b.length, exact, within, flips: a.length + b.length - 2 * pairs };
}

export const streamEqual = (s: StreamComparison) => s.reference === s.candidate && s.within === s.reference;

/** Every stream the app reads, compared: drum classes, beats, downbeats, bass, activity edges. */
export function compareEvents(a: Striker2Result, b: Striker2Result): Record<string, StreamComparison> {
	const out: Record<string, StreamComparison> = {};
	for (const cls of STRIKER2_CLASSES) {
		out[cls] = compareStream(a.drums[cls].times, b.drums[cls].times, a.drums[cls].levels, b.drums[cls].levels);
	}
	out.beats = compareStream(a.beats, b.beats);
	out.downbeats = compareStream(a.downbeats, b.downbeats);
	out.bass = compareStream(a.bass.times, b.bass.times, a.bass.levels, b.bass.levels);
	for (const [stem, spans] of Object.entries(a.activity)) {
		const edges = (s: [number, number][]) => s.flat();
		out[`activity.${stem}`] = compareStream(edges(spans), edges(b.activity[stem as keyof typeof b.activity]));
	}
	return out;
}

/** Adds each stream's counts of `next` into `sum`. */
export function addComparisons(sum: Record<string, StreamComparison>, next: Record<string, StreamComparison>) {
	for (const [stream, s] of Object.entries(next)) {
		const t = (sum[stream] ??= { reference: 0, candidate: 0, exact: 0, within: 0, flips: 0 });
		t.reference += s.reference;
		t.candidate += s.candidate;
		t.exact += s.exact;
		t.within += s.within;
		t.flips += s.flips;
	}
}

export type ParityVerdict = 'pass' | 'close' | 'fail';

export interface ParityReport {
	/** `close`: every event equal, but some output further than RULE_P.maxAbs from PyTorch. */
	verdict: ParityVerdict;
	reason?: string;
	/** Largest absolute difference from PyTorch per output, over every golden chunk. */
	maxAbs: Partial<Record<Striker2Output, number>>;
	/** Each stream's events, PyTorch's (reference) against the runtime's, summed over the chunks. */
	events: Record<string, StreamComparison>;
}

const gap = (v: number) => v.toExponential(1);

/** Rule P over the golden chunks, `run` giving a runtime's outputs for one chunk's features. */
export async function checkParity(
	model: Striker2Model, golden: GoldenChunk[], run: (features: Float32Array) => Promise<Striker2Outputs>
): Promise<ParityReport> {
	const maxAbs: ParityReport['maxAbs'] = {};
	const events: Record<string, StreamComparison> = {};
	const problems: string[] = [];
	for (const chunk of golden) {
		const got = await run(chunk.features);
		for (const name of NAMES) {
			const [x, y] = [got[name], chunk.outputs[name]];
			let worst = maxAbs[name] ?? 0;
			for (let i = 0; i < y.length; i++) {
				const d = Math.abs(x[i] - y[i]);
				if (!(d <= worst)) worst = Number.isNaN(d) ? Infinity : d;
			}
			maxAbs[name] = worst;
			if (!Number.isFinite(worst)) problems.push(`${name} is not finite on ${chunk.source}`);
		}
		const reference = decodeStriker2(model, chunkFrames(model, chunk.outputs, chunk.frames));
		const candidate = decodeStriker2(model, chunkFrames(model, got, chunk.frames));
		addComparisons(events, compareEvents(reference, candidate));
	}
	for (const [stream, s] of Object.entries(events)) {
		if (!streamEqual(s)) {
			problems.push(`${stream}: ${s.within} of ${s.reference} PyTorch events matched in ${s.candidate}`);
		}
	}
	if (problems.length > 0) return { verdict: 'fail', reason: problems.join('; '), maxAbs, events };
	const far = NAMES.filter((name) => (maxAbs[name] ?? 0) > RULE_P.maxAbs);
	if (far.length === 0) return { verdict: 'pass', maxAbs, events };
	const reason = `every event matched, but ${far.map((n) => `${n} differs by ${gap(maxAbs[n]!)}`).join(', ')}`
		+ ` (Rule P allows ${gap(RULE_P.maxAbs)})`;
	return { verdict: 'close', reason, maxAbs, events };
}
