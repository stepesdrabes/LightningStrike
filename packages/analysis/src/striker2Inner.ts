import { closeSync, openSync, readSync } from 'node:fs';
import type { HearingInner } from '@mv/core';
import type { Striker2Inner } from './striker2.ts';
import type { Striker2Layer, Striker2Link, Striker2Readout, Striker2Space } from './striker2Graph.ts';

/** Neurons kept per residual stream. */
export const INNER_K = 12;
/** Rows a second the song keeps; the 100 Hz layers keep each row's most extreme value. */
const INNER_RATE = 25;
/** Columns a live chunk's activations are summarised in. */
export const INNER_COLS = 24;
/** Byte steps per standard deviation, around 128. */
const Z = 32;

/** What the recorder needs of the graph: its streams, the layers that write them, the links and its file. */
export interface InnerSource {
	graph: string;
	spaces: Striker2Space[];
	layers: Striker2Layer[];
	links: Striker2Link[];
	readouts?: Striker2Readout[];
}

/** The output neurons the view draws: their `HEARING_HEADS` indexes and their columns of the readout's weights. */
export interface InnerReadout {
	readout: Striker2Readout;
	heads: number[];
	columns: number[];
}

/**
 * Records real activations: on the song's first chunk it keeps each stream's most active neurons
 * and each layer's mean and spread for them, then writes every layer's value for those neurons,
 * in standard deviations, for the whole song.
 */
export class InnerRecorder {
	private readonly source: InnerSource;
	private readonly fps: number;
	private readonly readout: InnerReadout | null;
	private chosen: number[][] | null = null;
	private mean: Float32Array[] = [];
	private spread: Float32Array[] = [];
	private linkWeights: HearingInner['links'] = [];
	private readoutWeights: number[][] = [];
	rows = 0;
	data = new Uint8Array(0);

	constructor(source: InnerSource, fps: number, readout: InnerReadout | null = null) {
		this.source = source;
		this.fps = fps;
		this.readout = readout;
	}

	begin(frames: number): void {
		this.rows = Math.ceil((frames * INNER_RATE) / this.fps);
		this.data = new Uint8Array(this.rows * this.source.layers.length * INNER_K).fill(128);
		this.chosen = null;
	}

	/** A layer's frames, the rate it runs at, and its width; null when the run did not expose it. */
	private tensors(inner: Striker2Inner | undefined) {
		const { layers, spaces } = this.source;
		const found = layers.map((l) => {
			const t = inner?.[l.tensor];
			const { width, hz } = spaces[l.space];
			return t && t.dims.length === 3 && t.dims[2] === width ? { data: t.data, frames: t.dims[1], width, hz } : null;
		});
		return found.every(Boolean) ? (found as NonNullable<(typeof found)[number]>[]) : null;
	}

	/** A layer frame range for chunk-local 100 Hz frames [t0, t1). */
	private span(t0: number, t1: number, hz: number, frames: number): [number, number] {
		const f0 = Math.min(frames - 1, Math.floor((t0 * hz) / this.fps));
		return [f0, Math.min(frames, Math.max(f0 + 1, Math.floor((t1 * hz) / this.fps)))];
	}

	private choose(layers: NonNullable<ReturnType<InnerRecorder['tensors']>>, lo: number, hi: number): void {
		const { spaces } = this.source;
		const stats = layers.map((l) => {
			const [f0, f1] = this.span(lo, hi, l.hz, l.frames);
			const sum = new Float64Array(l.width);
			const sq = new Float64Array(l.width);
			for (let f = f0; f < f1; f++) {
				for (let c = 0; c < l.width; c++) {
					const v = l.data[f * l.width + c];
					sum[c] += v;
					sq[c] += v * v;
				}
			}
			const n = Math.max(1, f1 - f0);
			const mean = sum.map((s) => s / n);
			const sd = sq.map((s, c) => Math.sqrt(Math.max(1e-12, s / n - mean[c] * mean[c])));
			return { mean, sd };
		});
		// The stream the output neurons read keeps the neurons that move them most.
		const weights = this.readWeights();
		const into = this.readout ? this.source.layers[this.readout.readout.layer].space : -1;
		this.chosen = spaces.map((space, s) => {
			const score = new Float64Array(space.width);
			this.source.layers.forEach((l, li) => {
				if (l.space === s) stats[li].sd.forEach((v, c) => (score[c] += v));
			});
			if (weights && s === into) score.forEach((v, c) => (score[c] = v * Math.max(...weights[c].map(Math.abs))));
			return [...score.keys()].sort((a, b) => score[b] - score[a]).slice(0, INNER_K).sort((a, b) => a - b);
		});
		if (weights) {
			const rows = this.chosen[into].map((c) => weights[c]);
			const top = Math.max(1e-12, ...rows.flat().map(Math.abs));
			this.readoutWeights = this.readout!.columns.map((_, j) => rows.map((row) => Math.round((row[j] / top) * 1000) / 1000));
		}
		this.mean = this.source.layers.map((l, li) => Float32Array.from(this.chosen![l.space], (c) => stats[li].mean[c]));
		this.spread = this.source.layers.map((l, li) => Float32Array.from(this.chosen![l.space], (c) => stats[li].sd[c]));
		this.linkWeights = this.readLinks();
	}

