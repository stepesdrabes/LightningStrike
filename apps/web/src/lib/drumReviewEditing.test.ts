import { describe, expect, it } from 'vitest';
import { addMissedHit, beginDrumEditor, completeDrumEditor, drumDraftKey, laneTime, readDrumDraft, writeDrumDraft } from './drumReviewEditing.ts';
import type { DrumReview } from './drumReview.ts';

const review = (): DrumReview => ({ schema: 1, trackId: 'abcdefghijk', title: 'Song', duration: 100,
	audioHash: 'audio', analysis: { sha256: 'a'.repeat(64), hash: 'pcm', version: 36 },
	markers: { kick: { times: [1], levels: [1] }, snare: { times: [2], levels: [1] } },
	revision: 2, updatedAt: 0, range: { start: 20, end: 32 }, annotations: [] });

describe('direct missed-hit marking', () => {
	it('maps the lane rectangle rather than the whole page and clamps its edges', () => {
		expect(laneTime(350, 200, 600, 20, 32)).toBe(23);
		expect(laneTime(100, 200, 600, 20, 32)).toBe(20);
		expect(laneTime(900, 200, 600, 20, 32)).toBe(32);
		expect(laneTime(350, 200, 0, 20, 32)).toBeNull();
	});
	it('keeps multiple consecutive clicks and independent kick/snare marks', () => {
		const first = addMissedHit([], 'snare', 24, 'a');
		const second = addMissedHit(first.annotations, 'snare', 25, 'b');
		const third = addMissedHit(second.annotations, 'kick', 25, 'c');
		expect(third.annotations.map((a) => [a.kind, a.time])).toEqual([
			['snare', 24], ['snare', 25], ['kick', 25]
		]);
		expect(third.annotations.every((a) => a.verdict === 'missed' && a.markerTime === null)).toBe(true);
	});
	it('does not overwrite a previous judgement or duplicate a repeated click', () => {
		const first = addMissedHit([], 'snare', 24, 'a');
		first.annotations[0].note = 'quiet clap';
		const repeated = addMissedHit(first.annotations, 'snare', 24, 'b');
		expect(repeated.added).toBe(false);
		expect(repeated.annotations).toEqual(first.annotations);
	});
});

describe('durable browser drafts', () => {
	it('restores completed marks and an unfinished editor with the original base revision', () => {
		const r = review();
		const draft = { trackId: r.trackId, audioHash: r.audioHash, analysisSha256: r.analysis.sha256,
			baseRevision: 1, range: r.range, annotations: addMissedHit([], 'snare', 24, 'a').annotations,
			editor: { kind: 'snare', time: 2, marker: true, verdict: 'uncertain', note: 'listen again',
				heardTime: null, dirty: true }, updatedAt: 123 };
		expect(readDrumDraft(JSON.stringify(draft), r)).toEqual(draft);
	});
	it('cannot apply notes to changed audio or analysis and rejects malformed drafts', () => {
		const r = review();
		expect(drumDraftKey(r)).not.toBe(drumDraftKey({ ...r, audioHash: 'replacement' }));
		expect(drumDraftKey(r)).not.toBe(drumDraftKey({ ...r, analysis: { ...r.analysis, sha256: 'b' } }));
		expect(readDrumDraft('{bad', r)).toBeNull();
		expect(readDrumDraft(JSON.stringify({ trackId: r.trackId, audioHash: 'wrong' }), r)).toBeNull();
	});
});


describe('draft and judgment safeguards', () => {
	const store = () => {
		const values = new Map<string, string>();
		return { getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, raw: string) => { values.set(key, raw); },
			removeItem: (key: string) => { values.delete(key); } };
	};
	it('a clean tab cannot delete another tab draft, and an obsolete writer cannot replace it', () => {
		const storage = store();
		expect(writeDrumDraft(storage, 'song', 'first-tab', null)).toBe(true);
		expect(writeDrumDraft(storage, 'song', null, null)).toBe(true);
		expect(storage.getItem('song')).toBe('first-tab');
		expect(writeDrumDraft(storage, 'song', 'second-tab', 'first-tab')).toBe(true);
		expect(writeDrumDraft(storage, 'song', 'stale-first-tab', 'first-tab')).toBe(false);
		writeDrumDraft(storage, 'song', null, 'first-tab');
		expect(storage.getItem('song')).toBe('second-tab');
		writeDrumDraft(storage, 'song', null, 'second-tab');
		expect(storage.getItem('song')).toBeNull();
	});
	it('restores valid completed marks beside an unfinished invalid time, which cannot become a completed label', () => {
		const r = review();
		const annotations = addMissedHit([], 'snare', 24, 'a').annotations;
		const editor = { ...beginDrumEditor('snare', 2, true), verdict: 'early' as const,
			heardTime: 101, dirty: true, note: 'need to correct this number' };
		const raw = JSON.stringify({ trackId: r.trackId, audioHash: r.audioHash,
			analysisSha256: r.analysis.sha256, baseRevision: r.revision, range: r.range,
			annotations, editor, updatedAt: 123 });
		const restored = readDrumDraft(raw, r)!;
		expect(restored.annotations).toEqual(annotations);
		expect(restored.editor).toEqual(editor);
		expect(() => completeDrumEditor(annotations, restored.editor!, 'b', r)).toThrow('Invalid corrected time');
		expect(annotations).toHaveLength(1);
		expect(completeDrumEditor(annotations, { ...editor, heardTime: 2.1 }, 'b', r)).toHaveLength(2);
	});
	it('a tentative note remains uncertain until a real-hit verdict is explicitly selected', () => {
		const r = review(); const editor = { ...beginDrumEditor('snare', 2, true), note: 'possibly a hat', dirty: true };
		expect(completeDrumEditor([], editor, 'a', r)[0].verdict).toBe('uncertain');
		expect(completeDrumEditor([], { ...editor, verdict: 'real' }, 'a', r)[0].verdict).toBe('real');
		expect(completeDrumEditor([], beginDrumEditor('snare', 24, false), 'b', r)[0].verdict).toBe('missed');
	});
});
