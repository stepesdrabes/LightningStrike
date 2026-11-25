import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, roomModel, type Light, type MatrixLight, type RoomLayout } from '@mv/core';
import { entryLed, ledAt, panelChevrons, stripChevrons } from './cues.ts';
import { stripPieces } from './strips.ts';
import { cross, dot, sub } from './vec.ts';

const room = (lights: Light[]): RoomLayout => ({
	width: 6,
	depth: 5,
	height: 3,
	front: 'south',
	lights
});

const panel = (overrides: Partial<MatrixLight> = {}): MatrixLight => ({
	id: 'panel',
	name: 'Panel',
	kind: 'matrix',
	centre: [0, 2.5, 1.4],
	width: 0.9,
	height: 0.3,
	columns: 4,
	rows: 3,
	mount: 'north',
	first: 'top-left',
	horizontal: true,
	serpentine: true,
	role: 'auto',
	...overrides
});

describe('entryLed', () => {
	it('is the first LED, or the last when the data enters at the far end', () => {
		const [frame] = roomModel(DEFAULT_ROOM).pixels;
		expect(entryLed(frame)).toBe(0);
		const [x, y, z] = ledAt(frame, entryLed(frame));
		expect([x, y, z]).toEqual([expect.closeTo(-1.5 + 3 / 340, 6), 1, expect.closeTo(2.4, 6)]);
		const wiring = { controller: 'frame', start: 0, reversed: true };
		expect(entryLed({ ...frame, light: { ...frame.light, wiring } })).toBe(563);
	});
});

describe('stripChevrons', () => {
	it('runs along each run of the Frame the way its data does', () => {
		const model = roomModel(DEFAULT_ROOM);
		const pieces = stripPieces(model.pixels).filter((p) => p.light === 0);
		const chevrons = stripChevrons(pieces, false);
		// 3 m runs take eight and 2 m runs five, at 0.4 m apart.
		expect(chevrons).toHaveLength(8 + 5 + 8 + 5);
		expect(chevrons[0].dir).toEqual([1, 0, 0]);
		expect(chevrons[8].dir).toEqual([0, -1, 0]);
		for (const c of chevrons) expect(c.normal).toEqual([0, 0, -1]);
		expect(stripChevrons(pieces, true)[0].dir.map((v) => v + 0)).toEqual([-1, 0, 0]);
	});

	it('puts at least three round a small ring, pointing round it', () => {
		const ring: Light = {
			id: 'ring',
			name: 'Ring',
			kind: 'ring',
			centre: [0, 0, 2.5],
			radius: 0.1,
			count: 24,
			startAngle: 0,
			clockwise: false,
			mount: 'ceiling',
			role: 'auto'
		};
		const model = roomModel(room([ring]));
		const pieces = stripPieces(model.pixels);
		const chevrons = stripChevrons(pieces, false);
		expect(chevrons).toHaveLength(3);
		for (const c of chevrons) {
			const out = sub(c.at, [0, 0, 2.5]);
			expect(dot(c.dir, out)).toBeCloseTo(0, 9);
			// Counter-clockwise on the plan turns about +z.
			expect(cross(out, c.dir)[2]).toBeGreaterThan(0);
		}
	});
});

describe('panelChevrons', () => {
	const directions = (light: MatrixLight) => {
		const [pixels] = roomModel(room([light])).pixels;
		return panelChevrons(light, pixels).map((c) => c.dir.map((v) => Math.round(v) + 0));
	};
	const east = [1, 0, 0];
	const west = [-1, 0, 0];

	it('shows the first line and whether the second comes back', () => {
		// Seen from inside the room, right is east on the north wall.
		expect(directions(panel())).toEqual([east, east, east, west, west, west]);
		expect(directions(panel({ serpentine: false }))).toEqual(Array(6).fill(east));
		expect(directions(panel({ horizontal: false, first: 'bottom-right' }))).toEqual([
			...Array(2).fill([0, 0, 1]),
			...Array(2).fill([0, 0, -1])
		]);
	});

	it('walks backwards from the far end when the data enters there', () => {
		const wired = panel({ wiring: { controller: 'c', start: 0, reversed: true } });
		expect(directions(wired)).toEqual([west, west, west, east, east, east]);
		const [pixels] = roomModel(room([wired])).pixels;
		const [first] = panelChevrons(wired, pixels);
		// Serpentine over three rows ends at the bottom right, so that is where it starts.
		expect(first.at[0]).toBeCloseTo(0.3, 6);
		expect(first.at[2]).toBeCloseTo(1.25, 6);
	});

	it('walks a single row of one-LED columns across the panel', () => {
		const row = panel({ rows: 1, height: 0, horizontal: false });
		expect(directions(row)).toEqual([east, east, east]);
	});

	it('thins a long line to a dozen', () => {
		expect(directions(panel({ columns: 40, width: 2 }))).toHaveLength(24);
	});
});