	/** The readout's weight from every neuron of the stream it reads to each output neuron drawn, [in][output]. */
	private readWeights(): number[][] | null {
		const r = this.readout?.readout;
		if (!r?.data || r.dims.length !== 2) return null;
		const [inputs, outputs] = r.dims;
		const bytes = new Uint8Array(inputs * outputs * 4);
		const file = openSync(this.source.graph, 'r');
		try {
			readSync(file, bytes, 0, bytes.length, r.data.offset);
		} finally {
			closeSync(file);
		}
		const w = new Float32Array(bytes.buffer);
		return Array.from({ length: inputs }, (_, c) => this.readout!.columns.map((j) => w[c * outputs + j]));
	}

	/** Each link's learned weights between the kept neurons, |w| summed over the kernel. */
	private readLinks(): HearingInner['links'] {
		const chosen = this.chosen!;
		const readable = this.source.links.filter((l) => l.data && l.dims.length === 3);
		if (readable.length === 0) return [];
		const file = openSync(this.source.graph, 'r');
		try {
			return readable.map((link) => {
				const [, d1, k] = link.dims;
				const from = chosen[link.from];
				const to = chosen[link.to];
				// Conv weights are [out, in, k]; ConvTranspose [in, out, k]. Read one row per kept neuron.
				const rows = link.transposed ? from : to;
				const cols = link.transposed ? to : from;
				const rowFloats = d1 * k;
				const grid = rows.map((r) => {
					const bytes = new Uint8Array(rowFloats * 4);
					readSync(file, bytes, 0, bytes.length, link.data!.offset + r * rowFloats * 4);
					const w = new Float32Array(bytes.buffer);
					return cols.map((c) => {
						let sum = 0;
						for (let j = 0; j < k; j++) sum += Math.abs(w[c * k + j]);
						return sum;
					});
				});
				const weights = to.map((_, j) => from.map((_, i) => (link.transposed ? grid[i][j] : grid[j][i])));
				const top = Math.max(1e-12, ...weights.flat());
				return {
					stage: link.stage, from: link.from, to: link.to,
					weights: weights.map((row) => row.map((v) => Math.round((v / top) * 1000) / 1000))
				};
			});
		} finally {
			closeSync(file);
		}
	}

	/** Every kept neuron's most extreme value over [t0, t1), as a signed byte, into `out` at `at`. */
	private sample(layers: NonNullable<ReturnType<InnerRecorder['tensors']>>, t0: number, t1: number, out: Uint8Array, at: number): void {
		layers.forEach((l, li) => {
			const [f0, f1] = this.span(t0, t1, l.hz, l.frames);
			const channels = this.chosen![this.source.layers[li].space];
			for (let k = 0; k < INNER_K && k < channels.length; k++) {
				let z = 0;
				for (let f = f0; f < f1; f++) {
					const v = (l.data[f * l.width + channels[k]] - this.mean[li][k]) / this.spread[li][k];
					if (Math.abs(v) > Math.abs(z)) z = v;
				}
				out[at + li * INNER_K + k] = Math.max(0, Math.min(255, Math.round(128 + Z * z)));
			}
		});
	}

	/** Records the chunk's own frames [lo, hi); returns its live summary, [cols][layers][k], or null. */
	chunk(start: number, lo: number, hi: number, music: number, inner: Striker2Inner | undefined): Uint8Array | null {
		const layers = this.tensors(inner);
		if (!layers) return null;
		if (!this.chosen) this.choose(layers, lo, hi);
		const step = this.fps / INNER_RATE;
		const width = this.source.layers.length * INNER_K;
		for (let row = Math.ceil((start + lo) / step); row * step < start + hi && row < this.rows; row++) {
			this.sample(layers, row * step - start, (row + 1) * step - start, this.data, row * width);
		}
		const live = new Uint8Array(INNER_COLS * width).fill(128);
		for (let c = 0; c < INNER_COLS; c++) {
			this.sample(layers, Math.floor((c * music) / INNER_COLS), Math.floor(((c + 1) * music) / INNER_COLS), live, c * width);
		}
		return live;
	}

	header(): HearingInner | null {
		if (!this.chosen) return null;
		return {
			k: INNER_K, rate: INNER_RATE,
			layers: this.source.layers.map(({ id, stage, space }) => ({ id, stage, space })),
			spaces: this.source.spaces.map(({ width, hz }, s) => ({ width, hz, channels: this.chosen![s] })),
			links: this.linkWeights,
			...(this.readout && this.readoutWeights.length > 0
				? { readout: { layer: this.readout.readout.layer, heads: this.readout.heads, weights: this.readoutWeights } }
				: {})
		};
	}
}
