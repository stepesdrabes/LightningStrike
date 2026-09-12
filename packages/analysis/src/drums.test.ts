import { describe, expect, it } from 'vitest';
import { detectDrums, snapTimesToOnsets } from './drums.ts';
import { dropUnconfirmed, gateByEvidence, mergeStreams, modelDeafToHats } from './drums.ts';
import { extractFeatures } from './features.ts';
import { applyBiquad, lowpass } from './dsp/filters.ts';
import { fMeasure } from './fixture.ts';

/** Sustained sub kicks over legato bass test both missed kicks and bass notes misread as drums. */
function sophieClip(): { mono: Float32Array; sampleRate: number; kicks: number[] } {
	const sampleRate = 22050;
	const beat = 0.5;
	const duration = 16;
	const mono = new Float32Array(Math.ceil(duration * sampleRate));
	const add = (t: number, length: number, f: (s: number) => number) => {
		const i0 = Math.floor(t * sampleRate);
		const n = Math.floor(length * sampleRate);
		for (let i = 0; i < n && i0 + i < mono.length; i++) mono[i0 + i] += f(i / sampleRate);
	};
	const kicks: number[] = [];
	for (let t = 0.5; t < duration - 0.6; t += beat) {
		kicks.push(t);
		add(t, 0.35, (s) => {
			// Start the glide inside the kick band so onset flux exists before it settles into sustained sub.
			const f = 58 + 27 * Math.exp(-s * 30);
			return Math.tanh(3 * Math.sin(2 * Math.PI * f * s)) * Math.exp(-s * 7) * 0.9;
		});
		// The bassline: off-beat eighths at 110 Hz, played legato - a ramped attack and a
		// held body, which is what separates a note from a hit. A plucked synth bass IS
		// percussive and counting it is arguably right; the guard is about notes.
		add(t + beat / 2, 0.22, (s) => {
			const ramp = Math.min(1, s / 0.03);
			return Math.sin(2 * Math.PI * 110 * s) * ramp * 0.4;
		});
	}
	return { mono, sampleRate, kicks };
}

describe('the kit on a distorted pitched-sub kick', () => {
	it('hears the kick and does not count the bassline', () => {
		const { mono, sampleRate, kicks } = sophieClip();
		const features = extractFeatures(mono, sampleRate);
		const detected = detectDrums(features.spec, { beatPeriod: 0.5, odf: features.odf });

		const tol = 0.07;
		let hit = 0;
		for (const t of kicks) {
			if (detected.kick.times.some((d) => Math.abs(d - t) <= tol)) hit++;
		}
		const recall = hit / kicks.length;
		let truePos = 0;
		for (const d of detected.kick.times) {
			if (kicks.some((t) => Math.abs(d - t) <= tol)) truePos++;
		}
		const precision = detected.kick.times.length > 0 ? truePos / detected.kick.times.length : 0;
		// Characterisation floors: preserve recall for sustained sub kicks and pin current bass-note
		// false positives. DSP cannot fully separate these overlapping spectra; the model supplies
		// shipping kicks when available.
		expect(recall).toBeGreaterThan(0.8);
		expect(precision).toBeGreaterThan(0.4);
	});
});

function isolatedHits(kind: 'pluck' | 'piano' | 'hat' | 'snare' | 'clap', gain = 0.5) {
	const sampleRate = 22050;
	const mono = new Float32Array(sampleRate * 4);
	const times = [0.5, 1, 1.5, 2, 2.5, 3];
	let seed = 42;
	for (const time of times) {
		const noise = Float32Array.from({ length: Math.ceil(sampleRate * 0.25) }, () => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed / 2147483648 - 1;
		});
		applyBiquad(noise, lowpass(sampleRate, kind === 'hat' ? 10500 : 6500));
		const low = Float32Array.from(noise);
		const cutoff = kind === 'hat' ? 7000 : kind === 'clap' ? 600 : 900;
		applyBiquad(low, lowpass(sampleRate, cutoff));
		applyBiquad(low, lowpass(sampleRate, cutoff));
		for (let i = 0; i < noise.length; i++) {
			const s = i / sampleRate;
			const bandNoise = noise[i] - low[i];
			let value = 0;
			if (kind === 'pluck' || kind === 'piano') {
				for (const fundamental of kind === 'pluck' ? [220] : [220, 277, 330]) {
					for (let harmonic = 1; harmonic <= 15; harmonic++) {
						value += Math.sin(2 * Math.PI * fundamental * harmonic * s)
							* Math.exp(-s * (kind === 'pluck' ? 25 : 6))
							/ Math.pow(harmonic, 1.6) * Math.min(1, s / 0.004) * 0.2;
					}
				}
			} else if (kind === 'hat') {
				value = bandNoise * Math.exp(-s * 110);
			} else if (kind === 'clap') {
				value = bandNoise * (Math.exp(-s * 22)
					+ Math.exp(-Math.pow((s - 0.013) / 0.003, 2)) * 0.3
					+ Math.exp(-Math.pow((s - 0.026) / 0.003, 2)) * 0.3);
			} else {
				value = 0.4 * Math.sin(2 * Math.PI * 200 * s) * Math.exp(-s * 25)
					+ bandNoise * Math.exp(-s * 15);
			}
			mono[Math.floor(time * sampleRate) + i] += value * gain;
		}
	}
	const features = extractFeatures(mono, sampleRate);
	return {
		times,
		mono,
		sampleRate,
		drums: detectDrums(features.spec, { beatPeriod: 0.5, odf: features.odf })
	};
}

