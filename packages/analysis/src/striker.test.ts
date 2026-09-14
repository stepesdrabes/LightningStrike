import { describe, expect, it } from 'vitest';
import {
	CANDIDATE_REVISION,
	STRIKER_FEATURES,
	drumCandidates,
	runStriker,
	strikerProbabilities,
	validateStrikerModel,
	type StrikerInputs,
	type StrikerModel
} from './striker.ts';
import type { DrumStream } from './drums.ts';
import { sourceOnsets } from './separatedDrums.ts';

const rate = 22050;
const feature = (name: typeof STRIKER_FEATURES[number]) => STRIKER_FEATURES.indexOf(name);
const leaf = (value: number) => ({ feature: [], threshold: [], left: [], right: [], leaf: [value] });
/** score = +4 when the stem hears the class strongly, -4 otherwise. */
const stemSplit = (column: string) => ({
	feature: [feature(column as typeof STRIKER_FEATURES[number])], threshold: [0.5], left: [~0], right: [~1], leaf: [-4, 4]
});

function model(): StrikerModel {
	return {
		version: 'test', candidates: CANDIDATE_REVISION, features: [...STRIKER_FEATURES],
		classes: {
			kick: { threshold: 0.5, trees: [stemSplit('stem0'), leaf(0)] },
			snare: { threshold: 0.5, trees: [stemSplit('stem1')] },
			hat: { threshold: 0.5, trees: [stemSplit('stem3')] },
			cymbal: { threshold: 0.5, trees: [stemSplit('stem4')] },
			tom: { threshold: 0.5, trees: [stemSplit('stem2')] }
		}
	};
}

function pulse(act: Float32Array, time: number, channel: number, height: number): void {
	for (let d = -2; d <= 2; d++) {
		const frame = Math.round(time * 100) + d;
		act[frame * 5 + channel] = Math.max(act[frame * 5 + channel], height * Math.exp(-d * d));
	}
}

function burst(audio: Float32Array, time: number, gain: number): void {
	let seed = 99;
	for (let i = 0; i < rate * 0.08; i++) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		audio[Math.round(time * rate) + i] += gain * (seed / 2147483648 - 1) * Math.exp(-i / (rate * 0.02));
	}
}

function inputs(): StrikerInputs {
	const seconds = 8;
	const frames = seconds * 100 + 1;
	const mix = new Float32Array(frames * 5);
	const stem = new Float32Array(frames * 5);
	for (const time of [1, 2, 3, 4, 5, 6]) pulse(mix, time, 0, 0.3);
	for (const time of [1, 2, 3, 4, 5]) pulse(stem, time, 0, 0.9);
	pulse(stem, 2.5, 1, 0.8);
	const kick = new Float32Array(seconds * rate);
	const snare = new Float32Array(kick.length);
	const hat = new Float32Array(kick.length);
	const cymbal = new Float32Array(kick.length);
	for (const time of [1, 2, 3, 4, 5]) burst(kick, time, 0.5);
	burst(snare, 2.5, 0.4);
	const audio = Float32Array.from(kick, (v, i) => v + snare[i] + cymbal[i] + 0.01 * Math.sin(i / 7));
	const dsp: DrumStream = { times: [], levels: [], curve: new Float32Array(frames), fps: 100 };
	return {
		mix, stem, audio, sources: { kick, snare, hat, cymbal, sampleRate: rate },
		sourceActivations: { kick: stem, snare: stem, hat: new Float32Array(frames * 5), cymbal: new Float32Array(frames * 5) },
		sourceOnsets: {
			kick: sourceOnsets(kick, rate), snare: sourceOnsets(snare, rate),
			hat: sourceOnsets(hat, rate), cymbal: sourceOnsets(cymbal, rate)
		},
		odf: new Float32Array(frames), odfFps: 100, dsp: { kick: dsp, snare: dsp, hat: dsp },
		beats: Float64Array.from({ length: 17 }, (_, i) => i * 0.5), barTimes: Float64Array.from({ length: 5 }, (_, i) => i * 2)
	};
}

