import { describe, expect, it } from 'vitest';
import { snapToReviewedGrid } from './align-drum-review.ts';

describe('manual drum mark alignment', () => {
	it('uses local beat intervals rather than a fixed global tempo or a candidate grid', () => {
		const beats = [0, .5, 1.1, 1.5];
		expect(snapToReviewedGrid(.67, beats, 2)).toEqual({ time: .65, offsetMs: expect.closeTo(-20, 8),
			beatIndex: 1, fraction: .25 });
		expect(snapToReviewedGrid(1.31, beats, 2)?.time).toBeCloseTo(1.3);
		expect(beats).toEqual([0, .5, 1.1, 1.5]);
	});
	it('keeps boundary extrapolation bounded to one beat and inside the audio', () => {
		expect(snapToReviewedGrid(.02, [.1, .5, .9], 1.1)?.time).toBeCloseTo(0);
		expect(snapToReviewedGrid(1.08, [.1, .5, .9], 1.1)?.time).toBeCloseTo(1.1);
		expect(snapToReviewedGrid(1.8, [.1, .5, .9], 2)).toBeNull();
	});
	it('rejects absent or malformed grids without inventing a tempo', () => {
		for (const grid of [[], [0], [0, 0], [0, NaN], [.5, .3]]) {
			expect(snapToReviewedGrid(.4, grid, 2)).toBeNull();
		}
		expect(snapToReviewedGrid(-.1, [0, .5], 2)).toBeNull();
		expect(snapToReviewedGrid(2.1, [0, .5], 2)).toBeNull();
	});
});
