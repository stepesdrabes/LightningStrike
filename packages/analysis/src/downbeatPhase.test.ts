import { describe, expect, it } from 'vitest';
import { acceptedRestarts, barLinesFrom, openingRun, phaseRuns, phaseSegments } from './downbeatPhase.ts';

/** A steady beat stream, so the only thing under test is where the downbeats sit. */
const PERIOD = 0.5;
const beatsOf = (n: number) => Array.from({ length: n }, (_, i) => i * PERIOD);
const at = (indices: readonly number[]) => indices.map((i) => i * PERIOD);

describe('phaseSegments', () => {
	it('reads one segment when the count never restarts', () => {
		const beats = beatsOf(160);
		const downbeats = at(Array.from({ length: 40 }, (_, k) => k * 4));
		const segs = phaseSegments(beats, downbeats, 4);
		expect(segs).toEqual([{ startBeat: 0, phase: 0 }]);
	});

	it('keeps the offset when the whole track is on one phase that is not zero', () => {
		const beats = beatsOf(160);
		const downbeats = at(Array.from({ length: 39 }, (_, k) => 2 + k * 4));
		const segs = phaseSegments(beats, downbeats, 4);
		expect(segs).toHaveLength(1);
		expect(segs[0].startBeat).toBe(2);
		expect(segs[0].phase).toBe(2);
	});

	it('finds the restart when the count shifts by a beat mid-track', () => {
		const beats = beatsOf(200);
		const before = Array.from({ length: 20 }, (_, k) => k * 4);
		const after = Array.from({ length: 30 }, (_, k) => 81 + k * 4);
		const segs = phaseSegments(beats, [...at(before), ...at(after)], 4);
		expect(segs).toHaveLength(2);
		expect(segs[0].startBeat).toBe(0);
		expect(segs[1].startBeat).toBe(81);
	});

	it('does not restart for a handful of stray downbeats', () => {
		const beats = beatsOf(200);
		const grid = Array.from({ length: 50 }, (_, k) => k * 4);
		// Three isolated strays, each a beat off its own bar line: the price of a restart has
		// to exceed what one wrong downbeat is worth, or the walk chases the model's noise.
		const strays = [37, 102, 155];
		const segs = phaseSegments(beats, at([...grid, ...strays].sort((a, b) => a - b)), 4);
		expect(segs).toHaveLength(1);
	});

	it('restarts freely when a restart is free, which is what the price is for', () => {
		const beats = beatsOf(200);
		const grid = Array.from({ length: 50 }, (_, k) => k * 4);
		const strays = [37, 102, 155];
		const cheap = phaseSegments(beats, at([...grid, ...strays].sort((a, b) => a - b)), 4, 0);
		expect(cheap.length).toBeGreaterThan(1);
	});

	it('says one segment rather than guessing when there is nothing to read', () => {
		expect(phaseSegments(beatsOf(160), at([0, 4, 8]), 4)).toEqual([{ startBeat: 0, phase: 0 }]);
		expect(phaseSegments([], [], 4)).toEqual([{ startBeat: 0, phase: 0 }]);
	});
});

describe('barLinesFrom', () => {
	it('walks each segment from its own anchor', () => {
		const lines = barLinesFrom(
			[
				{ startBeat: 0, phase: 0 },
				{ startBeat: 9, phase: 1 }
			],
			17,
			4
		);
		expect(lines).toEqual([0, 4, 8, 9, 13]);
	});
});

