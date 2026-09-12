import { SPECTRUM_BANDS, encodeBase64, sectionBase, type SectionKind, type SpectrumTrack } from '@mv/core';
import type { Spectrogram } from './dsp/spectrogram.ts';
import { centredMedian, quantile } from './dsp/stats.ts';

/** 50 Hz halves stored spectrum size; below ~40 Hz, club-tempo sixteenths start aliasing. */
const SPECTRUM_FPS = 50;
/** Analysed range, Hz: 30 to the filterbank's 16 kHz ceiling. */
const MIN_HZ = 30;
const MAX_HZ = 16000;

/** Centred median radius at SPECTRUM_FPS: remove frame noise without adding group delay. */
const MEDIAN_RADIUS = 5;
/** Fixed dB window; 30 balances contrast and headroom in the corpus sweep. */
const WINDOW_DB = 30;
/**
 * Maximum quiet-kind lift, dB. Pool all instances of each kind; per-instance AGC erases
 * section contrast. Six dB is 0.20 of the fixed 30 dB window.
 */
const MAX_LIFT_DB = 6;

/**
 * Use a fixed dB window per band, referenced to the loud sections' pooled q95. Whole-track
 * quantile stretching flattens loud passages and destroys relative band heights. Drop
 * identity belongs to layers, motion, and area, not extra spectrum level.
 */
export function spectrumTrack(
	spec: Spectrogram,
	duration: number,
	sectionAt: (t: number) => SectionKind
): SpectrumTrack {
	const frames = Math.max(1, Math.round(duration * SPECTRUM_FPS));
	const bands = SPECTRUM_BANDS;

	// Band edges, and the source bins each one owns. A band narrower than the filterbank's own
	// spacing down at the bottom still gets one bin, or the sub would read as silence.
	const edges: number[] = [];
	for (let k = 0; k <= bands; k++) {
		edges.push(MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, k / bands));
	}
	const centreHz: number[] = [];
	const range: [number, number][] = [];
	for (let k = 0; k < bands; k++) {
		let lo = 0;
		let hi = spec.bands;
		while (lo < spec.bands && spec.centreHz[lo] < edges[k]) lo++;
		while (hi > lo && spec.centreHz[hi - 1] > edges[k + 1]) hi--;
		range.push([Math.min(lo, spec.bands - 1), Math.max(hi, Math.min(lo + 1, spec.bands))]);
		centreHz.push(Math.round(Math.sqrt(edges[k] * edges[k + 1])));
	}
	if (spec.mag.length > 0 && !spec.mag.some((v) => v !== 0)) {
		return { fps: SPECTRUM_FPS, bands, centreHz, data: encodeBase64(new Uint8Array(frames * bands)) };
	}

	const db = new Float32Array(frames * bands);
	for (let f = 0; f < frames; f++) {
		const s0 = Math.min(spec.frames - 1, Math.max(0, Math.round((f * spec.fps) / SPECTRUM_FPS)));
		const s1 = Math.max(s0 + 1, Math.min(spec.frames, Math.round(((f + 1) * spec.fps) / SPECTRUM_FPS)));
		for (let k = 0; k < bands; k++) {
			const [lo, hi] = range[k];
			let acc = 0;
			for (let s = s0; s < s1; s++) {
				for (let j = lo; j < hi; j++) acc += spec.mag[s * spec.bands + j];
			}
			const linear = acc / ((s1 - s0) * (hi - lo));
			db[f * bands + k] = 20 * Math.log10(Math.max(linear, 1e-7));
		}
	}

	const kinds: SectionKind[] = [];
	for (let f = 0; f < frames; f++) kinds.push(sectionAt((f + 0.5) / SPECTRUM_FPS));
	const loud: number[] = [];
	// By section BASE, or a verse/chorus track has no 'loud' frames at all and the window
	// silently falls back to the whole-track pooling meant for ambient edge cases.
	for (let f = 0; f < frames; f++) {
		const base = sectionBase(kinds[f]);
		if (base === 'drop' || base === 'groove') loud.push(f);
	}

	const column = new Float32Array(frames);
	const smoothed = new Float32Array(frames);
	const scratch: number[] = [];
	const data = new Uint8Array(frames * bands);

	for (let k = 0; k < bands; k++) {
		for (let f = 0; f < frames; f++) column[f] = db[f * bands + k];
		centredMedian(column, MEDIAN_RADIUS, smoothed);

		// A track with no loud section at all - an ambient piece, or one segmented into nothing but
		// intro and outro - has to reference something, and its own whole self is the honest choice.
		scratch.length = 0;
		if (loud.length > frames / 20) for (const f of loud) scratch.push(smoothed[f]);
		else for (let f = 0; f < frames; f++) scratch.push(smoothed[f]);
		const reference = quantile(scratch, 0.95);

		// One lift per section KIND, pooled over every instance of it.
		const lift = new Map<SectionKind, number>();
		for (const kind of new Set(kinds)) {
			scratch.length = 0;
			for (let f = 0; f < frames; f++) if (kinds[f] === kind) scratch.push(smoothed[f]);
			if (scratch.length === 0) continue;
			lift.set(kind, Math.max(0, Math.min(MAX_LIFT_DB, reference - quantile(scratch, 0.95))));
		}

		for (let f = 0; f < frames; f++) {
			const v = (smoothed[f] - reference + (lift.get(kinds[f]) ?? 0) + WINDOW_DB) / WINDOW_DB;
			data[f * bands + k] = Math.round(Math.max(0, Math.min(1, v)) * 255);
		}
	}

	return { fps: SPECTRUM_FPS, bands, centreHz, data: encodeBase64(data) };
}
