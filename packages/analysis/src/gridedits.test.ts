import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	barStartsAtCuts,
	cutsFromBarTimes,
	deriveGridCuts,
	handMapGrid,
	resyncedCuts
} from './gridedits.ts';

describe('barStartsAtCuts', () => {
	it('absorbs each cut as a short bar ending exactly on it', () => {
		// The Safir shape in beats: cuts at 134 and 268 on a phase-0 grid of 4.
		const starts = barStartsAtCuts(280, 4, 0, [134, 268]);
		expect(starts).toContain(134);
		expect(starts).toContain(268);
		const i = starts.indexOf(134);
		expect(starts[i] - starts[i - 1]).toBe(2);
		const j = starts.indexOf(268);
		expect(starts[j] - starts[j - 1]).toBe(2);
		// Between the cuts the grid rides the shifted phase in full bars.
		expect(starts[i + 1] - starts[i]).toBe(4);
	});

	it('ignores a cut already on the walking grid', () => {
		expect(barStartsAtCuts(17, 4, 0, [8])).toEqual([0, 4, 8, 12, 16]);
	});

	it('absorbs an odd offset when the map demands one', () => {
		const starts = barStartsAtCuts(20, 4, 0, [7]);
		expect(starts).toContain(7);
		const i = starts.indexOf(7);
		expect(starts[i] - starts[i - 1]).toBe(3);
	});
});

describe('deriveGridCuts', () => {
	// Beats every half second, bars of four: bar lines at 0, 2, 4... seconds.
	const beats = Float64Array.from({ length: 120 }, (_, i) => i * 0.5);

	it('derives the Safir shape from residue changes', () => {
		// Boundaries at 4s (res 0), 9s and 17s (res 2, the shifted region), then 24s and 32s
		// back at res 0 - each change carried by two boundaries, so both cuts stand.
		expect(deriveGridCuts([4, 9, 17, 24, 32], beats, 4, 0)).toEqual([9, 24]);
	});

	it('ignores a residue change no later boundary carries', () => {
		// 24s returns to res 0 and is the last thing drawn: a nudge, not an inserted half bar.
		expect(deriveGridCuts([4, 9, 17, 24], beats, 4, 0)).toEqual([9]);
		// And the same for a single off-grid boundary in an otherwise clean map.
		expect(deriveGridCuts([4, 8, 16, 25, 32], beats, 4, 0)).toEqual([]);
	});

	it('implies nothing from a map on a correct grid', () => {
		expect(deriveGridCuts([4, 8, 16, 32], beats, 4, 0)).toEqual([]);
	});

	it('ignores a boundary that sits between beats', () => {
		const sparse = Float64Array.from({ length: 60 }, (_, i) => i * 1.0);
		expect(deriveGridCuts([4, 8.45], sparse, 4, 0)).toEqual([]);
	});
});

describe('a hand map drawn on a piecewise grid', () => {
	/** Safir as judged in cache-C at v22: the grid the room confirmed, and the owner's map. */
	const safir = JSON.parse(
		readFileSync(join(import.meta.dirname, 'testdata/safir-map.json'), 'utf8')
	) as {
		beats: number[];
		barTimes: number[];
		beatsPerBar: number;
		downbeatPhase: number;
		mapSections: { kind: string; startTime: number }[];
	};
	const boundaries = safir.mapSections.slice(1).map((s) => s.startTime);
	const round = (xs: number[]) => xs.map((x) => Math.round(x * 100) / 100);

	it('reads the confirmed cuts back out of the grid it was drawn on', () => {
		expect(round(cutsFromBarTimes(safir))).toEqual([53.8, 106.8]);
	});

	it('carries them forward instead of re-deriving from residues', () => {
		expect(round(handMapGrid(boundaries, safir).gridCuts ?? [])).toEqual([53.8, 106.8]);
		expect(handMapGrid(boundaries, safir).sectionMapBoundaries).toBeUndefined();
	});

	it('is what the residue walk gets wrong', () => {
		// Characterisation: uniform-grid residues invent cuts for a map drawn on an already piecewise grid.
		const derived = deriveGridCuts(
			boundaries,
			Float64Array.from(safir.beats),
			safir.beatsPerBar,
			safir.downbeatPhase
		);
		expect(round(derived)).toEqual([67.4, 106.8]);
	});

	it('still reads residues when the map was drawn on a uniform grid', () => {
		const uniform = {
			beats: Array.from({ length: 120 }, (_, i) => i * 0.5),
			barTimes: Array.from({ length: 30 }, (_, i) => i * 2),
			beatsPerBar: 4
		};
		expect(cutsFromBarTimes(uniform)).toEqual([]);
		expect(handMapGrid([4, 9, 17, 24], uniform).sectionMapBoundaries).toEqual([4, 9, 17, 24]);
	});

	it('falls back to residues when the drawing grid is unknown', () => {
		expect(handMapGrid([4, 9], null).sectionMapBoundaries).toEqual([4, 9]);
	});
});

describe('a deliberate cut re-syncs at the next drawn boundary', () => {
	/** Beats every 0.5 s, bars every 2 s, so a bar line sits on every even second. */
	const uniform = {
		beats: Array.from({ length: 240 }, (_, i) => i * 0.5),
		barTimes: Array.from({ length: 60 }, (_, i) => i * 2),
		beatsPerBar: 4
	};
	const beatAt = (t: number) => Math.round(t / 0.5);
	// One boundary dragged off the grid on purpose; the rest drawn on bar lines.
	const boundaries = [17, 32, 48];
	const cuts = (deliberate: number[]) =>
		resyncedCuts(deliberate.map(beatAt), deliberate.map(beatAt), boundaries.map(beatAt), 240, 4, 0);

	it('hands the count back at the first boundary already on a bar line', () => {
		expect(cuts([17])).toEqual([beatAt(17), beatAt(32)]);
	});

	it('leaves every bar line after the re-sync exactly where it was', () => {
		const times = barStartsAtCuts(240, 4, 0, cuts([17])).map((i) => uniform.beats[i]);
		// The drawn boundaries all land, and the tail is the untouched grid.
		expect(times).toContain(17);
		expect(times).toContain(32);
		expect(times).toContain(48);
		expect(times.filter((t) => t >= 32)).toEqual(uniform.barTimes.filter((t) => t >= 32));
	});

	it('walks its own reference grid, so a missing cached analysis changes nothing', () => {
		// Re-sync must work without a cached drawing grid; a kept fine-drag judgement still needs
		// its original phase restored after a cache clear.
		expect(handMapGrid(boundaries, null, [17]).gridCuts).toEqual([17]);
		// The walk supplies the rest anyway.
		expect(cuts([17])).toEqual([beatAt(17), beatAt(32)]);
	});

	it('implies no re-sync without a deliberate cut, so a confirmed grid stays put', () => {
		expect(cuts([])).toEqual([]);
		expect(handMapGrid(boundaries, uniform).gridCuts).toBeUndefined();
	});

	it('passes over a boundary that is not on a bar line either', () => {
		// 17 and 25 are both mid-bar here, so the count is due back at 32, not at 25.
		expect(
			resyncedCuts([beatAt(17)], [beatAt(17)], [17, 25, 32].map(beatAt), 240, 4, 0)
		).toEqual([beatAt(17), beatAt(32)]);
	});
});
