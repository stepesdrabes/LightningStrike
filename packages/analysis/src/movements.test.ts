import { describe, expect, it } from 'vitest';
import type { Chromagram } from './chroma.ts';
import type { BarFeatures } from './structure.ts';
import { similarityMatrix } from './structure.ts';
import {
	judgeSeams,
	proposeSeams,
	repairGrid,
	songRuns,
	stepScore,
	tempoRegimes,
	type SeamCandidate
} from './movements.ts';

/** Beats at one tempo from `start`, `count` of them, with a deterministic 20 ms grid. */
function grid(start: number, bpm: number, count: number, quantise = 0.02): number[] {
	const period = 60 / bpm;
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		const t = start + i * period;
		out.push(quantise > 0 ? Math.round(t / quantise) * quantise : t);
	}
	return out;
}

/** Every fourth beat from `phase`, the way the model reports downbeats. */
function downbeatsOf(beats: readonly number[], phase = 0): number[] {
	return beats.filter((_, i) => i >= phase && (i - phase) % 4 === 0);
}

describe('tempoRegimes', () => {
	it('reads a constant grid as one regime and one song', () => {
		const beats = grid(0, 128, 400);
		const regimes = tempoRegimes(beats);
		expect(regimes).toHaveLength(1);
		expect(regimes[0].bpm).toBeCloseTo(128, 0);
		expect(regimes[0].steady).toBeGreaterThan(0.95);
	});

	it('cuts a step between two tempos at the beat it happens', () => {
		const a = grid(0, 138, 140);
		const b = grid(a[a.length - 1] + 60 / 155, 155, 300);
		const beats = [...a, ...b];
		const regimes = tempoRegimes(beats);
		expect(regimes).toHaveLength(2);
		expect(Math.abs(regimes[1].fromBeat - a.length)).toBeLessThanOrEqual(1);
		expect(regimes[0].bpm).toBeCloseTo(138, 0);
		expect(regimes[1].bpm).toBeCloseTo(155, 0);
		expect(songRuns(regimes, beats)).toHaveLength(2);
	});

	it('folds a doubled stretch back into the song it is a reading of', () => {
		const a = grid(0, 71, 120);
		const doubled = grid(a[a.length - 1] + 60 / 142, 142, 80);
		const c = grid(doubled[doubled.length - 1] + 60 / 71, 71, 120);
		const beats = [...a, ...doubled, ...c];
		const regimes = tempoRegimes(beats);
		expect(regimes.length).toBeGreaterThanOrEqual(3);
		const songs = songRuns(regimes, beats);
		expect(songs).toHaveLength(1);
		expect(songs[0].bpm).toBeCloseTo(71, 0);
		expect(songs[0].flippedSeconds).toBeGreaterThan(30);
	});

	it('folds a triplet reading that keeps phase, and keeps a 3:2 change that breaks it', () => {
		const a = grid(0, 120, 200, 0);
		// Read in triplets: three beats per two of the same pulse, on the same grid.
		const triplets: number[] = [];
		for (let i = 0; i < 60; i++) triplets.push(a[a.length - 1] + ((i + 1) * 0.5 * 2) / 3);
		const c = grid(triplets[triplets.length - 1] + 0.5, 120, 100, 0);
		expect(songRuns(tempoRegimes([...a, ...triplets, ...c]), [...a, ...triplets, ...c])).toHaveLength(1);
		// A real change to 180 bpm after a breath lands off the old grid.
		const d = grid(a[a.length - 1] + 0.42, 180, 200, 0);
		expect(songRuns(tempoRegimes([...a, ...d]), [...a, ...d]).filter((s) => s.seconds > 20)).toHaveLength(2);
	});

	it('does not cut a band speeding up', () => {
		const beats: number[] = [0];
		let bpm = 120;
		for (let i = 0; i < 300; i++) {
			// Two per cent a bar over twenty bars: a ramp, not a step.
			if (i >= 100 && i < 180) bpm += 0.25;
			beats.push(beats[beats.length - 1] + 60 / bpm);
		}
		expect(songRuns(tempoRegimes(beats), beats).filter((s) => s.seconds > 20)).toHaveLength(1);
	});
});

