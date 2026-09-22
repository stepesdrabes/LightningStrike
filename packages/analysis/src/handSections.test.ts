import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handMapFingerprint, handMapStamp, handSectionBars, type HandMarks } from './handSections.ts';

describe('handSectionBars', () => {
	/** Bars every two seconds, so a bar line sits on every even second. */
	const uniform = Float64Array.from({ length: 41 }, (_, i) => i * 2);

	it('reads the drawn kinds in the drawn order', () => {
		const read = handSectionBars(
			[
				{ kind: 'intro', startTime: 0 },
				{ kind: 'drop', startTime: 16 },
				{ kind: 'outro', startTime: 64 }
			],
			uniform,
			40
		);
		expect(read).toEqual({ bounds: [0, 8, 32, 40], kinds: ['intro', 'drop', 'outro'] });
	});

	it('rounds a boundary drawn between bars onto the nearer one', () => {
		// 17.4s sits 0.6 short of bar 9's line at 18s; 19.4s sits 0.6 short of bar 10's.
		const read = handSectionBars(
			[
				{ kind: 'verse', startTime: 0 },
				{ kind: 'chorus', startTime: 17.4 },
				{ kind: 'verse', startTime: 19.4 }
			],
			uniform,
			40
		);
		expect(read?.bounds).toEqual([0, 9, 10, 40]);
	});

	it('keeps two drawn sections of the same kind apart', () => {
		const read = handSectionBars(
			[
				{ kind: 'drop', startTime: 0 },
				{ kind: 'drop', startTime: 32 }
			],
			uniform,
			40
		);
		expect(read?.kinds).toEqual(['drop', 'drop']);
		expect(read?.bounds).toEqual([0, 16, 40]);
	});

	it('drops a span that rounded onto no bar at all', () => {
		const read = handSectionBars(
			[
				{ kind: 'intro', startTime: 0 },
				{ kind: 'build', startTime: 16.2 },
				{ kind: 'drop', startTime: 16.6 }
			],
			uniform,
			40
		);
		// Both land on bar 8; the build has no bars to light, so the drop owns the boundary.
		expect(read).toEqual({ bounds: [0, 8, 40], kinds: ['intro', 'drop'] });
	});

	it('covers the track edge to edge whatever the map says', () => {
		const read = handSectionBars(
			[
				// Drawn from 6s in, and with a last boundary past the end of the track.
				{ kind: 'intro', startTime: 6 },
				{ kind: 'groove', startTime: 24 },
				{ kind: 'outro', startTime: 900 }
			],
			uniform,
			40
		);
		// A first boundary is a statement about the intro, not about where the track starts,
		// and a boundary past the end cannot open a section of its own.
		expect(read).toEqual({ bounds: [0, 12, 40], kinds: ['intro', 'groove'] });
	});

	it('refuses a map that rounds down to one span', () => {
		expect(
			handSectionBars(
				[
					{ kind: 'groove', startTime: 0 },
					{ kind: 'outro', startTime: 900 }
				],
				uniform,
				40
			)
		).toBeNull();
	});

	it('reads a word the vocabulary lost as the neutral middle of it', () => {
		const read = handSectionBars(
			[
				{ kind: 'preChorus', startTime: 0 },
				{ kind: 'chorus', startTime: 16 }
			],
			uniform,
			40
		);
		expect(read?.kinds).toEqual(['groove', 'chorus']);
	});

	it('adopts nothing from a map of one section', () => {
		expect(handSectionBars([{ kind: 'groove', startTime: 0 }], uniform, 40)).toBeNull();
	});

	describe("Ponyboy and Safir's own maps", () => {
		const safir = JSON.parse(
			readFileSync(join(import.meta.dirname, 'testdata/safir-map.json'), 'utf8')
		) as { barTimes: number[]; mapSections: { kind: string; startTime: number }[] };
		const barTime = Float64Array.from(safir.barTimes);

		it('lands the map back on the bars the room confirmed', () => {
			const read = handSectionBars(safir.mapSections, barTime, safir.barTimes.length - 1);
			expect(read?.kinds).toEqual([
				'intro',
				'build',
				'chorus',
				'verse',
				'chorus',
				'build',
				'chorus',
				'breakdown',
				'outro'
			]);
			// The verse was drawn one beat past its bar line - a beat-snapped drag on a grid
			// whose sections are addressed by bar. It rounds back onto 53.80, bar 34.
			expect(read?.bounds).toEqual([0, 2, 9, 34, 43, 66, 68, 88, 96, 99]);
		});
	});
});

describe('handMapFingerprint', () => {
	const map = [
		{ kind: 'groove', startTime: 1.8 },
		{ kind: 'drop', startTime: 37.42 }
	];

	it('changes when a boundary moves', () => {
		expect(handMapFingerprint(map)).not.toBe(
			handMapFingerprint([map[0], { kind: 'drop', startTime: 38.42 }])
		);
	});

	it('changes when only a kind changes', () => {
		expect(handMapFingerprint(map)).not.toBe(
			handMapFingerprint([map[0], { kind: 'chorus', startTime: 37.42 }])
		);
	});

	it('changes when a section is added', () => {
		expect(handMapFingerprint(map)).not.toBe(
			handMapFingerprint([...map, { kind: 'outro', startTime: 179.6 }])
		);
	});

	it('holds still for a redraw that lands on the same instant', () => {
		// A drag is stored to the millisecond; the map is read onto bar lines. Re-analysing a
		// track because a boundary moved by a millisecond would be work for no audible change.
		expect(handMapFingerprint([map[0], { kind: 'drop', startTime: 37.4249 }])).toBe(
			handMapFingerprint(map)
		);
	});
});

describe('handMapStamp', () => {
	const sections = [
		{ kind: 'groove', startTime: 1.8 },
		{ kind: 'drop', startTime: 37.42 }
	];

	/** What ingest reads from the judge file, and what analysis is handed, for the same marks. */
	function bothSides(read: { sections: typeof sections; movements: number[]; movementVetoes: number[] }) {
		const handed: HandMarks = {
			...(read.sections.length >= 2 ? { sections: read.sections } : {}),
			...(read.movements.length > 0 ? { movements: read.movements } : {}),
			...(read.movementVetoes.length > 0 ? { movementVetoes: read.movementVetoes } : {})
		};
		return [handMapStamp(read), handMapStamp(handed)];
	}

	it('keeps the stamp a sections-only map always had, so those caches stay valid', () => {
		expect(handMapStamp({ sections })).toBe(handMapFingerprint(sections));
	});

	it('agrees between what ingest reads and what analysis stores', () => {
		const cases = [
			{ sections, movements: [], movementVetoes: [] },
			{ sections, movements: [91.25], movementVetoes: [] },
			{ sections: sections.slice(0, 1), movements: [91.25], movementVetoes: [] },
			{ sections: [], movements: [], movementVetoes: [140.5] }
		];
		for (const marks of cases) {
			const [read, stored] = bothSides(marks);
			expect(read).toBeDefined();
			expect(stored).toBe(read);
		}
	});

	it('changes when a song mark or a veto moves', () => {
		const base = handMapStamp({ sections, movements: [91.25] });
		expect(handMapStamp({ sections, movements: [92.25] })).not.toBe(base);
		expect(handMapStamp({ sections, movements: [91.25], movementVetoes: [10] })).not.toBe(base);
	});

	it('is absent when nothing usable was drawn', () => {
		expect(handMapStamp({})).toBeUndefined();
		expect(handMapStamp({ sections: sections.slice(0, 1) })).toBeUndefined();
	});
});
