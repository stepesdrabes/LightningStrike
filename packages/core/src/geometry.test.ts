import { describe, expect, it } from 'vitest';
import type { PathLight } from './contracts/room.ts';
import { stripAxis } from './dsl/space.ts';
import { DEFAULT_ROOM, buildGeometry } from './geometry.ts';

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
