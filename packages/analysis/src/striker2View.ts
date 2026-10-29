import {
	ACTIVITY_STEMS, HEARING_FORMAT, HEARING_HEADS, HEARING_VERSION, hearingSizes, writeHearing,
	type Hearing, type HearingHeader, type HearingInner
} from '@mv/core';
import type { Striker2Inner, Striker2Model, Striker2Outputs } from './striker2.ts';
import { InnerRecorder, type InnerReadout, type InnerSource } from './striker2Inner.ts';
import { STRIKER2_OUTPUTS } from './striker2.ts';
import { sigmoid32 } from './striker2Decode.ts';
import { STRIKER2_FRONT_END } from './striker2Frontend.ts';

/** Sees each chunk enter and leave the graph. It reads the arrays it is given and never changes them. */
export interface Striker2Watch {
	/** `mono` is the 44.1 kHz audio the features come from, when the run has it. */
	begin(frames: number, chunks: number, mono?: Float32Array): void;
	/** Before the chunk from song frame `start` runs; `features` is [chunk, bins], zeros past the song. */
	input(index: number, start: number, features: Float32Array): void;
	/** After it ran; the song keeps its frames [lo, hi). `inner` holds the tensors the session exposes. */
	output(
		index: number, start: number, lo: number, hi: number, out: Striker2Outputs, ms: number, inner?: Striker2Inner
	): void;
}

/** What the model view is told while a song prepares; columns span the chunk's music. */
export type Striker2Glimpse =
	| { kind: 'begin'; frames: number; chunks: number; chunk: number; fps: number }
	| {
		kind: 'input'; index: number; start: number; frames: number; cols: number; features: Uint8Array;
		/** The chunk's waveform: a column's minimum then maximum, -1..1 as 0..255; empty without audio. */
		wave: Uint8Array;
	}
	| {
		kind: 'output'; index: number; start: number; frames: number; cols: number; ms: number;
		heads: Uint8Array; activity: Uint8Array;
		/** Real activations, [INNER_COLS][layers][k] as signed bytes; empty when not exposed. */
		inner: Uint8Array;
		/** The kept neurons and the weights between them, from the first chunk on. */
		structure: HearingInner | null;
	};

const { fps: FPS, bins: BINS, a: { bands: BRANCH_A } } = STRIKER2_FRONT_END;
/** The front end's log10(1 + x) features stay below this on loud masters (golden chunks: 2.58). */
const FEATURE_CEILING = 2.6;
const FEATURE_STEP = 2;
/** Columns a live chunk is drawn with: about one a pixel across the rail. */
export const GLIMPSE_COLS = 360;

const byte = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));

/** Rows pair adjacent bands of each branch (A's first, then B's), keeping the louder. */
const ROWS = (() => {
	const a = Math.ceil(BRANCH_A / 2);
	const b = Math.ceil((BINS - BRANCH_A) / 2);
	const row = new Uint16Array(BINS);
	for (let k = 0; k < BINS; k++) row[k] = k < BRANCH_A ? k >> 1 : a + ((k - BRANCH_A) >> 1);
	return { a, b, row };
})();

/** The probability columns the heads come from, in `HEARING_HEADS` order. */
function headSources(model: Striker2Model): [keyof Striker2Outputs, number][] {
	const first = model.drums.firstColumn;
	const coarse = [0, 1, 2, 3, 4].map((i) => first + i);
	return [
		...coarse.map((c): [keyof Striker2Outputs, number] => ['drum_onset', c]),
		...coarse.map((c): [keyof Striker2Outputs, number] => ['drum_level', c]),
		['beat', 0], ['beat', 1], ['bass', 0], ['bass', 2]
	];
}

/** The output neurons the model view draws. */
const READOUT_HEADS = ['kick', 'snare', 'hat', 'cymbal', 'tom', 'beat', 'downbeat', 'bass'] as const;

/** Where the drawn output neurons sit in the head whose weights split into the drum outputs. */
function readoutOf(source: InnerSource, sources: [keyof Striker2Outputs, number][]): InnerReadout | null {
	const readout = source.readouts?.find((r) => r.outputs.includes('drum_onset'));
	if (!readout) return null;
	const offset = (name: string) => {
		let at = 0;
		for (const o of readout.outputs) {
			if (o === name) return at;
			at += STRIKER2_OUTPUTS[o as keyof Striker2Outputs] ?? NaN;
		}
		return NaN;
	};
	const heads = READOUT_HEADS.map((h) => HEARING_HEADS.indexOf(h));
	const columns = heads.map((h) => offset(sources[h][0]) + sources[h][1]);
	return columns.every((c) => c >= 0 && c < (readout.dims[1] ?? 0)) ? { readout, heads, columns } : null;
}

/**
 * Records a run for the model view: a glimpse of every chunk as it goes in and comes out, and the
 * whole song at full time resolution for replay. Reads only what the graph was given and returned.
 */
export class Striker2Recorder implements Striker2Watch {
	private readonly model: Striker2Model;
	private readonly glimpse?: (g: Striker2Glimpse) => void;
	private readonly sources: [keyof Striker2Outputs, number][];
	private frames = 0;
	private mono: Float32Array | null = null;
	private features = new Uint8Array(0);
	private heads = new Uint8Array(0);
	private activity = new Uint8Array(0);
	private readonly inner: InnerRecorder | null;

