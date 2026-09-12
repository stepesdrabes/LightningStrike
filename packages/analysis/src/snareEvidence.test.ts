import { describe, expect, it } from 'vitest';
import { analyzeTrack } from './analyze.ts';
import { dropUnconfirmed, gateByEvidence, mergeStreams, withModelPeakFrames, snapTimesToOnsets, type DrumStream } from './drums.ts';
import { quantiseOnsets } from './quantise.ts';

const beats = Float64Array.from({ length: 25 }, (_, i) => i * 0.5);
const options = { beats, beatsPerBar: 4, duration: 12 };
function stream(times: number[], levels = times.map(() => 0.9)): DrumStream {
	const curve = new Float32Array(1201);
	for (let i = 0; i < times.length; i++) curve[Math.round(times[i] * 100)] = levels[i];
	return { times, levels, curve, fps: 100 };
}

describe('snare model evidence ownership', () => {
	it('cannot invent a surviving primary peak again after snapping it across a grid slot', () => {
		const primary = stream([0.5, 0.625, 2.5, 2.625, 4.57, 6.5, 6.625]);
		const odf = new Float32Array(1201);
		odf[455] = 1;
		const snapped = { ...primary, times: snapTimesToOnsets(primary.times, odf, 100, 0.05) };
		expect(snapped.times).toContain(4.55);
		expect(quantiseOnsets(snapped, options).times).toContain(4.57);

		const owned = withModelPeakFrames(primary);
		const result = quantiseOnsets({ ...owned, times: snapped.times }, options);
		expect(result.times).toEqual(snapped.times);
		expect(result.levels).toEqual(primary.levels);
		expect(result.invented.every((invented) => !invented)).toBe(true);
		expect(primary.sourceFrames).toBeUndefined();
	});

	it('preserves distinct weak source peaks and two separately detected flam strokes', () => {
		const primary = stream([0.5, 0.625, 2.5, 2.625, 4.54, 6.5, 6.625]);
		primary.curve[457] = 0.18;
		const owned = withModelPeakFrames(primary);
		const snapped = { ...owned, times: primary.times.map((t) => t === 4.54 ? 4.55 : t) };
		const result = quantiseOnsets(snapped, options);
		expect(result.times).toContain(4.55);
		expect(result.times).toContain(4.57);
		expect(result.invented[result.times.indexOf(4.57)]).toBe(true);

		const flam = stream([...primary.times, 4.57].sort((a, b) => a - b));
		const two = quantiseOnsets({ ...withModelPeakFrames(flam),
			times: flam.times.map((t) => t === 4.54 ? 4.55 : t) }, options);
		for (const time of [4.55, 4.57]) {
			expect(two.times).toContain(time);
			expect(two.invented[two.times.indexOf(time)]).toBe(false);
		}
	});

	it.each([
		{ slot: 0.625, source: 4.57, snapped: 4.55 },
		{ slot: 0.5, source: 4.55, snapped: 4.57 }
	])('allows source $source after its primary at $snapped is demoted, regardless of slot order', ({ slot, source, snapped }) => {
		// Ten active bars share a structural repeat identity. The weak primary snaps into
		// an unexpected slot and is demoted; the supported neighboring slot can reuse its
		// now-unowned model evidence. Both directions require demotion before promotion.
		const times = Array.from({ length: 10 }, (_, i) => i === 2 ? source : i * 2 + slot);
		const levels = times.map((_, i) => i === 2 ? 0.15 : 1);
		const curve = new Float32Array(2001), levelCurve = new Float32Array(2001);
		for (let i = 0; i < times.length; i++) {
			curve[Math.round(times[i] * 100)] = i === 2 ? 0.3 : 1;
			levelCurve[Math.round(times[i] * 100)] = levels[i];
		}
		const primary = withModelPeakFrames({ times, levels, curve, levelCurve, fps: 100 });
		const result = quantiseOnsets({ ...primary, times: times.map((t, i) => i === 2 ? snapped : t) }, {
			beats: Float64Array.from({ length: 41 }, (_, i) => i * 0.5), beatsPerBar: 4,
			duration: 20, demoteFloor: 0.9, barGroup: new Int32Array(10)
		});
		expect(result.times).toEqual(times);
		expect(result.times).not.toContain(snapped);
		expect(result.invented).toEqual(times.map((_, i) => i === 2));
		expect(result.levels[2]).toBeCloseTo(0.15 * 0.55);
	});

	it('keeps ownership for surviving off-grid detections that do not vote', () => {
		// The separate 4.0 hit keeps this bar active when its off-grid snare does not vote.
		const primary = stream([0.5, 0.625, 2.5, 2.625, 4.0, 4.57, 6.5, 6.625]);
		const times = primary.times.map((t) => t === 4.57 ? 4.55 : t);
		const opts = { ...options, tolerance: 0.2 };
		expect(quantiseOnsets({ ...primary, times }, opts).times).toContain(4.57);
		const result = quantiseOnsets({ ...withModelPeakFrames(primary), times }, opts);
		expect(result.times).toEqual(times);
		expect(result.invented.every((invented) => !invented)).toBe(true);
	});

	it('does not let a detection excluded by the output duration own in-range evidence', () => {
		const times = Array.from({ length: 10 }, (_, i) => i === 9 ? 18.55 : i * 2 + 0.5);
		const curve = new Float32Array(2001);
		for (const time of times) curve[Math.round(time * 100)] = 1;
		const primary = withModelPeakFrames({ times, levels: times.map(() => 1), curve, fps: 100 });
		const result = quantiseOnsets({ ...primary, times: times.map((t, i) => i === 9 ? 18.57 : t) }, {
			beats: Float64Array.from({ length: 41 }, (_, i) => i * 0.5), beatsPerBar: 4,
			duration: 18.56, barGroup: new Int32Array(10)
		});
		expect(result.times).toEqual(times);
		expect(result.invented[9]).toBe(true);
	});

	it('attaches frames in input order without changing evidence, times or levels', () => {
		const input = stream([2, 0, 1]);
		const result = withModelPeakFrames(input);
		expect(result.sourceFrames).toEqual([200, 0, 100]);
		expect(result.times).toBe(input.times);
		expect(result.curve).toBe(input.curve);
		expect(result.levels).toBe(input.levels);
		expect(input.sourceFrames).toBeUndefined();
	});

	it('filters source frames with their events and discards ambiguous merged provenance', () => {
		const input = withModelPeakFrames(stream([2, 0, 1]));
		const evidence = stream([1, 2]);
		const gated = gateByEvidence(input, evidence, 0.01, 0.5);
		expect(gated.times).toEqual([2, 1]);
		expect(gated.sourceFrames).toEqual([200, 100]);
		const vetoed = dropUnconfirmed(input, [0], evidence, 0.01, 0.5);
		expect(vetoed.times).toEqual([2, 1]);
		expect(vetoed.sourceFrames).toEqual([200, 100]);
		expect(mergeStreams(input, withModelPeakFrames(stream([1.5])), 0.01).sourceFrames).toBeUndefined();
		expect(input.sourceFrames).toEqual([200, 0, 100]);
	});

	it('analysis reserves primary snares without recurrence and leaves click-vetoed frames unowned', () => {
		// The supplied model gives one valid candidate and one unsupported click suspect.
		// This fixture tests ownership plumbing, not acoustic classification accuracy.
		const sampleRate = 22050;
		const mono = new Float32Array(sampleRate * 12);
		for (let i = 0; i < mono.length; i++) mono[i] = 0.02 * Math.sin(2 * Math.PI * 220 * i / sampleRate);
		const primary = stream([1, 2]);
		const probe: Record<string, any> = {};
		analyzeTrack({ mono, sampleRate, duration: 12, hash: 'ownership-test', trackId: 'file-000000000000',
			title: 'Model evidence ownership', beats: [...beats], downbeats: [0, 2, 4, 6, 8, 10],
			drums: { kick: stream([]), hat: stream([]), snare: primary, snareClicks: [2] }, probe });
		const detected = probe.drums.detected;
		expect(detected.snare.times).toHaveLength(1);
		expect(detected.snare.sourceFrames).toEqual([100]);
		expect(detected.snare.curve[200]).toBeGreaterThan(0);
		expect(detected.kick.sourceFrames).toBeUndefined();
		expect(detected.hat.sourceFrames).toBeUndefined();
		expect(primary.sourceFrames).toBeUndefined();
	});
});
