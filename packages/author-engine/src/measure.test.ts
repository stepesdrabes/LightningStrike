import { describe, expect, it } from 'vitest';
import { BUILT_IN_EFFECTS } from '@mv/core';
import { DEFAULT_ROOM, buildGeometry } from '@mv/core';
import { fixture } from './fixture.ts';
import { composeShow } from './plan.ts';
import { measureShow } from './measure.ts';

const analysis = fixture();
const geometry = buildGeometry(DEFAULT_ROOM);
const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
const show = composeShow(analysis);
const reading = measureShow(show, analysis, effects, geometry);

describe('coverage', () => {
	it('reads every cue, in order, tiling the track', () => {
		expect(reading.cues.length).toBe(show.cues.length);
		for (let i = 1; i < reading.cues.length; i++) {
			expect(reading.cues[i].bar).toBeGreaterThan(reading.cues[i - 1].bar);
			expect(reading.cues[i - 1].endBar).toBe(reading.cues[i].bar);
		}
		expect(reading.cues.at(-1)!.endBar).toBe(analysis.bars.length);
	});

	it('gives every cue frames to be measured over', () => {
		// A void is darkness on purpose - no house floor is what makes it mean something - so
		// brightness is only evidence of frames for every other kind of cue.
		for (const cue of reading.cues) {
			if (cue.section === 'void') continue;
			expect(cue.level, `cue at ${cue.bar}`).toBeGreaterThan(0);
		}
	});
});

describe('what the room receives', () => {
	// The perceptual property the whole pre-analysis exists for. A realtime AGC would pull the
	// drop and the breakdown level, and the delivered figure is the only one that can say it did
	// not: the authored ratio is eight to one and the output chain compresses it.
	it('delivers a drop brighter than the passages around it', () => {
		expect(reading.contrast).toBeGreaterThan(1.5);
	});

	it('leaves no bar dark outside a void', () => {
		expect(reading.darkBars).toEqual([]);
	});

	it('fires every hit the engine planned', () => {
		expect(reading.hits.filter((h) => !h.fired)).toEqual([]);
		expect(reading.hits.length).toBe(show.hits.length);
	});

	// Every strip carries something in a full-stack cue. `spread` is the dimmest wall against the
	// brightest precisely because a mean cannot see three dark walls behind one bright one.
	it('reports the peak lighting more than one wall', () => {
		const peak = analysis.sections.find((s) => s.energyRank === 1)!;
		const cue = reading.cues.find((c) => c.bar >= peak.startBar && c.bar < peak.endBar)!;
		expect(cue.spread).toBeGreaterThan(0.1);
		expect(cue.spread).toBeLessThanOrEqual(1);
	});
});

describe('darkness is reported where it is not asked for', () => {
	it('names the bars a cue blacks out away from a void', () => {
		// A cue labelled `void` gets no house floor, which is what makes a void mean darkness.
		// Pointed at a groove the analysis never called quiet, that is a black room nobody asked
		// for, and it is the one fault the linter cannot see: the show still lints clean.
		const groove = show.cues.find((c) => c.section === 'groove')!;
		const sabotaged = {
			...show,
			cues: show.cues.map((c) => (c === groove ? { ...c, section: 'void' as const, layers: {} } : c))
		};
		const dark = measureShow(sabotaged, analysis, effects, geometry);
		expect(dark.darkBars.length).toBeGreaterThan(0);
		expect(dark.darkBars[0]).toBeGreaterThanOrEqual(groove.bar);
	});
});

describe('frame rate', () => {
	// Every envelope and the whole output chain integrate per frame, so a flash shorter than a
	// frame renders dimmer at 30 fps than at 60, and where it lands depends on where the frame
	// boundary fell. A still cue has nothing to sample differently, so it has to agree - and if
	// it stopped agreeing, the measurement would be reading the frame rate rather than the show.
	const half = measureShow(show, analysis, effects, geometry, { fps: 30 });

	it('agrees with the wire rate wherever the room is not flickering', () => {
		const still = reading.cues
			.map((c, i) => ({ c, half: half.cues[i] }))
			.filter(({ c }) => c.ripple < 1);
		expect(still.length).toBeGreaterThan(2);
		for (const { c, half: b } of still) expect(Math.abs(b.level - c.level)).toBeLessThan(1);
	});

	it('reads a flickering cue within two bytes at half the wire rate', () => {
		// Every strike in the catalog holds past a frame and leaves the way a lamp does, so a
		// hit's brightness no longer depends on the frame boundary. It used to: a flash under
		// a frame read dimmer at 30 fps, which is the reason the wire rate became the default.
		// The default stays the wire's; this pins that nothing has gone back to flashing
		// under a frame.
		const flickering = reading.cues
			.map((c, i) => ({ c, half: half.cues[i] }))
			.filter(({ c }) => c.ripple > 8);
		expect(flickering.length).toBeGreaterThan(0);
		for (const { c, half: b } of flickering) expect(Math.abs(b.level - c.level)).toBeLessThan(2);
	});
});
