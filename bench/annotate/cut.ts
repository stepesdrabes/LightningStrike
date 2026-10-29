// A review clip cut from Striker 2.0's hearing of a whole song: the grid, Striker's hits, the
// high-recall proposals and the probability curves, every time relative to the clip's start.
import type { Striker2Result } from '../../packages/analysis/src/striker2.ts';
import {
	STRIKER2_CLASSES, STRIKER2_FPS, coarseHits, sigmoid32, type PeakRule, type Striker2Class
} from '../../packages/analysis/src/striker2Decode.ts';
import type { DrumHeads } from '../hearing.ts';
import { buildPages } from './pages.js';

/**
 * Every probability peak from here up is proposed, far below any threshold a manifest sets. On
 * MDB's CoolJazz it holds 55 of 69 kicks and 201 of 286 brush strokes, against 38 and 166 at 0.05.
 */
export const FLOOR = 0.02;
/** A proposal this likely is drawn as evidence, counts as a disagreement and is accepted by `a`. */
export const SUPPORT = 0.1;

export interface Proposal {
	t: number;
	/** Striker 2.0's onset probability at the peak, to 0.01. */
	score: number;
}

export type ByClass<T> = Record<Striker2Class, T>;

export interface ClipMeta {
	id: string;
	corpus: string;
	track: string;
	title: string;
	artist: string;
	genre: string;
	tags: string[];
	/** The audio file the clip was cut from. */
	source: string;
}

export interface Clip extends ClipMeta {
	start: number;
	seconds: number;
	rate: number;
	model: string;
	classes: Striker2Class[];
	/** Each lane is a band of the mix the annotator filters itself; there are no source WAVs. */
	lanes: 'bands';
	/** Whether a new review starts from Striker's hits rather than empty. */
	prefill: boolean;
	thresholds: ByClass<number>;
	floor: number;
	support: number;
	beats: number[];
	downbeats: number[];
	striker: ByClass<number[]>;
	proposals: ByClass<Proposal[]>;
	/** Onset probability per class at `fps`, the first value at clip time `from`. */
	curves: { fps: number; from: number; values: ByClass<number[]> };
}

export interface Hearing {
	model: { name: string; drums: { rules: ByClass<PeakRule> } };
	heard: Striker2Result;
	heads: DrumHeads;
}

const round4 = (t: number) => +t.toFixed(4) + 0;

/** `times` from `start`, those in [0, seconds) only. */
export function relative(times: readonly number[], start: number, seconds: number): number[] {
	return times.map((t) => round4(t - start)).filter((t) => t >= 0 && t < seconds);
}

/**
 * Every peak of each class's onset probability from `floor` up, picked and timed as Striker's own
 * hits are (striker-2 `decode.coarse_hits` with the threshold lowered), so its hits are among them.
 */
export function proposals(
	heads: DrumHeads, rules: ByClass<PeakRule>, floor = FLOOR
): ByClass<Proposal[]> {
	const lowered = Object.fromEntries(STRIKER2_CLASSES
		.map((cls) => [cls, { ...rules[cls], threshold: floor }])) as ByClass<PeakRule>;
	const { onset, offset } = heads;
	const picked = coarseHits({ onset, offset, level: onset, width: STRIKER2_CLASSES.length }, 0, lowered, 0);
	return Object.fromEntries(STRIKER2_CLASSES.map((cls) => [cls,
		picked[cls].times.map((t, i) => ({ t, score: picked[cls].levels[i] }))])) as ByClass<Proposal[]>;
}

/** The downbeat past the intro that starts the window with the most supported proposals. */
export function densestStart(
	downbeats: readonly number[], found: ByClass<Proposal[]>, duration: number, seconds: number,
	support = SUPPORT
): number {
	const marks = Object.values(found).flat().filter((p) => p.score >= support).map((p) => p.t);
	const starts = downbeats.filter((t) => t >= Math.min(20, duration * 0.15) && t + seconds <= duration - 1);
	if (!starts.length) return Math.max(0, Math.min(duration * 0.35, duration - seconds - 1));
	let best = starts[0];
	let most = -1;
	for (const start of starts) {
		const count = marks.filter((t) => t >= start && t < start + seconds).length;
		if (count > most) {
			most = count;
			best = start;
		}
	}
	return best;
}

