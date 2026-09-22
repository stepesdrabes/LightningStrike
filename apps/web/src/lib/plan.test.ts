import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, roomModel, type MatrixLight, type RingLight } from '@mv/core';
import {
	axesOf,
	dataEntry,
	frameOf,
	lift,
	nearestOnSegment,
	onSurface,
	place,
	project,
	ringAt,
	snap
} from './plan.ts';

const ring: RingLight = {
	id: 'ring',
	name: 'Ring',
	kind: 'ring',
	centre: [0.5, 0, 2.4],
	radius: 0.5,
	count: 60,
	startAngle: 30,
	clockwise: false,
	mount: 'ceiling',
	role: 'auto'
};

const panel: MatrixLight = {
	id: 'panel',
	name: 'Panel',
	kind: 'matrix',
	centre: [0, 1.98, 1.5],
	width: 0.3,
	height: 0.3,
	columns: 4,
	rows: 4,
	mount: 'north',
	first: 'bottom-right',
	horizontal: false,
	serpentine: true,
	role: 'auto'
};

function positionsOf(light: RingLight | MatrixLight): number[][] {
	const model = roomModel({ ...DEFAULT_ROOM, lights: [light] });
	const p = model.pixels[0].position;
	return Array.from({ length: p.length / 3 }, (_, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
}

describe('views', () => {
	it('see a wall from inside the room, and move a point along it', () => {
		const east = axesOf('east');
		expect(project([2, -1, 1.2], east)).toEqual([1, 1.2]);
		expect(place([0, 2], [2, -1, 1.2], east)).toEqual([2, 0, 2]);
		expect(lift(1, 0, axesOf('south'))).toEqual([-1, 0, 0]);
	});

	it('frame the floor from above and a wall to the ceiling', () => {
		expect(frameOf('top', DEFAULT_ROOM)).toEqual({ u0: -2.5, u1: 2.5, v0: -2, v1: 2 });
		expect(frameOf('west', DEFAULT_ROOM)).toEqual({ u0: -2, u1: 2, v0: 0, v1: 2.6 });
	});

	it('moves a ring or panel onto the surface it is mounted on', () => {
		expect(onSurface([1, 1, 1], 'east', DEFAULT_ROOM)).toEqual([2.48, 1, 1]);
		expect(onSurface([1, 1, 1], 'ceiling', DEFAULT_ROOM)).toEqual([1, 1, 2.58]);
	});
});

describe('data entry', () => {
	it('starts a ring on its first LED, the way the show places it', () => {
		const [first, next] = positionsOf(ring);
		const [at, towards] = dataEntry(ring)!;
		at.forEach((v, d) => expect(v).toBeCloseTo(first[d], 6));
		towards.forEach((v, d) => expect(v).toBeCloseTo(next[d], 6));
		expect(ringAt(ring, 360)[0]).toBeCloseTo(first[0], 6);
	});

	it('starts a panel on the corner its data enters at', () => {
		const leds = positionsOf(panel);
		const [at, towards] = dataEntry(panel)!;
		at.forEach((v, d) => expect(v).toBeCloseTo(leds[0][d], 6));
		towards.forEach((v, d) => expect(v).toBeCloseTo(leds[1][d], 6));
	});

	it('enters a reversed light at its far end, heading back', () => {
		const leds = positionsOf(ring);
		const [at, towards] = dataEntry({ ...ring, wiring: { controller: 'c', start: 0, reversed: true } })!;
		at.forEach((v, d) => expect(v).toBeCloseTo(leds[59][d], 6));
		towards.forEach((v, d) => expect(v).toBeCloseTo(leds[58][d], 6));
	});
});

describe('snapping', () => {
	it('prefers a nearby guide to the grid', () => {
		expect(snap(1.03, [1.01], 0.05, 0.05)).toEqual({ value: 1.01, guide: 1.01 });
		expect(snap(1.03, [1.2], 0.05, 0.05)).toEqual({ value: 1.05, guide: null });
	});

	it('finds the nearest point of a run', () => {
		expect(nearestOnSegment([1, 1], [0, 0], [2, 0])).toEqual({ distance: 1, t: 0.5 });
		expect(nearestOnSegment([-1, 0], [0, 0], [2, 0]).t).toBe(0);
	});
});
