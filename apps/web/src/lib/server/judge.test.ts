import { describe, expect, it } from 'vitest';
import { mergeJudgement, type JudgedSection, type Judgement } from './judge.ts';

const MAP: JudgedSection[] = [
	{ kind: 'intro', startTime: 0, endTime: 16, startBar: 0, endBar: 8 },
	{ kind: 'drop', startTime: 16, endTime: 48, startBar: 8, endBar: 24 }
];

const REDRAWN: JudgedSection[] = [
	{ kind: 'verse', startTime: 0, endTime: 30.51, startBar: 0, endBar: 16.25 },
	{ kind: 'chorus', startTime: 30.51, endTime: 64, startBar: 16.25, endBar: 32 }
];

/** A whole judgement, as it sits on disk. */
function held(over: Partial<Judgement> = {}): Judgement {
	return {
		trackId: 't',
		title: 'Track',
		rating: 5,
		tags: ['great'],
		notes: [{ t: 12, bar: 6, text: 'here' }],
		comment: 'best show of the night',
		sections: MAP,
		movements: [63.5],
		analysisHash: 'h',
		showSeed: 1,
		authoredBy: 'engine',
		updatedAt: 1,
		...over
	};
}

/** What the judge panel sends: its own fields, never the map. */
const fromPanel = (over = {}) => ({
	trackId: 't',
	title: 'Track',
	rating: 3,
	tags: [],
	notes: [],
	comment: '',
	movements: [63.5],
	analysisHash: 'h',
	showSeed: 1,
	authoredBy: 'engine',
	...over
});

/** What the section editor sends: the map and the grid it was drawn against. */
const fromEditor = (sections: JudgedSection[] | null) => ({
	trackId: 't',
	title: 'Track',
	sections,
	analysisHash: 'h',
	showSeed: 1,
	authoredBy: 'engine'
});

describe('mergeJudgement', () => {
	it('keeps a refused movement through every other writer', () => {
		const withVeto = mergeJudgement({ trackId: 't', title: 'Track', movementVetoes: [148.5] }, held());
		expect(withVeto.movementVetoes).toEqual([148.5]);
		expect(withVeto.movements).toEqual([63.5]);
		expect(withVeto.sections).toEqual(MAP);
		// The panel's own patch does not carry vetoes, so it must not erase them.
		expect(mergeJudgement(fromPanel(), withVeto).movementVetoes).toEqual([148.5]);
		expect(mergeJudgement(fromEditor(REDRAWN), withVeto).movementVetoes).toEqual([148.5]);
		// Lifting one sends the list without it.
		expect(mergeJudgement({ trackId: 't', title: 'Track', movementVetoes: [] }, withVeto).movementVetoes).toEqual([]);
	});

	it('keeps the map when the panel writes', () => {
		expect(mergeJudgement(fromPanel(), held()).sections).toEqual(MAP);
	});

	it('does not let a stale panel draft revert a redrawn map', () => {

		const onDisk = held({ sections: REDRAWN });
		const merged = mergeJudgement(fromPanel({ rating: 4 }), onDisk);
		expect(merged.sections).toEqual(REDRAWN);
		expect(merged.rating).toBe(4);
	});

	it('does not let a debounce in flight undo a discard', () => {
		const discarded = held({ sections: null });
		expect(mergeJudgement(fromPanel(), discarded).sections).toBeNull();
	});

	it('keeps the panel fields when the section editor writes', () => {
		const merged = mergeJudgement(fromEditor(REDRAWN), held());
		expect(merged.sections).toEqual(REDRAWN);
		expect(merged.rating).toBe(5);
		expect(merged.tags).toEqual(['great']);
		expect(merged.notes).toHaveLength(1);
		expect(merged.comment).toBe('best show of the night');
		expect(merged.movements).toEqual([63.5]);
	});

	it('lets the panel delete its last movement mark', () => {

		expect(mergeJudgement(fromPanel({ movements: [] }), held()).movements).toEqual([]);
	});

	it('erases the map only on an explicit null', () => {
		expect(mergeJudgement(fromEditor(null), held()).sections).toBeNull();
	});

	it('writes cleanly when nothing is held yet', () => {
		const merged = mergeJudgement(fromEditor(MAP), null);
		expect(merged.sections).toEqual(MAP);
		expect(merged.movements).toBeNull();
		expect(merged.rating).toBeNull();
		expect(merged.trackId).toBe('t');
	});

	it('keeps a sub-bar boundary exactly as drawn', () => {
		const merged = mergeJudgement(fromEditor(REDRAWN), held());
		expect(merged.sections![1].startTime).toBe(30.51);
		expect(merged.sections![1].startBar).toBe(16.25);
	});
});
