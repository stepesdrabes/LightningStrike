import { describe, expect, it } from 'vitest';
import { mergeKickEvidence } from './kickEvidence.ts';
import type { DrumStream } from './drums.ts';

const rate = 22050;
const stream = (times: number[], support = 0): DrumStream => {
	const curve = new Float32Array(300);
	for (const time of times) curve[Math.round(time * 100)] = support;
	return { times, levels: times.map(() => .5), curve, fps: 100 };
};
function pulse(audio: Float32Array, time: number, hz = 55, gain = 1) {
	for (let i = 0; i < rate * .2; i++) {
		audio[Math.round(time * rate) + i] += gain * Math.sin(2 * Math.PI * hz * i / rate) * Math.exp(-i / (rate * .035));
	}
}
const empty = { times: [], levels: [], invented: [] };

describe('independent kick evidence', () => {
	it('recovers measured quiet-model kicks once and preserves existing attack timing', () => {
		const source = new Float32Array(rate * 3);
		pulse(source, 1); pulse(source, 2);
		const legacy = { times: [1.015], levels: [.7], invented: [false] };
		const result = mergeKickEvidence(legacy, stream([1, 2]), source, source, stream([1, 2], .1), rate);
		expect(result).toEqual({ times: [1.015, 2], levels: [.7, .85], invented: [false, false] });
		expect(legacy.times).toEqual([1.015]);
	});

	it('does not turn isolated bass or a pedal thump into a kick without independent evidence', () => {
		const source = new Float32Array(rate * 3); pulse(source, 1);
		expect(mergeKickEvidence(empty, stream([1]), source, source, stream([1], .02), rate).times).toEqual([]);
		expect(mergeKickEvidence(empty, stream([]), source, source, stream([1], .2), rate).times).toEqual([]);
		const bass = Float32Array.from(source, (_, i) => Math.sin(2 * Math.PI * 55 * i / rate));
		expect(mergeKickEvidence(empty, stream([1]), bass, bass, stream([1], .2), rate).times).toEqual([]);
	});

	it('rejects high-frequency leakage and a weak separated residue despite model support', () => {
		const source = new Float32Array(rate * 3); pulse(source, 1, 3000);
		expect(mergeKickEvidence(empty, stream([1]), source, source, stream([1], .2), rate).times).toEqual([]);
		const mix = new Float32Array(rate * 3); pulse(mix, 1);
		const residue = Float32Array.from(mix, v => v * .02);
		expect(mergeKickEvidence(empty, stream([1]), residue, mix, stream([1], .2), rate).times).toEqual([]);
	});

	it('removes an unsupported vocal false hit while retaining strong or independently detected hits', () => {
		const mix = Float32Array.from({ length: rate * 3 }, (_, i) => Math.sin(2 * Math.PI * 1000 * i / rate));
		const residue = Float32Array.from(mix, v => v * .001);
		const legacy = { times: [.5, 1, 2], levels: [.5, .9, .5], invented: [false, false, true] };
		expect(mergeKickEvidence(legacy, stream([2]), residue, mix, stream([]), rate)).toEqual({
			times: [1, 2], levels: [.9, .5], invented: [false, true]
		});
	});
});
