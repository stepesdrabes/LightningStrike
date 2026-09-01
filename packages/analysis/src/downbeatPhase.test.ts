import { describe, expect, it } from 'vitest';
import { barLinesFrom, phaseSegments } from './downbeatPhase.ts';

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
