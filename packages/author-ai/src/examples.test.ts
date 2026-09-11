import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, buildGeometry, compileGenerated, measureEffect } from '@mv/core';
import { WORKED_EXAMPLES } from './examples.ts';

const geometry = buildGeometry(DEFAULT_ROOM);

/** Gate the prompt examples so the model is never taught an inadmissible effect. */
describe.each(WORKED_EXAMPLES)('$id', (example) => {
	const result = compileGenerated(
		{
			id: example.id,
			name: example.id,
			role: example.role,
			blurb: example.blurb,
			params: [
				{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.8 },
				{ key: 'sweep', label: 'Sweep', min: 0, max: 1, step: 0.01, default: 0.6 },
				{ key: 'speed', label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.4 }
			],
			source: example.source
		},
		geometry
	);

	it('passes the admission gate', () => {
		expect(result.failures).toEqual([]);
		expect(result.def).not.toBeNull();
	});

	it('stays on the palette and answers the music', () => {
		const c = measureEffect(result.def!, geometry);
		expect(c.hue).toBeGreaterThan(0.9);
		expect(c.react).toBeGreaterThan(0.02);
	});
});

describe('the field example', () => {
	it('holds a room on its own, which is what a bed has to do', () => {
		const def = compileGenerated(
			{
				id: 'exampleField',
				name: 'Field',
				role: 'bed',
				blurb: '',
				params: [
					{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.8 },
					{ key: 'sweep', label: 'Sweep', min: 0, max: 1, step: 0.01, default: 0.6 }
				],
				source: WORKED_EXAMPLES[0].source
			},
			geometry
		).def!;
		const c = measureEffect(def, geometry);
		// The two figures `describeCharacter` holds a bed to, so the example cannot be handed to
		// the model as good practice while failing the advice printed beside it.
		expect(c.fill).toBeGreaterThanOrEqual(0.22);
		expect(c.top10).toBeLessThanOrEqual(0.32);
		// And it has to move where there are no drums at all, which is the whole reason a bed
		// reads the grid and the spectrum rather than the kit.
		expect(c.quiet).toBeGreaterThan(0.02);
	});
});

describe('the trail example', () => {
	it('leaves a trail rather than one moving pixel', () => {
		const def = compileGenerated(
			{
				id: 'exampleTrail',
				name: 'Trail',
				role: 'rhythm',
				blurb: '',
				params: [
					{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.8 },
					{ key: 'speed', label: 'Speed', min: 0, max: 1, step: 0.01, default: 0.4 }
				],
				source: WORKED_EXAMPLES[1].source
			},
			geometry
		).def!;
		const c = measureEffect(def, geometry);
		// A single stamp at this sigma covers well under 2% of the fixture. Anything above that
		// is the decayed tail behind it, which is the whole reason the buffer is never cleared.
		expect(c.fill).toBeGreaterThan(0.02);
	});
});