	/** `source` names the inner tensors to record; the session must expose them. */
	constructor(model: Striker2Model, glimpse?: (g: Striker2Glimpse) => void, source?: InnerSource) {
		this.model = model;
		this.glimpse = glimpse;
		this.sources = headSources(model);
		this.inner = source ? new InnerRecorder(source, FPS, readoutOf(source, this.sources)) : null;
	}

	begin(frames: number, chunks: number, mono?: Float32Array): void {
		this.frames = frames;
		this.mono = mono ?? null;
		const sizes = hearingSizes(this.header());
		this.features = new Uint8Array(sizes.features);
		this.heads = new Uint8Array(sizes.heads);
		this.activity = new Uint8Array(sizes.activity);
		this.inner?.begin(frames);
		this.glimpse?.({ kind: 'begin', frames, chunks, chunk: this.model.chunk, fps: FPS });
	}

	input(index: number, start: number, x: Float32Array): void {
		const music = Math.min(this.model.chunk, this.frames - start);
		const height = ROWS.a + ROWS.b;
		const glimpse = this.glimpse ? new Uint8Array(GLIMPSE_COLS * height) : null;
		for (let t = 0; t < music; t++) {
			const song = ((start + t) / FEATURE_STEP | 0) * height;
			const live = glimpse ? Math.min(GLIMPSE_COLS - 1, (t * GLIMPSE_COLS / music) | 0) * height : 0;
			for (let k = 0; k < BINS; k++) {
				const v = byte(x[t * BINS + k] / FEATURE_CEILING);
				const r = ROWS.row[k];
				if (v > this.features[song + r]) this.features[song + r] = v;
				if (glimpse && v > glimpse[live + r]) glimpse[live + r] = v;
			}
		}
		if (glimpse) {
			this.glimpse!({
				kind: 'input', index, start, frames: music, cols: GLIMPSE_COLS, features: glimpse, wave: this.wave(start, music)
			});
		}
	}

	/** The audio under a chunk's music, as each column's minimum and maximum. */
	private wave(start: number, music: number): Uint8Array {
		const mono = this.mono;
		if (!mono) return new Uint8Array(0);
		const hop = STRIKER2_FRONT_END.hop;
		const wave = new Uint8Array(GLIMPSE_COLS * 2);
		const from = start * hop;
		const length = Math.min(music * hop, mono.length - from);
		const level = (v: number) => byte((v + 1) / 2);
		for (let c = 0; c < GLIMPSE_COLS; c++) {
			const a = from + Math.floor((c * length) / GLIMPSE_COLS);
			const b = from + Math.floor(((c + 1) * length) / GLIMPSE_COLS);
			let lo = 0;
			let hi = 0;
			for (let s = a; s < b; s++) {
				const v = mono[s];
				if (v < lo) lo = v;
				else if (v > hi) hi = v;
			}
			wave[c * 2] = level(lo);
			wave[c * 2 + 1] = level(hi);
		}
		return wave;
	}

	output(
		index: number, start: number, lo: number, hi: number, out: Striker2Outputs, ms: number, inner?: Striker2Inner
	): void {
		const live = this.inner?.chunk(start, lo, hi, Math.min(this.model.chunk, this.frames - start), inner) ?? null;
		const width = this.sources.length;
		const music = Math.min(this.model.chunk, this.frames - start);
		const stride = this.model.activityStride;
		const stems = ACTIVITY_STEMS.length;
		const heads = this.glimpse ? new Uint8Array(GLIMPSE_COLS * width) : null;
		const activity = this.glimpse ? new Uint8Array(GLIMPSE_COLS * stems) : null;
		for (let t = 0; t < music; t++) {
			const kept = t >= lo && t < hi;
			const col = Math.min(GLIMPSE_COLS - 1, (t * GLIMPSE_COLS / music) | 0);
			for (let h = 0; h < width; h++) {
				const [name, column] = this.sources[h];
				const v = byte(sigmoid32(out[name][t * STRIKER2_OUTPUTS[name] + column]));
				if (kept) this.heads[(start + t) * width + h] = v;
				if (heads && v > heads[col * width + h]) heads[col * width + h] = v;
			}
			if (t % stride !== 0) continue;
			for (let s = 0; s < stems; s++) {
				const v = byte(sigmoid32(out.activity[(t / stride) * stems + s]));
				if (kept) this.activity[((start + t) / stride) * stems + s] = v;
				if (activity && v > activity[col * stems + s]) activity[col * stems + s] = v;
			}
		}
		if (heads && activity) {
			this.glimpse!({
				kind: 'output', index, start, frames: music, cols: GLIMPSE_COLS, ms, heads, activity,
				inner: live ?? new Uint8Array(0), structure: live ? this.inner!.header() : null
			});
		}
	}

	private header(): HearingHeader {
		return {
			format: HEARING_FORMAT, version: HEARING_VERSION, model: this.model.name, frames: this.frames, fps: FPS,
			featureStep: FEATURE_STEP, featureRows: { a: ROWS.a, b: ROWS.b }, featureCeiling: FEATURE_CEILING,
			heads: HEARING_HEADS, activityStride: this.model.activityStride, stems: ACTIVITY_STEMS,
			inner: this.inner?.header() ?? null
		};
	}

	/** The whole song, once every chunk has come out. */
	hearing(): Hearing {
		const header = this.header();
		return {
			header, features: this.features, heads: this.heads, activity: this.activity,
			inner: header.inner ? this.inner!.data : new Uint8Array(0)
		};
	}

	bytes(): Uint8Array {
		return writeHearing(this.hearing());
	}
}
