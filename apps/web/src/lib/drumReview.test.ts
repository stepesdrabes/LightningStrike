import { describe, expect, it } from 'vitest';
import { reviewPosition, validateDrumPatch, type DrumReview, type DrumReviewPatch } from './drumReview.ts';

export const reviewFixture = (): DrumReview => ({ schema: 1, trackId: 'abcdefghijk', title: 'Song',
	duration: 100, audioHash: 'audio', analysis: { sha256: 'a'.repeat(64), hash: 'pcm', version: 36 },
	markers: { kick: { times: [1], levels: [0.7] }, snare: { times: [2], levels: [0.4] } },
	revision: 0, updatedAt: 0, range: { start: 0, end: 12 }, annotations: [] });

export const patchFixture = (review = reviewFixture()): DrumReviewPatch => ({ trackId: review.trackId,
	audioHash: review.audioHash, analysisSha256: review.analysis.sha256, baseRevision: review.revision,
	range: review.range, annotations: [{ id: 'one', kind: 'snare', time: 2, markerTime: 2,
		verdict: 'real', heardTime: null, note: 'clap' }] });

describe('drum listening labels', () => {
	it('keeps marker labels and manually placed missed hits distinct', () => {
		const patch = patchFixture();
		patch.annotations.push({ id: 'two', kind: 'kick', time: 3.2, markerTime: null,
			verdict: 'missed', heardTime: null, note: 'quiet' });
		expect(validateDrumPatch(patch, reviewFixture()).annotations).toEqual(patch.annotations);
	});
	it('rejects forged marker references and labels outside the song', () => {
		const patch = patchFixture();
		patch.annotations[0].markerTime = 2.01;
		expect(() => validateDrumPatch(patch, reviewFixture())).toThrow('click');
		patch.annotations[0] = { ...patch.annotations[0], markerTime: null, verdict: 'missed', time: 101 };
		expect(() => validateDrumPatch(patch, reviewFixture())).toThrow('note');
	});
	it('refuses a different analysis or different audio', () => {
		for (const changed of [{ analysisSha256: 'b'.repeat(64) }, { audioHash: 'different' }]) {
			expect(() => validateDrumPatch({ ...patchFixture(), ...changed }, reviewFixture())).toThrow('changed');
		}
	});
	it('bounds passage length, text and duplicate ids', () => {
		expect(() => validateDrumPatch({ ...patchFixture(), range: { start: 0, end: 30 } }, reviewFixture())).toThrow('passage');
		const patch = patchFixture(); patch.annotations[0].note = 'x'.repeat(1001);
		expect(() => validateDrumPatch(patch, reviewFixture())).toThrow('note');
		patch.annotations[0].note = ''; patch.annotations.push(patch.annotations[0]);
		expect(() => validateDrumPatch(patch, reviewFixture())).toThrow('id');
	});
	it('keeps uncertain and timing-only judgements out of class labels', () => {
		const patch = patchFixture(); patch.annotations[0].verdict = 'early';
		patch.annotations[0].heardTime = 2.04;
		expect(validateDrumPatch(patch, reviewFixture()).annotations[0].verdict).toBe('early');
		patch.annotations[0].verdict = 'uncertain';
		expect(validateDrumPatch(patch, reviewFixture()).annotations[0].verdict).toBe('uncertain');
	});
});

describe('audio clock position', () => {
	it('uses the same exact loop boundary repeatedly without accumulating drift', () => {
		expect(reviewPosition(0.5, 19.5, 8, 20, true)).toBe(8);
		expect(reviewPosition(1200.5, 19.5, 8, 20, true)).toBe(8);
		expect(reviewPosition(0.8, 19.5, 8, 20, true)).toBeCloseTo(8.3);
	});
	it('does not advance before the scheduled start and clamps whole-song playback', () => {
		expect(reviewPosition(-0.03, 10, 8, 20, true)).toBe(10);
		expect(reviewPosition(15, 10, 0, 20, false)).toBe(20);
	});
});