describe('stepScore', () => {
	it('reads a step as one and a ramp as nothing', () => {
		const a = grid(0, 120, 60, 0);
		const b = grid(a[a.length - 1] + 0.5, 140, 60, 0);
		expect(stepScore([...a, ...b], a.length)).toBeGreaterThan(0.9);
		const ramp: number[] = [0];
		for (let i = 0; i < 120; i++) ramp.push(ramp[i] + 60 / (120 + (i / 120) * 20));
		expect(stepScore(ramp, 60)).toBeLessThan(0.3);
	});
});

describe('repairGrid', () => {
	it('leaves a clean stream exactly as it was', () => {
		const beats = grid(0.3, 128, 300);
		const downbeats = downbeatsOf(beats, 2);
		const repaired = repairGrid(beats, downbeats);
		expect(repaired.repairedSeconds).toBe(0);
		expect(Array.from(repaired.beats)).toEqual(beats);
		expect(repaired.downbeats).toEqual(downbeats);
	});

	it('re-reads a doubled stretch at the song level, keeping the phase', () => {
		const period = 60 / 71;
		const truth = grid(0, 71, 280, 0);
		// The tracker doubling for forty beats in the middle: every interval there gains a midpoint.
		const beats: number[] = [];
		for (let i = 0; i < truth.length; i++) {
			beats.push(truth[i]);
			if (i >= 120 && i < 160) beats.push(truth[i] + period / 2);
		}
		const repaired = repairGrid(beats, downbeatsOf(truth));
		expect(Array.from(repaired.beats).map((t) => Math.round(t * 1000))).toEqual(truth.map((t) => Math.round(t * 1000)));
		const periods = Array.from(repaired.beats).slice(1).map((t, i) => t - repaired.beats[i]);
		// Every interval is now one beat of the song, to the sample.
		expect(Math.min(...periods)).toBeGreaterThan(period * 0.95);
		expect(Math.max(...periods)).toBeLessThan(period * 1.05);
		expect(repaired.repairedSeconds).toBeGreaterThan(30);
		expect(repaired.songs).toHaveLength(1);
	});

	it('fills a chaotic intro from the song that follows it', () => {
		const noise: number[] = [0];
		let seed = 7;
		for (let i = 0; i < 40; i++) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			noise.push(noise[i] + 0.2 + (seed / 4294967296) * 0.6);
		}
		const songStart = noise[noise.length - 1] + 1;
		const song = grid(songStart, 120, 300, 0);
		const beats = [...noise, ...song];
		const repaired = repairGrid(beats, downbeatsOf(song));
		const before = Array.from(repaired.beats).filter((t) => t < songStart - 1e-6);
		// The intro now walks the song's own period back to the top of the file.
		for (let i = 1; i < before.length; i++) expect(before[i] - before[i - 1]).toBeCloseTo(0.5, 6);
		expect(Array.from(repaired.beats).filter((t) => t >= songStart - 1e-6)).toEqual(song);
		// No downbeat was invented in the filled stretch.
		expect(repaired.downbeats.every((d) => d >= songStart - 1e-6)).toBe(true);
	});
});