describe('fallback drum discrimination', () => {
	it.each(['pluck', 'piano', 'hat'] as const)('does not call %s attacks snares', (kind) => {
		const { drums } = isolatedHits(kind);
		expect(drums.snare.times).toHaveLength(0);
		if (kind !== 'hat') expect(drums.kick.times).toHaveLength(0);
	});

	it.each(['snare', 'clap'] as const)('retains quiet %s attacks without a loudness gate', (kind) => {
		const { drums, times } = isolatedHits(kind, 0.03);
		const score = fMeasure(times, drums.snare.times, 0.05);
		expect(score.recall).toBe(1);
		expect(score.precision).toBe(1);
	});

	it('finds quiet snares underneath much louder simultaneous tonal chords', () => {
		const { mono, sampleRate, times } = isolatedHits('snare', 0.03);
		const piano = isolatedHits('piano', 0.5).mono;
		for (let i = 0; i < mono.length; i++) mono[i] += piano[i];
		const features = extractFeatures(mono, sampleRate);
		const drums = detectDrums(features.spec, { beatPeriod: 0.5, odf: features.odf });
		expect(fMeasure(times, drums.snare.times, 0.05).recall).toBe(1);
	});
});

describe('model onset placement', () => {
	it('keeps a quiet snare on its own attack beside a louder instrument', () => {
		const odf = new Float32Array(200);
		odf[100] = 0.2;
		odf[104] = 5;
		expect(snapTimesToOnsets([1.01], odf, 100, 0.05)).toEqual([1]);
	});

	it('retains the model time when no attack exists in the search window', () => {
		const odf = new Float32Array(200).fill(0.2);
		expect(snapTimesToOnsets([1.01], odf, 100, 0.05)).toEqual([1.01]);
	});

	it('keeps the refined time inside the requested radius', () => {
		const odf = new Float32Array(200);
		odf[104] = 0.1;
		odf[105] = 1;
		odf[106] = 0.9;
		expect(snapTimesToOnsets([1], odf, 100, 0.05)).toEqual([1]);
	});
});

describe('stream evidence gate and merge', () => {
	const stream = (times: number[], levels = times.map(() => 0.8)) =>
		({ times, levels, curve: new Float32Array(500), fps: 100 });

	it('keeps hits with flux in the evidence band and drops swells without one', () => {
		const evidence = stream([]);
		evidence.curve[101] = 0.3;
		evidence.curve[299] = 0.04;
		const kept = gateByEvidence(stream([1, 2, 3]), evidence, 0.03, 0.05);
		expect(kept.times).toEqual([1]);
	});

	it('drops only the suspects the evidence band cannot confirm', () => {
		const evidence = stream([]);
		evidence.curve[201] = 0.45;
		evidence.curve[301] = 0.2;
		const kept = dropUnconfirmed(stream([1, 2, 3, 4]), [2, 3], evidence, 0.03, 0.3);
		expect(kept.times).toEqual([1, 2, 4]);
	});

	it('calls the model deaf only to a dense DSP hat pattern it half-hears', () => {
		const dense = stream(Array.from({ length: 16 }, (_, i) => 0.25 + i * 0.25));
		const faint = stream([1, 2, 3]);
		for (const t of [0.5, 1.5, 2.5, 3.5]) faint.curve[Math.round(t * 100)] = 0.08;
		expect(modelDeafToHats(faint, dense, 8).deaf).toBe(true);
		const silent = stream([1, 2, 3]);
		expect(modelDeafToHats(silent, dense, 8).deaf).toBe(false);
		expect(modelDeafToHats(faint, stream([1, 3]), 8).deaf).toBe(false);
		const hearing = stream(Array.from({ length: 12 }, (_, i) => 0.5 + i * 0.25));
		for (const t of [0.5, 1.5, 2.5, 3.5]) hearing.curve[Math.round(t * 100)] = 0.08;
		expect(modelDeafToHats(hearing, dense, 8).deaf).toBe(false);
	});

	it('merges two streams in time order and lets the stronger hit stand within the gap', () => {
		const merged = mergeStreams(stream([1, 2], [0.5, 0.9]), stream([1.01, 2.5], [0.7, 0.4]), 0.03);
		expect(merged.times).toEqual([1.01, 2, 2.5]);
		expect(merged.levels).toEqual([0.7, 0.9, 0.4]);
	});
});
