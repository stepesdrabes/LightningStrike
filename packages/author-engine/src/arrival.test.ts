import { describe, expect, it } from 'vitest';
import { composeShow } from './plan.ts';
import { fixture } from './fixture.ts';

/** Shorten the fixture's opening to `bars` and give the passage after it `energy`. */
function withOpening(bars: number, energy: number) {
	const analysis = fixture();
	const intro = analysis.sections[0];
	const next = analysis.sections[1];
	intro.endBar = bars;
	intro.endTime = analysis.bars[bars].t;
	intro.lengthBars = bars;
	next.startBar = bars;
	next.startTime = analysis.bars[bars].t;
	next.lengthBars = next.endBar - bars;
	next.meanEnergy = energy;
	for (let b = 0; b < next.endBar; b++) {
		analysis.bars[b].section = b < bars ? 'intro' : next.kind;
		if (b >= bars) analysis.bars[b].energy = energy;
	}
	return analysis;
}

describe('arriving out of a short opening', () => {
	it('lands on one beat when the band steps in hard after a count-in', () => {
		const show = composeShow(withOpening(2, 80));
		expect(show.cues[0].section).toBe('intro');
		expect(show.cues[1].fadeBeats).toBe(1);
	});

	it('eases over half a short opening when the level barely moves', () => {
		const show = composeShow(withOpening(2, 40));
		expect(show.cues[1].fadeBeats).toBe(4);
	});

	it('keeps the long dissolve after an eight-bar intro', () => {
		const show = composeShow(fixture());
		expect(show.cues[0].section).toBe('intro');
		expect(show.cues[1].fadeBeats).toBe(12);
	});
});
