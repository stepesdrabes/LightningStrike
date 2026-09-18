import { describe, expect, it } from 'vitest';
import { stripAxis } from './dsl/space.ts';
import { DEFAULT_ROOM, buildGeometry, roomRegions } from './geometry.ts';

const g = buildGeometry(DEFAULT_ROOM);
const f = DEFAULT_ROOM.fixture;

describe('the frame', () => {
	it('is the perimeter plus the crossbar, as built', () => {
		expect(g.count).toBe(671);
		expect(g.strips.map((s) => s.count)).toEqual([170, 111, 170, 111, 109]);
	});

	it('takes its run lengths from counts, not from the drawn frame', () => {
		const narrow = buildGeometry({
			...DEFAULT_ROOM,
			fixture: { ...f, counts: { along: 10, across: 4, beam: 3 } }
		});
		expect(narrow.strips.map((s) => s.count)).toEqual([10, 4, 10, 4, 3]);
		expect(narrow.count).toBe(31);
		expect(narrow.perimeterLength).toBeCloseTo(2 * (f.width + f.depth));
	});

	it('walks the ring counter-clockwise with no seam', () => {
		const ring = g.strips.filter((s) => s.inPerimeter);
		for (let i = 0; i < ring.length; i++) {
			const next = ring[(i + 1) % ring.length];
			expect(ring[i].end).toEqual(next.start);
		}
	});

	it('keeps everything off the perimeter at the tail of the buffer', () => {
		const off = [...g.perim].flatMap((p, i) => (p < 0 ? [i] : []));
		expect(off.length).toBe(109);
		expect(off[0]).toBe(562);
		expect(off.at(-1)).toBe(670);
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
		expect(g.z[0]).toBeCloseTo(f.height);
	});
});

describe('normalisation', () => {
	it('spans the full range on the fixture', () => {
		const span = (a: Float32Array) => [Math.min(...a), Math.max(...a)];
		const [nxLo, nxHi] = span(g.nx);
		expect(nxLo).toBeCloseTo(0, 2);
		expect(nxHi).toBeCloseTo(1, 2);
		expect(Math.max(...g.r)).toBeCloseTo(1, 2);
		expect(g.extent).toBe(Math.max(f.width, f.depth));
	});

	it('converts metres per second with the fixture pitch', () => {
		expect(g.pitch).toBeCloseTo(1 / f.density);
		expect(g.perimeterLength).toBeCloseTo(2 * (f.width + f.depth));
	});
});

describe('regions', () => {
	it('names corners after the compass, not the walk order', () => {
		const ids = roomRegions(g).map((r) => r.name);
		expect(ids).toContain('NE corner');
		expect(ids).toContain('SE corner');
		expect(ids).toContain('SW corner');
		expect(ids).toContain('NW corner');
	});

	/** A bring-up region must match one 5 m reel: one long run plus one short run. */
	it('pairs the perimeter into the reels it is wired from', () => {
		const lines = roomRegions(g).filter((r) => r.id.startsWith('line-'));
		expect(lines.map((r) => r.name)).toEqual(['Frame N + E', 'Frame S + W']);
		for (const line of lines) expect(line.count).toBe(281);
		expect(lines[0].spans[0].firstLed).toBe(0);
		expect(lines[1].spans[0].firstLed).toBe(g.strips[2].offset);
	});

	it('keeps a corner inside the ring rather than walking onto the beam', () => {
		const beam = g.strips[4];
		for (const region of roomRegions(g).filter((r) => r.id.startsWith('corner-'))) {
			for (const span of region.spans) {
				expect(span.firstLed + span.ledCount).toBeLessThanOrEqual(beam.offset);
			}
		}
	});
});
