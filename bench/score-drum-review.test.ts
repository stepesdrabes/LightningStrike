import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TrackAnalysis } from '@mv/core';
import type { DrumReview } from '../apps/web/src/lib/drumReview.ts';
import { provisionalIdsForReview, referenceBeatsForReview, scoreDrumReview } from './score-drum-review.ts';

const candidate = { trackId: 'abcdefghijk', hash: 'same-pcm', version: 35,
	onsets: { kick: { times: [1, 2], levels: [1, 1] }, snare: { times: [1, 3], levels: [1, 1] } }
} as unknown as TrackAnalysis;
const review = { schema: 1, trackId: candidate.trackId, duration: 4, analysis: { hash: 'same-pcm', sha256: 'review-hash' },
	annotations: [
		{ id: 'a', kind: 'snare', time: 1, verdict: 'real', heardTime: null },
		{ id: 'b', kind: 'snare', time: 1.03, verdict: 'real', heardTime: null },
		{ id: 'c', kind: 'kick', time: 2, verdict: 'wrong', heardTime: null },
		{ id: 'd', kind: 'kick', time: 3.1, verdict: 'missed', heardTime: null },
		{ id: 'e', kind: 'snare', time: 3, verdict: 'early', heardTime: 3.1 }
	] } as unknown as DrumReview;
describe('saved listening review scoring', () => {
	it('matches confirmed hits one to one and leaves manual placements unscored', () => {
		const score = scoreDrumReview(review, candidate);
		expect(score.confirmedReal).toBe(2);
		expect(score.matchedReal).toBe(1);
		expect(score.remainingWrong).toBe(1);
		expect(score.observations).toHaveLength(2);
		expect(score.negatives).toHaveLength(1);
	});
	it('rejects another audio identity even when the track title or id is reused', () => {
		expect(() => scoreDrumReview(review, { ...candidate, hash: 'different-pcm' })).toThrow('same track');
	});
	it('accepts verified identical encoded audio across decoder versions and reports the PCM change', () => {
		const audioHash = 'a'.repeat(64);
		expect(scoreDrumReview({ ...review, audioHash }, { ...candidate, hash: 'other-decoder' }, 50, audioHash)
			.pcmHashChanged).toBe(true);
	});
	it('retains provisional real and wrong verdicts as observations without counting them as confirmed', () => {
		const original = JSON.stringify(review);
		const score = scoreDrumReview(review, candidate, 50, undefined, { provisionalIds: ['a', 'c'] });
		expect(score.confirmedReal).toBe(1);
		expect(score.confirmedWrong).toBe(0);
		expect(score.provisionalAnnotations).toBe(2);
		expect(score.observations.find(row => row.id === 'c')).toMatchObject({
			verdict: 'wrong', sourceVerdict: 'wrong', evaluation: 'provisional', time: 2
		});
		expect(JSON.stringify(review)).toBe(original);
	});
	it('matches overlay identity and exact annotation IDs instead of excluding an entire song or kind', () => {
		const r = { ...review, audioHash: 'audio-sha' };
		const entry = { trackId: r.trackId, audioHash: r.audioHash, analysisSha256: r.analysis.sha256,
			kind: 'snare', annotationIds: ['a', 'c', 'absent'], evaluation: 'provisional',
			excludeFromConfirmedPositiveAndNegativeCounts: true };
		expect(provisionalIdsForReview(r, { schema: 1, overrides: [entry] })).toEqual(['a']);
		for (const field of ['trackId', 'audioHash', 'analysisSha256']) {
			expect(provisionalIdsForReview(r, { schema: 1, overrides: [{ ...entry, [field]: 'different' }] })).toEqual([]);
		}
	});
	it('loads the actual Like a Prayer overlay while keeping its kick observations usable', () => {
		const overlay = JSON.parse(readFileSync(new URL('./judged/drum-review-evaluation.json', import.meta.url), 'utf8'));
		const entry = overlay.overrides[0];
		const r = { ...review, trackId: entry.trackId, audioHash: entry.audioHash,
			analysis: { ...review.analysis, sha256: entry.analysisSha256 }, annotations: [
				{ ...review.annotations[0], id: entry.annotationIds[0], verdict: 'wrong' as const },
				review.annotations[3]
			] };
		const score = scoreDrumReview(r, { ...candidate, trackId: r.trackId }, 50, undefined,
			{ provisionalIds: provisionalIdsForReview(r, overlay) });
		expect(score.confirmedWrong).toBe(0);
		expect(score.observations.map(row => [row.kind, row.evaluation])).toEqual([
			['snare', 'provisional'], ['kick', 'observation']
		]);
	});
	it('uses the reviewed beat grid only for manual observations and preserves both original placements', () => {
		const r = { ...review, annotations: [
			{ ...review.annotations[3], kind: 'snare' as const, time: 3.02 },
			{ ...review.annotations[4], time: 2.99, heardTime: 3.01 }
		] };
		const score = scoreDrumReview(r, candidate, 50, undefined, { referenceBeats: [0, 1, 2, 3, 4] });
		expect(score.confirmedReal).toBe(0);
		expect(score.confirmedWrong).toBe(0);
		expect(score.observations[0]).toMatchObject({ time: 3.02, placementTime: 3.02,
			gridTime: 3, comparisonTime: 3, nearestCandidate: 3, distanceFromGridMs: 0 });
		expect(score.observations[0].distanceFromPlacementMs).toBeCloseTo(-20);
		expect(score.observations[1]).toMatchObject({ time: 2.99, heardTime: 3.01,
			placementTime: 3.01, gridTime: 3, nearestCandidate: 3 });
	});
	it('rejects candidate or altered grids unless the raw reviewed analysis hash and track both match', () => {
		const bytes = Buffer.from(JSON.stringify({ trackId: review.trackId, beats: [0, 1, 2] }));
		const r = { ...review, analysis: { ...review.analysis, sha256: createHash('sha256').update(bytes).digest('hex') } };
		expect(referenceBeatsForReview(r, bytes)).toEqual([0, 1, 2]);
		expect(() => referenceBeatsForReview(r, Buffer.concat([bytes, Buffer.from(' ')]))).toThrow('SHA-256');
		expect(() => referenceBeatsForReview({ ...r, trackId: 'other-track' }, bytes)).toThrow('track');
	});
});