describe('Striker', () => {
	it('evaluates flattened trees exactly, including single-leaf trees', () => {
		const candidates = { times: [0, 1], features: new Float32Array(STRIKER_FEATURES.length * 2), strength: [0, 0] };
		candidates.features[feature('stem0')] = 0.9;
		const p = strikerProbabilities(model(), 'kick', candidates);
		expect(p[0]).toBeCloseTo(1 / (1 + Math.exp(-4)), 12);
		expect(p[1]).toBeCloseTo(1 / (1 + Math.exp(4)), 12);
	});

	it('refuses a model trained on another feature list', () => {
		const stale = { ...model(), features: STRIKER_FEATURES.slice(1) };
		expect(() => validateStrikerModel(stale)).toThrow(/features/);
		expect(() => validateStrikerModel({ ...model(), candidates: CANDIDATE_REVISION - 1 })).toThrow(/candidates/);
		expect(() => validateStrikerModel({ ...model(), classes: { ...model().classes, hat: { threshold: 0, trees: [] } } }))
			.toThrow(/hat/);
	});

	it('refuses trees that could loop, read outside the features or reach no leaf, but allows no tom class', () => {
		type Tree = StrikerModel['classes']['snare']['trees'][number];
		const withSnare = (tree: Tree) => ({
			...model(), classes: { ...model().classes, snare: { threshold: 0.5, trees: [tree] } }
		});
		const split = { feature: [0], threshold: [0.5], left: [~0], right: [~1], leaf: [-1, 1] };
		expect(() => validateStrikerModel(withSnare({ ...split, left: [0] }))).toThrow(/snare/);
		expect(() => validateStrikerModel(withSnare({ ...split, feature: [STRIKER_FEATURES.length] }))).toThrow(/snare/);
		expect(() => validateStrikerModel(withSnare({ ...split, right: [~2] }))).toThrow(/snare/);
		expect(() => validateStrikerModel(withSnare({ ...split, left: [0.5] }))).toThrow(/snare/);
		expect(() => validateStrikerModel({ ...model(), version: '' })).toThrow(/version/);
		const { tom: _, ...classes } = model().classes;
		expect(() => validateStrikerModel({ ...model(), classes })).not.toThrow();
	});

	it('places each named feature in its column', () => {
		const candidates = drumCandidates(inputs(), 'kick');
		const row = candidates.times.findIndex((time) => Math.abs(time - 1) < 0.05);
		const at = (name: typeof STRIKER_FEATURES[number]) => candidates.features[row * STRIKER_FEATURES.length + feature(name)];
		expect(at('mix0')).toBeCloseTo(0.3, 5);
		expect(at('stem0')).toBeCloseTo(0.9, 5);
		expect(at('kickModel0')).toBeCloseTo(0.9, 5);
		expect(at('hatModel0')).toBe(0);
		expect(at('kickDb')).toBeGreaterThan(at('snareDb') + 20);
		expect(at('kickRise')).toBeGreaterThan(10);
		expect(at('fromMix') + at('fromStem')).toBe(2);
		expect(at('kickSub')).toBeGreaterThan(at('snareMid'));
	});

	it('proposes model and source candidates once each and describes both passes', () => {
		const candidates = drumCandidates(inputs(), 'kick');
		const near = (t: number) => candidates.times.filter((time) => Math.abs(time - t) < 0.05).length;
		for (const time of [1, 2, 3, 4, 5, 6]) expect(near(time)).toBe(1);
		const row = candidates.times.findIndex((time) => Math.abs(time - 6) < 0.05);
		expect(candidates.features[row * STRIKER_FEATURES.length + feature('stem0')]).toBeLessThan(0.05);
		expect(candidates.features[row * STRIKER_FEATURES.length + feature('mix0')]).toBeCloseTo(0.3, 5);
		expect(candidates.features.every(Number.isFinite)).toBe(true);
	});

	it('proposes faint snare activation, as ghost notes leave, but not faint kick activation', () => {
		const base = inputs();
		pulse(base.mix, 6.5, 1, 0.035);
		pulse(base.mix, 7.5, 0, 0.035);
		const near = (times: number[], t: number) => times.some((time) => Math.abs(time - t) < 0.05);
		expect(near(drumCandidates(base, 'snare').times, 6.5)).toBe(true);
		expect(near(drumCandidates(base, 'kick').times, 7.5)).toBe(false);
	});

	it('keeps the more probable of accepted hits under 50 ms apart, across selection buckets', () => {
		const width = STRIKER_FEATURES.length;
		const rows = [{ time: 0.149, mix: 0.1 }, { time: 0.151, mix: 0.9 }, { time: 1, mix: 0.1 }, { time: 1.05, mix: 0.1 }];
		const features = new Float32Array(rows.length * width);
		rows.forEach(({ mix }, i) => {
			features[i * width + feature('stem0')] = 0.9;
			features[i * width + feature('mix0')] = mix;
		});
		const classifier = model();
		classifier.classes.kick = { threshold: 0.5, trees: [stemSplit('stem0'), { ...stemSplit('mix0'), leaf: [0, 1] }] };
		const proposed = { kick: { times: rows.map((r) => r.time), features, strength: rows.map(() => 1) } };
		expect(runStriker(classifier, inputs(), proposed).kick.times).toEqual([0.151, 1, 1.05]);
	});

	it('proposes a soft snare attack in its separated source, but not an equally soft kick', () => {
		const base = inputs();
		const attack = ({ odf, fps }: { odf: Float32Array; fps: number }, time: number) => {
			const curve = Float32Array.from(odf);
			for (let d = -2; d <= 2; d++) curve[Math.round(time * fps) + d] = 0.06 * (1 - Math.abs(d) / 3);
			return { odf: curve, fps };
		};
		const soft = {
			...base, sourceOnsets: {
				...base.sourceOnsets, kick: attack(base.sourceOnsets.kick, 7.25), snare: attack(base.sourceOnsets.snare, 6.5)
			}
		};
		const near = (times: number[], t: number) => times.some((time) => Math.abs(time - t) < 0.05);
		expect(near(drumCandidates(soft, 'snare').times, 6.5)).toBe(true);
		expect(near(drumCandidates(soft, 'kick').times, 7.25)).toBe(false);
	});

	it('keeps the hits the classifier accepts, one per attack, with bounded levels', () => {
		const hits = runStriker(model(), inputs());
		expect(hits.kick.times.map((t) => Math.round(t * 10) / 10)).toEqual([1, 2, 3, 4, 5]);
		expect(hits.snare.times.map((t) => Math.round(t * 10) / 10)).toEqual([2.5]);
		expect(hits.hat.times).toEqual([]);
		expect(hits.cymbal.times).toEqual([]);
		expect(hits.tom).toBeUndefined();
		for (const stream of Object.values(hits)) {
			expect(stream.levels.every((level) => level > 0 && level <= 1)).toBe(true);
		}
	});

	it('gives a snare the transcription barely hears the level of equally loud snares', () => {
		const base = inputs();
		const snare = new Float32Array(base.sources.snare.length);
		const heard = new Float32Array(base.mix.length);
		for (const time of [1.5, 2.5, 3.5, 4.5]) {
			burst(snare, time, 0.4);
			pulse(heard, time, 1, 0.9);
		}
		const classifier = model();
		classifier.classes.snare = { threshold: 0.5, trees: [stemSplit('snareModel1')] };
		const hits = runStriker(classifier, {
			...base, sources: { ...base.sources, snare },
			sourceOnsets: { ...base.sourceOnsets, snare: sourceOnsets(snare, rate) },
			sourceActivations: { ...base.sourceActivations, snare: heard }
		});
		expect(hits.snare.times.map((t) => Math.round(t * 10) / 10)).toEqual([1.5, 2.5, 3.5, 4.5]);
		expect(Math.min(...hits.snare.levels)).toBeGreaterThan(0.9);
	});
});
