import { describe, expect, it } from 'vitest';
import { detectSeparatedDrums, mergeSeparatedSnare } from './separatedDrums.ts';
import { extractFeatures } from './features.ts';
import type { DrumStream } from './drums.ts';

const rate = 22050;
const empty = (times: number[] = []): DrumStream => ({ times, levels: times.map(() => 1), curve: new Float32Array(600), fps: 100 });
function hit(audio: Float32Array, time: number, gain: number, tonal = false): void {
	let seed = 12345;
	for (let i = 0; i < rate * 0.12; i++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const sound = tonal ? Math.sin(2 * Math.PI * 70 * i / rate) : seed / 2147483648 - 1;
		audio[Math.round(time * rate) + i] += gain * sound * Math.exp(-i / (rate * 0.025));
	}
}

describe('isolated drum evidence', () => {
	it('recovers a quiet midrange clap under a kick without promoting high-frequency residue', () => {
		const kick = new Float32Array(rate * 6);
		const snare = new Float32Array(kick.length);
		const cymbal = new Float32Array(kick.length);
		hit(snare, 1, 1);
		hit(snare, 4, 1);
		for (const time of [2, 3]) {
			hit(kick, time, 2, true);
			for (let i = 0; i < rate * 0.12; i++) {
				snare[Math.round(time * rate) + i] += 0.03 * Math.sin(2 * Math.PI * (time === 2 ? 2000 : 6000) * i / rate) * Math.exp(-i / (rate * 0.025));
			}
		}
		const mix = Float32Array.from(kick, (value, i) => value + snare[i]);
		const features = extractFeatures(mix, rate);
		const result = detectSeparatedDrums({ kick, snare, cymbal, sampleRate: rate }, mix, rate,
			features.odf, features.curves.fps, { kick: empty(), snare: empty() });
		const recovered = result.snare.times.findIndex((time) => Math.abs(time - 2) < 0.025);
		expect(recovered).toBeGreaterThanOrEqual(0);
		expect(result.snare.levels[recovered]).toBeGreaterThanOrEqual(0.05);
		expect(result.snare.times.some((time) => Math.abs(time - 3) < 0.05)).toBe(false);
	});

	it('preserves supported legacy ghost hits and pairs source attacks once', () => {
		const snare = new Float32Array(rate * 6);
		hit(snare, 1, 1);
		hit(snare, 2, 0.02);
		const mix = Float32Array.from(snare, (value, i) => value + 0.1 * Math.sin(2 * Math.PI * 70 * i / rate));
		const legacy = { times: [1, 2, 3], levels: [0.9, 0.2, 0.4], invented: [false, true, false] };
		const source = { ...empty([1.002]), levels: [0.6] };
		const result = mergeSeparatedSnare(legacy, source, { snare, kick: new Float32Array(snare.length), sampleRate: rate }, mix, rate);
		expect(result).toEqual({ times: [1.002, 2], levels: [0.9, 0.2], invented: [false, true] });
	});

	it('recovers an almost erased measured snare only with independent attack and midrange evidence', () => {
		const snare = new Float32Array(rate * 8);
		const mix = new Float32Array(snare.length);
		for (const time of [1, 2, 3, 4, 5, 6, 7]) {
			for (let i = 0; i < rate * 0.12; i++) {
				const tone = Math.sin(2 * Math.PI * (time === 4 ? 6000 : 2000) * i / rate) * Math.exp(-i / (rate * 0.025));
				const at = Math.round(time * rate) + i;
				mix[at] = tone;
				snare[at] = tone * (time === 5 ? 0.0005 : time === 7 ? 0.01 : 0.002);
			}
		}
		const audio = { snare, kick: new Float32Array(snare.length), sampleRate: rate };
		const legacy = { times: [1, 2, 3, 4, 5, 6, 7], levels: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3],
			invented: [false, true, false, false, false, false, true] };
		// 2 is invented, 3 has no DSP attack, 4 is high-frequency bleed, 5 has too
		// little residue, and 6's DSP attack is too far away to support this hit.
		const independent = empty([1.02, 2, 4, 5, 6.08]);
		expect(mergeSeparatedSnare(legacy, empty(), audio, mix, rate, independent)).toEqual({
			times: [1, 7], levels: [0.2, 0.3], invented: [false, true]
		});
		// Without a distinct transcription model, DSP cannot serve as a second vote.
		expect(mergeSeparatedSnare(legacy, empty(), audio, mix, rate).times).toEqual([7]);
		expect(legacy.times).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it('vetoes a legacy cymbal transient even when its snare residue is loud', () => {
		const snare = new Float32Array(rate * 6);
		for (let i = 0; i < rate * 0.12; i++) snare[2 * rate + i] = Math.sin(2 * Math.PI * 6000 * i / rate) * Math.exp(-i / (rate * 0.025));
		const cymbal = Float32Array.from(snare, (value) => value * 1.2);
		const result = mergeSeparatedSnare({ times: [2], levels: [1], invented: [false] }, empty(),
			{ snare, cymbal, kick: new Float32Array(snare.length), sampleRate: rate }, snare, rate);
		expect(result.times).toEqual([]);
	});
	it('rejects cymbal leakage even with model support while retaining a snare under the same cymbal', () => {
		const snare = new Float32Array(rate * 6);
		const cymbal = new Float32Array(snare.length);
		hit(snare, 1, 1);
		for (const time of [1, 2]) {
			for (let i = 0; i < rate * 0.12; i++) {
				const tone = Math.sin(2 * Math.PI * 6000 * i / rate) * Math.exp(-i / (rate * 0.025));
				const at = Math.round(time * rate) + i;
				cymbal[at] += 3 * tone;
				if (time === 2) snare[at] += 0.8 * tone;
			}
		}
		const kick = new Float32Array(snare.length);
		const mix = Float32Array.from(snare, (value, i) => value + cymbal[i]);
		const features = extractFeatures(mix, rate);
		const result = detectSeparatedDrums({ kick, snare, cymbal, sampleRate: rate }, mix, rate,
			features.odf, features.curves.fps, { kick: empty(), snare: empty([1, 2]) });
		expect(result.snare.times.some((time) => Math.abs(time - 1) < 0.025)).toBe(true);
		expect(result.snare.times.some((time) => Math.abs(time - 2) < 0.05)).toBe(false);
	});
	it('rejects transcription events when the corresponding sources are silent', () => {
		const source = new Float32Array(rate * 6);
		const mix = new Float32Array(source.length);
		hit(mix, 2, 0.8);
		const features = extractFeatures(mix, rate);
		const result = detectSeparatedDrums({ kick: source, snare: source, sampleRate: rate }, mix, rate,
			features.odf, features.curves.fps, { kick: empty([2]), snare: empty([2]) });
		expect(result.kick.times).toEqual([]);
		expect(result.snare.times).toEqual([]);
	});

	it('checks the source class again when acoustic snapping moves into a cymbal attack', () => {
		const snare = new Float32Array(rate * 6);
		const cymbal = new Float32Array(snare.length);
		for (let i = 0; i < rate * 0.16; i++) {
			const at = 2 * rate + i;
			snare[at] += 3 * Math.sin(2 * Math.PI * 2000 * i / rate) * Math.exp(-i / (rate * 0.01));
			if (i >= Math.round(rate * 0.03)) {
				const tail = i - Math.round(rate * 0.03);
				const tone = Math.sin(2 * Math.PI * 6000 * tail / rate) * Math.exp(-tail / (rate * 0.03));
				snare[at] += 0.2 * tone;
				cymbal[at] += 3 * tone;
			}
		}
		const mix = Float32Array.from(snare, (value, i) => value + cymbal[i]);
		// The mix resolves this cluster to the later cymbal attack, within the permitted
		// 50ms snap window. Evidence at the earlier source peak must not label it a snare.
		const mixOdf = new Float32Array(600);
		mixOdf[203] = 1;
		const sources = { snare, cymbal, kick: new Float32Array(snare.length), sampleRate: rate };
		const earlierOdf = new Float32Array(600);
		earlierOdf[199] = 1;
		const earlier = detectSeparatedDrums(sources, mix, rate, earlierOdf, 100, { kick: empty(), snare: empty([2]) });
		expect(earlier.snare.times).toContain(1.99);
		const result = detectSeparatedDrums(sources,
			mix, rate, mixOdf, 100, { kick: empty(), snare: empty([2]) });
		expect(result.snare.times).toEqual([]);
	});

	it('admits a quieter source snare with independent DSP support at its measured strength', () => {
		const snare = new Float32Array(rate * 6);
		for (const [time, gain] of [[1, 1], [2, 0.22], [3, 0.17], [4, 1]]) {
			for (let i = 0; i < rate * 0.12; i++) {
				snare[Math.round(time * rate) + i] += gain * Math.sin(2 * Math.PI * 2000 * i / rate) * Math.exp(-i / (rate * 0.025));
			}
		}
		const sources = { snare, kick: new Float32Array(snare.length), cymbal: new Float32Array(snare.length), sampleRate: rate };
		// Residue is below the stronger source/mix admission floor, so DSP must corroborate it.
		const mix = Float32Array.from(snare, value => value * 30);
		const features = extractFeatures(mix, rate);
		const primary = { kick: empty(), snare: empty() };
		const withoutSupport = detectSeparatedDrums(sources, mix, rate, features.odf, features.curves.fps, primary);
		expect(withoutSupport.snare.times.some(time => Math.abs(time - 2) < .03)).toBe(false);
		const withSupport = detectSeparatedDrums(sources, mix, rate, features.odf, features.curves.fps, primary, empty([2, 3]));
		const recovered = withSupport.snare.times.findIndex(time => Math.abs(time - 2) < .03);
		expect(recovered).toBeGreaterThanOrEqual(0);
		expect(withSupport.snare.levels[recovered]).toBeGreaterThanOrEqual(.2);
		expect(withSupport.snare.levels[recovered]).toBeLessThan(.25);
		expect(withSupport.snare.times.some(time => Math.abs(time - 3) < .03)).toBe(false);
	});

	it('recovers a quiet isolated snare under a cymbal but rejects dominant kick leakage', () => {
		const snare = new Float32Array(rate * 6);
		const kick = new Float32Array(snare.length);
		const cymbal = new Float32Array(snare.length);
		for (const [time, gain] of [[1, 1], [2, 0.14], [3, 0.14], [4, 1]]) {
			for (let i = 0; i < rate * 0.12; i++) {
				const at = Math.round(time * rate) + i, decay = Math.exp(-i / (rate * 0.025));
				snare[at] += gain * Math.sin(2 * Math.PI * 2000 * i / rate) * decay;
				if (time === 2) cymbal[at] += 0.4 * Math.sin(2 * Math.PI * 6000 * i / rate) * decay;
				if (time === 3) kick[at] += 0.6 * Math.sin(2 * Math.PI * 70 * i / rate) * decay;
			}
		}
		const mix = Float32Array.from(snare, (value, i) => value * 6 + kick[i] + cymbal[i]);
		const features = extractFeatures(mix, rate);
		const result = detectSeparatedDrums({ snare, kick, cymbal, sampleRate: rate }, mix, rate,
			features.odf, features.curves.fps, { kick: empty(), snare: empty() });
		const recovered = result.snare.times.findIndex(time => Math.abs(time - 2) < .03);
		expect(recovered).toBeGreaterThanOrEqual(0);
		expect(result.snare.levels[recovered]).toBeGreaterThanOrEqual(.1);
		expect(result.snare.levels[recovered]).toBeLessThan(.2);
		expect(result.snare.times.some(time => Math.abs(time - 3) < .03)).toBe(false);
	});

	it('keeps a real snare with a simultaneous loud kick and places each on its acoustic attack', () => {
		const kick = new Float32Array(rate * 6);
		const snare = new Float32Array(kick.length);
		for (const time of [1, 2, 3, 4]) {
			hit(snare, time, time === 2 ? 0.3 : 1);
			hit(kick, time, 3, true);
		}
		const mix = Float32Array.from(kick, (value, i) => value + snare[i]);
		const features = extractFeatures(mix, rate);
		const result = detectSeparatedDrums({ kick, snare, sampleRate: rate }, mix, rate,
			features.odf, features.curves.fps, { kick: empty(), snare: empty() });
		for (const time of [1, 2, 3, 4]) expect(result.snare.times.some((t) => Math.abs(t - time) < 0.025)).toBe(true);
		expect(result.snare.times).toHaveLength(4);
		expect(result.snare.levels.every((value) => value > 0 && value <= 1)).toBe(true);
	});
});
