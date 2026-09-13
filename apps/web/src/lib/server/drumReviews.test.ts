import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DrumReviewStore, pinnedDrumReview, reviewFromAnalysis } from './drumReviews.ts';
import type { DrumReview, DrumReviewPatch } from '../drumReview.ts';

const folders: string[] = [];
const fixture = (): DrumReview => ({ schema: 1, trackId: 'abcdefghijk', title: 'Song', duration: 30,
	audioHash: 'audio', analysis: { sha256: 'a'.repeat(64), hash: 'pcm', version: 36 },
	markers: { kick: { times: [], levels: [] }, snare: { times: [2], levels: [1] } },
	revision: 0, updatedAt: 0, range: { start: 0, end: 12 }, annotations: [] });
const patch = (review: DrumReview): DrumReviewPatch => ({ trackId: review.trackId,
	audioHash: review.audioHash, analysisSha256: review.analysis.sha256, baseRevision: review.revision,
	range: review.range, annotations: [{ id: 'note', kind: 'snare', time: 2, markerTime: 2,
		verdict: 'real', heardTime: null, note: '' }] });
afterEach(async () => { for (const directory of folders.splice(0)) await rm(directory, { recursive: true }); });

describe('separate persisted drum reviews', () => {
	it('persists the exact reviewed markers and refuses concurrent stale writes', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'lightning-drum-review-')); folders.push(dir);
		const store = new DrumReviewStore(dir), review = fixture();
		const results = await Promise.allSettled([store.save(review, patch(review)), store.save(review, patch(review))]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(rejected.reason.status).toBe(409);
		const held = await store.read(review.trackId, review.analysis.sha256);
		expect(held?.revision).toBe(1); expect(held?.markers).toEqual(review.markers);
		const saved = JSON.parse(await readFile(join(dir, `${review.trackId}.${review.analysis.sha256}.json`), 'utf8'));
		expect(saved.annotations[0].verdict).toBe('real');
		await expect(store.save(review, { ...patch(review), baseRevision: 1, annotations: [] })).resolves.toMatchObject({ revision: 2 });
	});
	it('keeps prior analyses available when a new review is saved', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'lightning-drum-review-')); folders.push(dir);
		const store = new DrumReviewStore(dir), old = fixture();
		await store.save(old, patch(old));
		const next = { ...old, analysis: { ...old.analysis, sha256: 'b'.repeat(64), version: 37 } };
		await store.save(next, patch(next));
		expect(await store.versions(old.trackId)).toHaveLength(2);
		expect((await store.read(old.trackId, old.analysis.sha256))?.analysis.version).toBe(36);
		await expect(store.read('../escape', old.analysis.sha256)).rejects.toThrow();
	});
	it('lets a page pinned to saved older markers continue saving after publication', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'lightning-drum-review-')); folders.push(dir);
		const store = new DrumReviewStore(dir), old = fixture();
		await store.save(old, patch(old));
		const newer = { ...old, analysis: { ...old.analysis, sha256: 'b'.repeat(64) },
			markers: { ...old.markers, snare: { times: [3], levels: [1] } } };
		await store.save(newer, { ...patch(newer), annotations: [] });
		const pinned = await pinnedDrumReview(dir, store, old.trackId, old.analysis.sha256, old.audioHash);
		expect((await store.save(pinned, patch(pinned))).revision).toBe(2);
		expect((await store.read(old.trackId, newer.analysis.sha256))?.markers.snare.times).toEqual([3]);
		await expect(pinnedDrumReview(dir, store, old.trackId, old.analysis.sha256, 'changed-audio')).rejects.toThrow('song changed');
	});
	it('restores an unsaved older draft from the exact archived analysis and rejects tampering', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'lightning-drum-review-')); folders.push(dir);
		const store = new DrumReviewStore(join(dir, 'reviews')), old = fixture();
		const raw = JSON.stringify({ trackId: old.trackId, title: old.title, duration: old.duration,
			hash: old.analysis.hash, version: old.analysis.version, onsets: old.markers });
		const hash = createHash('sha256').update(raw).digest('hex');
		const stem = join(dir, `${old.trackId}.${hash}`);
		await writeFile(stem + '.analysis.json', raw);
		await writeFile(stem + '.identity.json', JSON.stringify({ audioHash: old.audioHash }));
		const pinned = await pinnedDrumReview(dir, store, old.trackId, hash, old.audioHash);
		expect(pinned).toEqual(reviewFromAnalysis(raw, old.trackId, old.audioHash));
		expect((await store.save(pinned, patch(pinned))).annotations).toHaveLength(1);
		await expect(pinnedDrumReview(dir, store, old.trackId, hash, 'changed-audio')).rejects.toThrow('song changed');
		const otherStore = new DrumReviewStore(join(dir, 'empty'));
		await writeFile(stem + '.analysis.json', raw + ' ');
		await expect(pinnedDrumReview(dir, otherStore, old.trackId, hash, old.audioHash)).rejects.toThrow('analysis or song changed');
	});
});
