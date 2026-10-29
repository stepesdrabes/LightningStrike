import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPages, clipClasses } from './annotate/pages.js';
import {
	confirmedPages, ownerEvents, plainReview, type Annotation, type ClipTimes
} from './annotate/reviewed.ts';

// Synthetic reviews of Striker 1.x clips and the sha256 of the `owner` events the export at af0669f
// wrote for each: one page, three pages with marks on and beside page edges, a clip marked
// `reviewed`, a clip without downbeats paged every 2 s with an index past its last page, and a clip
// whose first downbeat at 0.15 s leaves its start outside every page.
const FIXTURE = join(import.meta.dirname, 'annotate', 'testdata', 'old-reviews.json');
const OLD = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
	clips: Record<string, ClipTimes>;
	annotations: Record<string, Annotation>;
	events: Record<string, { count: number; sha256: string }>;
};

const annotation = (hits: Record<string, number[]>, confirmed: number[], extra = {}): Annotation => ({
	id: 'x', corpus: 'file', track: 'x.wav', title: 'x', genre: '', start: 12, seconds: 10, hits,
	confirmed, ...extra
});
const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('the owner corpus export', () => {
	it('writes the events it wrote before Striker 2.0 for every Striker 1.x clip', () => {
		for (const [id, clip] of Object.entries(OLD.clips)) {
			const review = OLD.annotations[id];
			const { confirmed } = confirmedPages(review, clip);
			const events = ownerEvents(review, clip, confirmed);
			expect(events.length, id).toBe(OLD.events[id].count);
			expect(sha256(events), id).toBe(OLD.events[id].sha256);
		}
	});

	it('reviews a Striker 1.x clip for four classes and a Striker 2.0 clip for five', () => {
		expect(clipClasses(OLD.clips['synth__one-page'])).toEqual(['kick', 'snare', 'hat', 'cymbal']);
		const clip = {
			beats: [], downbeats: [0, 2, 4], seconds: 6, classes: ['kick', 'snare', 'hat', 'cymbal', 'tom']
		};
		const review = annotation({ tom: [0.5] }, [0]);
		const events = ownerEvents(review, clip, confirmedPages(review, clip).confirmed);
		expect(events.filter((e) => e.sub !== 'unreviewed')).toEqual([{ time: 0.5, cls: 'tom' }]);
		expect(new Set(events.map((e) => e.cls))).toEqual(new Set(clip.classes));
	});
});

describe('the striker-2 export', () => {
	// Downbeats every 2 s from 0.15 s: nothing pages [0, 0.15), then [0.15, 4.15), [4.15, 8.15), [8.15, 10).
	const clip: ClipTimes = {
		beats: [], downbeats: [0.15, 2.15, 4.15, 6.15, 8.15], seconds: 10,
		classes: ['kick', 'snare', 'hat', 'cymbal', 'tom']
	};

	it('pages a clip exactly as the annotator does', () => {
		const { pages, confirmed } = confirmedPages(annotation({}, [0, 2]), clip);
		expect(pages).toEqual(buildPages(clip));
		expect(confirmed).toEqual([pages[0], pages[2]]);
	});

	it('keeps onsets on confirmed pages only and marks every other span unreviewed', () => {
		const hits = {
			kick: [0.1, 0.15, 4.1499, 4.15, 9.99], hat: [8.15, 5], tom: [2.5], cymbal: [], snare: [1.23456]
		};
		const review = plainReview(annotation(hits, [0, 2]), clip);
		expect(review.classes).toEqual(clip.classes);
		expect(review.confirmed).toEqual([[0.15, 4.15], [8.15, 10]]);
		expect(review.unreviewed).toEqual([[0, 0.15], [4.15, 8.15]]);
		expect(review.onsets).toEqual([
			{ time: 0.15, class: 'kick' }, { time: 1.2346, class: 'snare' }, { time: 2.5, class: 'tom' },
			{ time: 4.1499, class: 'kick' }, { time: 8.15, class: 'hat' }, { time: 9.99, class: 'kick' }
		]);
	});

	it('counts every page of a reviewed clip and nothing of an unconfirmed one', () => {
		const all = plainReview(annotation({ snare: [3] }, [], { reviewed: true }), clip);
		expect(all.confirmed).toEqual(buildPages(clip).map((p) => [p.from, p.to]));
		expect(all.unreviewed).toEqual([[0, 0.15]]);
		const none = plainReview(annotation({ snare: [3] }, []), clip);
		expect([none.confirmed, none.unreviewed, none.onsets]).toEqual([[], [[0, 10]], []]);
	});

	it('leaves the tom out of a Striker 1.x clip, which never had its lane', () => {
		const old = { beats: [], downbeats: [0, 2, 4, 6], seconds: 8 };
		const review = plainReview(annotation({ kick: [1], tom: [1] }, [0, 1]), old);
		expect(review.classes).toEqual(['kick', 'snare', 'hat', 'cymbal']);
		expect(review.onsets).toEqual([{ time: 1, class: 'kick' }]);
		expect(review.unreviewed).toEqual([]);
	});
});
