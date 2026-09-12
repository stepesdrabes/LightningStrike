import { describe, expect, it } from 'vitest';
import { BUILT_IN_EFFECTS, emptyContext, type GenreFamily } from '@mv/core';
import { composeShow } from './plan.ts';
import { fixture } from './fixture.ts';

const KIT_VOICES = ['kitTicks', 'snareBlade'];

/** The catalog without any intro-eligible kit transient, as it stood before the intro pass. */
const before = BUILT_IN_EFFECTS.map((effect) => effect.role === 'transient' && effect.taste.kit
	? { ...effect, taste: { ...effect.taste, sections: effect.taste.sections.filter((s) => s !== 'intro') } }
	: effect);

describe('intro kit voice', () => {
	it.each(['rock', 'pop', 'hiphop', 'metal', 'edm', 'trance'] as GenreFamily[])(
		'answers the opening kit without changing later composition in %s', (genreFamily) => {
			const analysis = fixture();
			for (const seed of [1, 7, 29]) {
				const options = { seed, context: { ...emptyContext(), genreFamily } };
				const original = composeShow(analysis, { ...options, effects: before });
				const current = composeShow(analysis, options);
				expect(current.cues.filter((cue) => cue.section !== 'intro')).toEqual(
					original.cues.filter((cue) => cue.section !== 'intro'));
				expect(current.hits).toEqual(original.hits);
				expect(current.palette).toEqual(original.palette);
				expect(KIT_VOICES).toContain(current.cues[0].layers.transient?.effect);
				const { transient, ...layers } = current.cues[0].layers;
				expect(layers).toEqual(original.cues[0].layers);
			}
		}
	);

	it('ticks a hat-only count-in', () => {
		const analysis = fixture();
		for (const row of analysis.bars) if (row.section === 'intro') row.kicks = row.snares = 0;
		expect(composeShow(analysis).cues[0].layers.transient?.effect).toBe('kitTicks');
	});

	it('leaves a kitless opening, a kitless record and a family without strikers restrained', () => {
		const ambient = { ...emptyContext(), genreFamily: 'ambient' as GenreFamily };
		expect(composeShow(fixture(), { context: ambient }).cues[0].layers.transient).toBeUndefined();

		const opening = fixture();
		for (const row of opening.bars) if (row.section === 'intro') row.kicks = row.snares = row.hats = 0;
		expect(composeShow(opening).cues[0].layers.transient).toBeUndefined();

		const kitless = fixture();
		for (const row of kitless.bars) row.kicks = row.snares = row.hats = 0;
		expect(composeShow(kitless).cues[0].layers.transient).toBeUndefined();
	});

	it('leaves a kit-reading rhythm alone and respects the activity budget', () => {
		for (const kit of ['any', undefined] as const) {
			const effects = BUILT_IN_EFFECTS.map((effect) => effect.role === 'rhythm'
				? { ...effect, taste: { ...effect.taste, kit, activity: 0.75 } } : effect);
			expect(composeShow(fixture(), { effects }).cues[0].layers.transient).toBeUndefined();
		}
	});
});