describe('phaseRuns and acceptedRestarts', () => {
	/** Downbeat indices on one residue across a span of beats. */
	const on = (from: number, to: number, phase: number) => {
		const out: number[] = [];
		for (let i = from; i < to; i++) if (i % 4 === phase) out.push(i);
		return out;
	};
	const runsOf = (downbeats: number[], n: number) => {
		const beats = beatsOf(n);
		const times = at(downbeats.sort((a, b) => a - b));
		return phaseRuns(phaseSegments(beats, times, 4), beats, times, 4);
	};

	it('counts each run against its own bar lines', () => {
		const runs = runsOf(on(0, 160, 0), 160);
		expect(runs).toHaveLength(1);
		expect(runs[0].share).toBe(1);
		expect(runs[0].bars).toBe(40);
		expect(runs[0].onPhase).toEqual([40, 0, 0, 0]);
	});

	it('accepts a solid tail on a new residue', () => {
		// Forty bars on one phase, then twenty on the other half of the bar to the end: Stíny's
		// last chorus.
		const runs = runsOf([...on(0, 160, 0), ...on(160, 240, 2)], 240);
		const cuts = acceptedRestarts(runs, 4);
		expect(cuts).toHaveLength(1);
		expect(cuts[0] % 4).toBe(2);
		expect(Math.abs(cuts[0] - 162)).toBeLessThanOrEqual(4);
	});

	it('refuses a half-bar flip that comes back', () => {
		// The 2-bar loop heard from its other half for sixteen bars: Immaterial's second minute.
		const runs = runsOf([...on(0, 120, 0), ...on(120, 184, 2), ...on(184, 240, 0)], 240);
		expect(runs.length).toBeGreaterThanOrEqual(3);
		expect(acceptedRestarts(runs, 4)).toEqual([]);
	});

	it('refuses a residue the run before already carried', () => {
		// The opening keeps its majority but hedges the new residue on a third of its bars; the
		// tail then settling on it is the model resolving, not the record moving.
		const opening = on(0, 160, 0).filter((i) => (i / 4) % 3 !== 2);
		const hedge = on(0, 160, 2).filter((i) => Math.floor(i / 4) % 3 === 2);
		const runs = runsOf([...opening, ...hedge, ...on(160, 240, 2)], 240);
		expect(acceptedRestarts(runs, 4)).toEqual([]);
	});

	it('leaves a short or sparse run to the count before it', () => {
		// Six bars at the end on a new residue with only three downbeats in them.
		const tail = on(200, 224, 1).filter((_, k) => k % 2 === 0);
		const runs = runsOf([...on(0, 200, 0), ...tail], 224);
		expect(acceptedRestarts(runs, 4)).toEqual([]);
	});

	it('reads the opening from the first solid run when the intro hedges', () => {
		// Ten bars of downbeats alternating two residues, then fifty on one.
		const intro = [...on(0, 40, 1).filter((i) => Math.floor(i / 4) % 2 === 0), ...on(0, 40, 3).filter((i) => Math.floor(i / 4) % 2 === 1)];
		const runs = runsOf([...intro, ...on(40, 240, 0)], 240);
		expect(openingRun(runs)?.phase).toBe(0);
		// And nothing after the opening run counts as a change.
		expect(acceptedRestarts(runs, 4)).toEqual([]);
	});

	it('leaves a restart within a bar of a seam to the seam', () => {
		const runs = runsOf([...on(0, 160, 0), ...on(160, 240, 1)], 240);
		expect(acceptedRestarts(runs, 4, [161])).toEqual([]);
	});
});

describe('acceptedRestarts: the body', () => {
	const on = (from: number, to: number, phase: number) => {
		const out: number[] = [];
		for (let i = from; i < to; i++) if (i % 4 === phase) out.push(i);
		return out;
	};
	it('lets a long majority run take the phase from a short solid opening', () => {
		// Lose Yourself: fifteen unanimous bars of intro on one residue, then a hundred bars at
		// five in six on another.
		const beats = beatsOf(460);
		const body = on(60, 460, 2).filter((_, k) => k % 6 !== 5);
		const hedge = on(60, 460, 0).filter((_, k) => k % 6 === 5);
		const downbeats = at([...on(0, 60, 1), ...body, ...hedge].sort((a, b) => a - b));
		const runs = phaseRuns(phaseSegments(beats, downbeats, 4), beats, downbeats, 4);
		expect(openingRun(runs)?.phase).toBe(1);
		const cuts = acceptedRestarts(runs, 4);
		expect(cuts).toHaveLength(1);
		expect(cuts[0] % 4).toBe(2);
	});
});