/**
 * The clip length nearest `wanted` whose last page is two whole bars: a page end from pages.js,
 * with at least two downbeats inside so the annotator pages it the same way.
 */
export function alignedSeconds(
	downbeats: readonly number[], start: number, wanted: number, duration: number
): number {
	const rest = round4(duration - start);
	const bars = relative(downbeats, start, rest);
	const ends = (buildPages({ downbeats: bars, seconds: rest }) as { to: number }[]).slice(0, -1)
		.map((p) => p.to).filter((end) => bars.filter((d) => d < end).length >= 2);
	if (!ends.length) return Math.min(wanted, rest);
	return ends.reduce((a, b) => (Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a));
}

export function cutClip(input: {
	meta: ClipMeta;
	mono: Float32Array;
	rate: number;
	hearing: Hearing;
	found: ByClass<Proposal[]>;
	start: number;
	seconds: number;
	floor: number;
	support: number;
	prefill: boolean;
}): { clip: Clip; mix: Float32Array } {
	const { meta, mono, rate, hearing: { model, heard, heads }, found, floor, support, prefill } = input;
	const start = round4(input.start);
	const from = Math.round(start * rate);
	const to = Math.min(mono.length, from + Math.round(input.seconds * rate));
	const seconds = round4((to - from) / rate);
	const within = (times: readonly number[]) => relative(times, start, seconds);
	const byClass = <T>(f: (cls: Striker2Class) => T) =>
		Object.fromEntries(STRIKER2_CLASSES.map((cls) => [cls, f(cls)])) as ByClass<T>;

	const first = Math.ceil(start * STRIKER2_FPS - 1e-6);
	const last = Math.min(heads.frames, Math.ceil((start + seconds) * STRIKER2_FPS - 1e-6));
	const curve = (c: number) => Array.from({ length: Math.max(0, last - first) },
		(_, k) => +sigmoid32(heads.onset[(first + k) * STRIKER2_CLASSES.length + c]).toFixed(3));

	const clip: Clip = {
		...meta, start, seconds, rate, model: model.name, classes: [...STRIKER2_CLASSES], lanes: 'bands',
		prefill,
		thresholds: byClass((cls) => model.drums.rules[cls].threshold), floor, support,
		beats: within(heard.beats), downbeats: within(heard.downbeats),
		striker: byClass((cls) => within(heard.drums[cls].times)),
		proposals: byClass((cls) => found[cls]
			.map((p) => ({ t: round4(p.t - start), score: p.score }))
			.filter((p) => p.t >= 0 && p.t < seconds)),
		curves: {
			fps: STRIKER2_FPS, from: round4(first / STRIKER2_FPS - start),
			values: byClass((cls) => curve(STRIKER2_CLASSES.indexOf(cls)))
		}
	};
	return { clip, mix: mono.subarray(from, to) };
}

/** 16-bit PCM WAV, channels interleaved, each sample clipped to [-1, 1]. */
export function wav16(channels: readonly Float32Array[], rate: number): Buffer {
	const n = Math.min(...channels.map((c) => c.length));
	const width = channels.length * 2;
	const body = Buffer.alloc(n * width);
	for (let i = 0; i < n; i++) {
		channels.forEach((c, k) => {
			body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i])) * 32767), i * width + k * 2);
		});
	}
	const head = Buffer.alloc(44);
	head.write('RIFF', 0);
	head.writeUInt32LE(36 + body.length, 4);
	head.write('WAVEfmt ', 8);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(channels.length, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * width, 28);
	head.writeUInt16LE(width, 32);
	head.writeUInt16LE(16, 34);
	head.write('data', 36);
	head.writeUInt32LE(body.length, 40);
	return Buffer.concat([head, body]);
}
