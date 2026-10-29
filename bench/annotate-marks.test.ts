import { describe, expect, it } from 'vitest';
import { proposalState, startingHits, supportOf, withSupported } from './annotate/marks.js';
import { clipClasses } from './annotate/pages.js';

const STRIKER = { kick: [1, 2], snare: [1.5], hat: [], cymbal: [3] };

describe('a review\'s starting marks', () => {
	it('copies Striker\'s hits for a Striker 1.x clip and a library clip', () => {
		const old = { striker: STRIKER, proposals: {} };
		const marks = startingHits(old, clipClasses(old));
		expect(marks).toEqual(STRIKER);
		marks.kick.push(9);
		expect(STRIKER.kick).toEqual([1, 2]);
		const library = { striker: { ...STRIKER, tom: [4] }, prefill: true };
		expect(startingHits(library, ['kick', 'tom'])).toEqual({ kick: [1, 2], tom: [4] });
	});

	it('is empty for a validation clip', () => {
		const listed = { striker: STRIKER, prefill: false };
		expect(startingHits(listed, ['kick', 'snare', 'hat', 'cymbal', 'tom']))
			.toEqual({ kick: [], snare: [], hat: [], cymbal: [], tom: [] });
	});

	it('keeps the Striker 1.x clips\' support and lets a Striker 2.0 clip name its own', () => {
		expect(supportOf({})).toBe(0.12);
		expect(supportOf({ support: 0.1 })).toBe(0.1);
	});
});

describe('the proposals on a page', () => {
	const proposals = [
		{ t: 0.9, score: 0.9 }, { t: 1.2, score: 0.5 }, { t: 1.505, score: 0.95 }, { t: 2.1, score: 0.09 },
		{ t: 2.5, score: 0.1 }, { t: 3.05, score: 0.3 }, { t: 4, score: 0.99 }
	];
	const view = { from: 1, to: 4 };

	it('draw as answered near a mark, else as a ring when supported, else as a tick', () => {
		const marks = [1.53];
		expect(proposals.map((p) => proposalState(p, marks, 0.1)))
			.toEqual(['ring', 'ring', 'answered', 'tick', 'ring', 'ring', 'ring']);
	});

	it('are accepted by `a` only when supported, on the page and not marked yet', () => {
		expect(withSupported(proposals, [0.5, 1.51, 3.06, 4.2], view, 0.1)).toEqual([1.51, 3.06, 1.2, 2.5]);
		expect(withSupported(proposals, [], view, 0.4)).toEqual([1.2, 1.505]);
	});
});
