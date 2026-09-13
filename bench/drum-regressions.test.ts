import { describe, expect, it } from 'vitest';
import { scoreDrumRegression, type DrumRegressionLabels } from './drum-regressions.ts';

const labels = (snare: number[], extra: Partial<DrumRegressionLabels> = {}): DrumRegressionLabels => ({
	trackId: 'test-track', annotationType: 'positive-only', snare, ...extra
});
const analysis = (times: number[], levels = times.map(() => 1)) => ({
	trackId: 'test-track', onsets: { snare: { times, levels }, kick: { times: [], levels: [] }, hat: { times: [], levels: [] } }
});

describe('partial drum regressions', () => {
	it('scores explicitly confirmed negatives without treating unlisted events as false positives', () => {
		const report = scoreDrumRegression(labels([1], { annotationType: 'partial', nonSnare: [2, 3] }), analysis([1, 2.01, 4]));
		expect(report.confirmedNegativeCount).toBe(2);
		expect(report.violatedNegativeCount).toBe(1);
		expect(report.negatives[0].nearby[0]?.time).toBe(2.01);
		expect(report).not.toHaveProperty('precision');
	});
	it('includes the tolerance boundary and reports signed nearest timing outside it', () => {
		const report = scoreDrumRegression(labels([1, 2]), analysis([1.05, 2.051], [0.7, 0.8]));
		expect(report.matchedPositiveCount).toBe(1);
		expect(report.positives[0].matched?.deltaMs).toBeCloseTo(50);
		expect(report.positives[1].matched).toBeNull();
		expect(report.positives[1].nearest?.deltaMs).toBeCloseTo(51);
		expect(report.positives[1].nearest?.level).toBe(0.8);
	});
	it('cannot match two confirmed positives to one detected hit', () => {
		const report = scoreDrumRegression(labels([1, 1.06]), analysis([1.03]));
		expect(report.confirmedPositiveCount).toBe(2);
		expect(report.matchedPositiveCount).toBe(1);
	});
	it('finds maximum matching when nearest-hit greedy matching would lose a match', () => {
		const report = scoreDrumRegression(labels([1, 1.06]), analysis([1.01, 0.96], [0.7, 0.8]));
		expect(report.matchedPositiveCount).toBe(2);
		expect(report.positives[0].matched?.time).toBe(0.96);
		expect(report.positives[0].matched?.level).toBe(0.8);
		expect(report.positives[1].matched?.time).toBe(1.01);
	});
	it('keeps provisional and uncertain observations outside positive scores', () => {
		const report = scoreDrumRegression(labels([1], { probableNonSnare: [2], uncertain: [3] }), analysis([1, 2, 3, 4]));
		expect(report.confirmedPositiveCount).toBe(1);
		expect(report.matchedPositiveCount).toBe(1);
		expect(report.provisional.probableNonSnare[0].nearby).toHaveLength(1);
		expect(report.provisional.uncertain[0].nearby).toHaveLength(1);
		expect(report).not.toHaveProperty('precision');
		expect(report).not.toHaveProperty('recall');
		expect(report).not.toHaveProperty('falsePositives');
	});
	it('separates missed detections from hits below the diagnostic lighting level', () => {
		const report = scoreDrumRegression(labels([1, 2]), analysis([1, 2], [0.04, 0.05]), { minLevel: 0.05 });
		expect(report.matchedPositiveCountBeforeLevelFilter).toBe(2);
		expect(report.matchedPositiveCount).toBe(1);
		expect(report.positives[0].nearest?.level).toBe(0.04);
		expect(report.positives[0].matched).toBeNull();
	});
	it('handles empty streams and rejects mismatched track identity', () => {
		expect(scoreDrumRegression(labels([1]), analysis([])).positives[0].nearest).toBeNull();
		expect(() => scoreDrumRegression(labels([1], { trackId: 'other-track' }), analysis([1]))).toThrow('Track mismatch');
	});
});
