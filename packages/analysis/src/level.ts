import { encodeBase64, sectionBase, type LevelTrack, type SectionKind } from '@mv/core';
import { applyCascade, kWeighting } from './dsp/filters.ts';
import { clamp01, quantile } from './dsp/stats.ts';

/** 100 Hz matches the onset frame rate; 30 ms keeps a stick click distinct from the rest after it. */
const LEVEL_FPS = 100;
const WINDOW_SEC = 0.03;
/** dB span of the byte scale below the loud reference. */
const WINDOW_DB = 48;
const REFERENCE_Q = 0.95;

/** K-weighted short-term level in dB per frame, centred like the spectrum's entries. */
export function levelCurve(
	mono: Float32Array, sampleRate: number, frames: number, present?: Uint8Array
): Float32Array {
	const weighted = Float32Array.from(mono);
	applyCascade(weighted, kWeighting(sampleRate));
	const prefix = new Float64Array(weighted.length + 1);
	for (let i = 0; i < weighted.length; i++) prefix[i + 1] = prefix[i] + weighted[i] * weighted[i];

	const half = Math.max(1, Math.round((WINDOW_SEC * sampleRate) / 2));
	const db = new Float32Array(frames);
	for (let f = 0; f < frames; f++) {
		const centre = Math.round(((f + 0.5) / LEVEL_FPS) * sampleRate);
		const from = Math.min(weighted.length, Math.max(0, centre - half));
		const to = Math.min(weighted.length, Math.max(from, centre + half));
		const power = to > from ? (prefix[to] - prefix[from]) / (to - from) : 0;
		if (present) present[f] = power > 0 ? 1 : 0;
		db[f] = 10 * Math.log10(Math.max(power, 1e-12));
	}
	return db;
}

/** Referenced to the loud sections' q95 so a quiet intro reads quiet against the whole track. */
export function levelTrack(
	mono: Float32Array,
	sampleRate: number,
	duration: number,
	sectionAt: (t: number) => SectionKind
): LevelTrack {
	const frames = Math.max(1, Math.round(duration * LEVEL_FPS));
	const silent = mono.length > 0 && !mono.some((v) => v !== 0);
	if (silent) return { fps: LEVEL_FPS, data: encodeBase64(new Uint8Array(frames)), silent: true };
	const present = new Uint8Array(frames);
	const db = levelCurve(mono, sampleRate, frames, present);

	const loud: number[] = [];
	for (let f = 0; f < frames; f++) {
		const base = sectionBase(sectionAt((f + 0.5) / LEVEL_FPS));
		if (base === 'drop' || base === 'groove') loud.push(db[f]);
	}
	const reference = quantile(loud.length > 0 ? loud : db, REFERENCE_Q);

	const data = new Uint8Array(frames);
	for (let f = 0; f < frames; f++) {
		if (!present[f]) continue;
		data[f] = Math.round(255 * clamp01((db[f] - reference + WINDOW_DB) / WINDOW_DB));
	}
	return { fps: LEVEL_FPS, data: encodeBase64(data) };
}
