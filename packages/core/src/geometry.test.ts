import { describe, expect, it } from 'vitest';
import type { PathLight } from './contracts/room.ts';
import { stripAxis } from './dsl/space.ts';
import { CLUB_ROOM, DEFAULT_ROOM, buildGeometry, roomModel } from './geometry.ts';
import { readLayout } from './room/validate.ts';

const g = buildGeometry(DEFAULT_ROOM);
const [ring, beam] = DEFAULT_ROOM.lights as PathLight[];

describe('the frame', () => {
	it('is the perimeter plus the crossbar, as built', () => {
		expect(g.count).toBe(673);
		expect(g.strips.map((s) => s.count)).toEqual([170, 112, 170, 112, 109]);
		expect(g.spine).toBe(true);
	});

	it('takes its run lengths from counts, not from the drawn frame', () => {
		const narrow = buildGeometry({
			...DEFAULT_ROOM,
			lights: [
				{ ...ring, counts: [10, 4, 10, 4] },
				{ ...beam, counts: [3] }
			]
		});
		expect(narrow.strips.map((s) => s.count)).toEqual([10, 4, 10, 4, 3]);
		expect(narrow.count).toBe(31);
		expect(narrow.perimeterLength).toBeCloseTo(10);
	});

	it('walks the ring clockwise from the north-west with no seam', () => {
		const walls = g.strips.filter((s) => s.inPerimeter);
		expect(walls.map((s) => s.name)).toEqual(['Frame N', 'Frame E', 'Frame S', 'Frame W']);
		for (let i = 0; i < walls.length; i++) {
			const next = walls[(i + 1) % walls.length];
			expect(walls[i].end).toEqual(next.start);
		}
	});

	it('keeps everything off the perimeter at the tail of the buffer', () => {
		const off = [...g.perim].flatMap((p, i) => (p < 0 ? [i] : []));
		expect(off.length).toBe(109);
		expect(off[0]).toBe(564);
		expect(off.at(-1)).toBe(672);
	});

	it('faces every run down', () => {
		for (const s of g.strips) expect(s.normal).toEqual([0, 0, -1]);
		expect(g.strips.filter((s) => stripAxis(s) === 'x').map((s) => s.name)).toEqual([
			'Frame N',
			'Frame S'
		]);
		expect(g.strips.filter((s) => stripAxis(s) === 'y').map((s) => s.name)).toEqual([
			'Frame E',
			'Frame W',
			'Beam'
		]);
	});

	it('is coplanar, which several effects are written around', () => {
		for (let i = 0; i < g.count; i++) expect(g.z[i]).toBe(g.z[0]);
		expect(g.z[0]).toBeCloseTo(2.4);
	});
});

describe('normalisation', () => {
	it('spans the full range on the fixture', () => {
		const span = (a: Float32Array) => [Math.min(...a), Math.max(...a)];
		const [nxLo, nxHi] = span(g.nx);
		expect(nxLo).toBeCloseTo(0, 2);
		expect(nxHi).toBeCloseTo(1, 2);
		expect(Math.max(...g.r)).toBeCloseTo(1, 2);
		expect(g.extent).toBe(3);
	});

	it('converts metres per second with the fixture pitch', () => {
		expect(g.pitch).toBeCloseTo(1 / 60);
		expect(g.perimeterLength).toBeCloseTo(10);
	});
});

describe('the club room', () => {
	const model = roomModel(CLUB_ROOM);
	const club = model.geometry;

	it('is the Frame drawn half as large again, every run keeping its LEDs', () => {
		expect(readLayout(JSON.parse(JSON.stringify(CLUB_ROOM)))).toEqual({ layout: CLUB_ROOM });
		const runs = (x: typeof g) => x.strips.map((s) => [s.name, s.offset, s.count]);
		expect(runs(club)).toEqual(runs(g));
		expect(club.local).toEqual(g.local);
		expect(club.strip).toEqual(g.strip);
		expect(club.spine).toBe(true);
		expect(club.extent).toBe(4.5);
		expect(club.perimeterLength).toBe(15);
		expect(club.pitch).toBe(1 / 40);
		for (let i = 0; i < club.count; i++) expect(club.z[i]).toBe(2.5);
	});

	it('reduces the room to the Bounce Lamp in its corner', () => {
		expect(model.lamps).toEqual([CLUB_ROOM.lights[2]]);
		expect(model.lamps[0]).toMatchObject({ at: [-3.12, 1.75, 0], height: 1, diameter: 0.2 });
	});
});