describe('proposeSeams', () => {
	it('ends a song at the start of an incomplete last bar when a pause follows', () => {
		// 98 beats at 60: the last bar line is beat 96 and only two beats follow it before the gap.
		const a = grid(0, 60, 98, 0);
		const b = grid(a[a.length - 1] + 7, 80, 200, 0);
		const beats = [...a, ...b];
		const repaired = repairGrid(beats, [...downbeatsOf(a), ...downbeatsOf(b)]);
		const seam = proposeSeams(repaired, 4, beats[beats.length - 1]).find((s) => s.tempo)!;
		expect(Math.abs(seam.t - a[96])).toBeLessThan(0.05);
	});

	it('walks a ridden-through switch back onto the outgoing bar line', () => {
		// The new song starts on the old song's bar line at beat 100, but the tracker keeps
		// the old period for four more beats before it changes.
		const a = grid(0, 80, 100, 0);
		const line = a[a.length - 1] + 0.75;
		const inertia = [line, line + 0.75, line + 1.5, line + 2.25];
		const b = grid(line + 4 * 0.84, 60 / 0.84, 200, 0);
		const beats = [...a, ...inertia, ...b];
		const downbeats = [...downbeatsOf(a), line, ...downbeatsOf(b)];
		const repaired = repairGrid(beats, downbeats);
		expect(repaired.handshakes).toHaveLength(1);
		const seam = proposeSeams(repaired, 4, beats[beats.length - 1]).find((s) => s.tempo)!;
		expect(Math.abs(seam.t - line)).toBeLessThan(0.05);
		expect(seam.exact).toBe(true);
		// The bar between is the new song's, at its period.
		const between = Array.from(repaired.beats).filter((t) => t >= line - 1e-6 && t < b[0] - 1e-6);
		expect(between).toHaveLength(4);
		for (let i = 1; i < between.length; i++) expect(between[i] - between[i - 1]).toBeCloseTo(0.84, 6);
	});

	it('offers the boundary between two songs, and none inside one', () => {
		const a = grid(0, 138, 140, 0);
		const b = grid(a[a.length - 1] + 60 / 155, 155, 300, 0);
		const beats = [...a, ...b];
		const downbeats = [...downbeatsOf(a, 1), ...downbeatsOf(b, 0)];
		const repaired = repairGrid(beats, downbeats);
		const seams = proposeSeams(repaired, 4, beats[beats.length - 1]);
		const tempoSeams = seams.filter((s) => s.tempo);
		expect(tempoSeams).toHaveLength(1);
		expect(Math.abs(tempoSeams[0].t - b[0])).toBeLessThan(0.5);
		expect(tempoSeams[0].tempo!.ratio).toBeCloseTo(155 / 138, 2);
		expect(tempoSeams[0].tempo!.step).toBeGreaterThan(0.9);
	});

	it('places a seam with a pause where the outgoing song stopped', () => {
		const a = grid(0, 60, 100, 0);
		const b = grid(a[a.length - 1] + 7, 80, 200, 0);
		const beats = [...a, ...b];
		const repaired = repairGrid(beats, [...downbeatsOf(a), ...downbeatsOf(b)]);
		// The pause is written at the incoming period, back from the new song's first beat.
		expect(repaired.zones.filter((z) => z.filled)).toHaveLength(1);
		const inPause = Array.from(repaired.beats).filter((t) => t > a[a.length - 1] + 1 + 1e-6 && t < b[0] - 1e-6);
		expect(inPause.length).toBeGreaterThan(6);
		for (let i = 1; i < inPause.length; i++) expect(inPause[i] - inPause[i - 1]).toBeCloseTo(0.75, 6);
		const seams = proposeSeams(repaired, 4, beats[beats.length - 1]);
		const seam = seams.find((s) => s.tempo)!;
		expect(seam.tempo!.pause).toBeGreaterThan(2);
		// The outgoing song's last bar is complete, so it ends at that bar's end, one period
		// past its last beat, and the pickup is written from there.
		expect(Math.abs(seam.t - (a[a.length - 1] + 1))).toBeLessThan(0.05);
		expect(seam.exact).toBe(true);
	});
});

/**
 * A bar table for two songs that share nothing: each has its own timbre pattern and its own
 * pitch profile, and each repeats itself the way a song does.
 */
function twoSongMaterial(barsA: number, barsB: number, sameHarmony = false) {
	const dim = 64;
	const count = barsA + barsB;
	const time = Float64Array.from({ length: count + 1 }, (_, b) => b * 2);
	const pattern = new Float32Array(count * dim);
	const chroma = new Float32Array(count * 12);
	let seed = 99;
	const rand = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	const motif = (k: number) => {
		const v = new Float32Array(dim);
		for (let i = 0; i < dim; i++) v[i] = 0.2 + rand() * (k === 0 ? 1 : 0.6) * (((i * (k + 3)) % 7) / 7);
		return v;
	};
	const motifs = [motif(0), motif(1)];
	const pitches = [
		[1, 0, 0.6, 0, 0.8, 0.2, 0, 0.9, 0, 0.5, 0, 0.3],
		sameHarmony ? [1, 0, 0.6, 0, 0.8, 0.2, 0, 0.9, 0, 0.5, 0, 0.3] : [0, 0.3, 0, 0.9, 0, 0.5, 1, 0, 0.7, 0, 0.8, 0.1]
	];
	for (let b = 0; b < count; b++) {
		const song = b < barsA ? 0 : 1;
		const m = motifs[song];
		let norm = 0;
		for (let i = 0; i < dim; i++) {
			const v = m[i] * (1 + 0.02 * ((b * 7) % 5));
			pattern[b * dim + i] = v;
			norm += v * v;
		}
		norm = Math.sqrt(norm);
		for (let i = 0; i < dim; i++) pattern[b * dim + i] /= norm;
		let cn = 0;
		for (let p = 0; p < 12; p++) {
			const v = pitches[song][p] + 0.05 * ((b + p) % 3);
			chroma[b * 12 + p] = v;
			cn += v * v;
		}
		cn = Math.sqrt(cn);
		for (let p = 0; p < 12; p++) chroma[b * 12 + p] /= cn;
	}
	const flat = (v: number) => Float32Array.from({ length: count }, () => v);
	const bars: BarFeatures = {
		count,
		time,
		pattern,
		patternDim: dim,
		chroma,
		rms: flat(0.2),
		low: flat(0.3),
		mid: flat(0.3),
		high: flat(0.3),
		floor: flat(0.15)
	};
	// A chromagram whose frames carry each song's pitch profile, for the key reading.
	const fps = 10;
	const frames = Math.round(time[count] * fps);
	const values = new Float32Array(frames * 12);
	const energy = new Float32Array(frames * 12);
	for (let f = 0; f < frames; f++) {
		const song = f / fps < time[barsA] ? 0 : 1;
		for (let p = 0; p < 12; p++) {
			values[f * 12 + p] = pitches[song][p];
			energy[f * 12 + p] = pitches[song][p];
		}
	}
	const chromagram: Chromagram = { fps, frames, values, energy, timeOf: (f) => f / fps };
	return { bars, sim: similarityMatrix(bars), chroma: chromagram, seamTime: time[barsA], duration: time[count] };
}

describe('judgeSeams', () => {
	const tempoSeam = (t: number, beat: number): SeamCandidate => ({
		t,
		beat,
		tempo: { from: 120, to: 140, ratio: 140 / 120, step: 0.95, pause: 1, leftSeconds: 80, rightSeconds: 80 },
		reset: true,
		downbeatGap: 3
	});

	it('accepts a tempo seam between two songs that share neither material nor key', () => {
		const m = twoSongMaterial(40, 40);
		const seams = judgeSeams([tempoSeam(m.seamTime, 160)], m, m.duration);
		expect(seams).toHaveLength(1);
		expect(seams[0].t).toBe(m.seamTime);
		expect(seams[0].note).toContain('tempo');
	});

	it('accepts a tempo seam on the step alone, whatever the key does', () => {
		const m = twoSongMaterial(40, 40, true);
		expect(judgeSeams([tempoSeam(m.seamTime, 160)], m, m.duration)).toHaveLength(1);
	});

	it('refuses a tempo seam that is a ramp with no pause', () => {
		const m = twoSongMaterial(40, 40);
		const ramp: SeamCandidate = { ...tempoSeam(m.seamTime, 160), tempo: { ...tempoSeam(0, 0).tempo!, step: 0.1, pause: 1 } };
		expect(judgeSeams([ramp], m, m.duration)).toHaveLength(0);
	});

	it('refuses a same-tempo seam when the material after it recurs before it', () => {
		// One song's bars either side: the "seam" sits inside repeated material.
		const m = twoSongMaterial(80, 0);
		const reset: SeamCandidate = { t: m.bars.time[40], beat: 160, reset: true, downbeatGap: 2, pause: 3 };
		expect(judgeSeams([reset], m, m.duration)).toHaveLength(0);
	});

	it('asks a same-tempo seam for new material and a pause or a key change', () => {
		const m = twoSongMaterial(40, 40);
		const keyed: SeamCandidate = { t: m.seamTime, beat: 160, reset: true, downbeatGap: 2 };
		expect(judgeSeams([keyed], m, m.duration)).toHaveLength(1);
		const paused: SeamCandidate = { t: m.seamTime, beat: 160, reset: false, pause: 3 };
		expect(judgeSeams([paused], m, m.duration)).toHaveLength(1);
		const bare: SeamCandidate = { t: m.seamTime, beat: 160, reset: false };
		expect(judgeSeams([bare], m, m.duration)).toHaveLength(0);
		// Same harmony either side and no pause: a count restarting inside one song.
		const same = twoSongMaterial(40, 40, true);
		expect(judgeSeams([keyed], same, same.duration)).toHaveLength(0);
	});

	it('ignores a seam too near either end to leave a song on both sides', () => {
		const m = twoSongMaterial(8, 72);
		expect(judgeSeams([tempoSeam(m.seamTime, 32)], m, m.duration)).toHaveLength(0);
	});
});
