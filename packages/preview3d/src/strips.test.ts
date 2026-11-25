import { describe, expect, it } from 'vitest';
import {
	DEFAULT_ROOM,
	roomModel,
	type Light,
	type LightPixels,
	type Mount,
	type RingLight,
	type RoomLayout,
	type Vec3
} from '@mv/core';
import {
	ATLAS_WIDTH,
	acrossAt,
	bandVertices,
	lengthOf,
	pointAt,
	stepsOf,
	stripPieces,
	tangentAt,
	type StripPiece
} from './strips.ts';
import { dot, length, sub } from './vec.ts';

const room = (lights: Light[]): RoomLayout => ({
	width: 6,
	depth: 5,
	height: 3,
	front: 'south',
	lights
});

const ring = (overrides: Partial<RingLight> = {}): Light => ({
	id: 'ring',
	name: 'Ring',
	kind: 'ring',
	centre: [0.3, -0.2, 2.5],
	radius: 0.6,
	count: 48,
	startAngle: 0,
	clockwise: true,
	mount: 'ceiling',
	role: 'auto',
	...overrides
});

const path = (
	points: Vec3[],
	counts: number[],
	mount: Mount = 'ceiling',
	closed = false
): Light => ({
	id: 'path',
	name: 'Path',
	kind: 'path',
	points,
	counts,
	closed,
	density: 60,
	mount,
	role: 'auto'
});

function led(pixels: LightPixels, i: number): Vec3 {
	return [pixels.position[i * 3], pixels.position[i * 3 + 1], pixels.position[i * 3 + 2]];
}

/** Every LED of every piece sits where core placed it, at the centre of its cell. */
function expectCellsOnLeds(pixels: readonly LightPixels[], pieces: readonly StripPiece[]): void {
	for (const p of pieces) {
		for (let k = 0; k < p.count; k++) {
			const at = pointAt(p.shape, (k + 0.5) / p.count);
			const want = led(pixels[p.light], p.from + k);
			for (let d = 0; d < 3; d++) expect(at[d]).toBeCloseTo(want[d], 5);
		}
	}
}

describe('stripPieces', () => {
	it('draws the Frame as its four runs and the beam, facing down', () => {
		const model = roomModel(DEFAULT_ROOM);
		const pieces = stripPieces(model.pixels);
		expect(pieces.map((p) => p.count)).toEqual([170, 112, 170, 112, 109]);
		expect(pieces.map((p) => p.shape)).toEqual([
			{ kind: 'line', a: [-1.5, 1, 2.4], b: [1.5, 1, 2.4] },
			{ kind: 'line', a: [1.5, 1, 2.4], b: [1.5, -1, 2.4] },
			{ kind: 'line', a: [1.5, -1, 2.4], b: [-1.5, -1, 2.4] },
			{ kind: 'line', a: [-1.5, -1, 2.4], b: [-1.5, 1, 2.4] },
			{ kind: 'line', a: [0, -1, 2.4], b: [0, 1, 2.4] }
		]);
		for (const p of pieces) expect(p.normal).toEqual([0, 0, -1]);
		expectCellsOnLeds(model.pixels, pieces);
	});

	it('guards a run with its own end LEDs', () => {
		const pieces = stripPieces(roomModel(DEFAULT_ROOM).pixels);
		expect(pieces.slice(0, 4).map((p) => [p.from, p.before, p.after])).toEqual([
			[0, 0, 169],
			[170, 170, 281],
			[282, 282, 451],
			[452, 452, 563]
		]);
	});

	it('puts ring LEDs where core puts them, however the ring is hung and turned', () => {
		const rings = [
			ring(),
			ring({ clockwise: false, startAngle: 37 }),
			ring({ mount: 'floor', centre: [0, 0, 0.02], count: 7, startAngle: 200 }),
			ring({ mount: 'north', centre: [0, 2.5, 1.5], startAngle: 90 }),
			ring({ mount: 'east', centre: [3, 0, 1.5], clockwise: false }),
			ring({ mount: 'south', centre: [0, -2.5, 1.2], count: 5 }),
			ring({ mount: 'west', centre: [-3, 1, 1.4], startAngle: -45 }),
			ring({ count: 1, startAngle: 120 })
		];
		for (const light of rings) {
			const model = roomModel(room([light]));
			const pieces = stripPieces(model.pixels);
			expect(pieces).toHaveLength(1);
			expectCellsOnLeds(model.pixels, pieces);
		}
	});

	it('wraps a ring guard round its seam', () => {
		const [p] = stripPieces(roomModel(room([ring({ count: 30 })])).pixels);
		expect([p.from, p.count, p.before, p.after]).toEqual([0, 30, 29, 0]);
	});

	it('cuts a run longer than an atlas row into pieces that guard across the cut', () => {
		const n = ATLAS_WIDTH * 2 + 10;
		const model = roomModel(room([path([[-2, 0, 2.5], [2, 0, 2.5]], [n])]));
		const pieces = stripPieces(model.pixels);
		expect(pieces.map((p) => p.count)).toEqual([ATLAS_WIDTH - 2, ATLAS_WIDTH - 2, 14]);
		expect(pieces.map((p) => [p.before, p.after])).toEqual([
			[0, ATLAS_WIDTH - 2],
			[ATLAS_WIDTH - 3, 2 * (ATLAS_WIDTH - 2)],
			[2 * (ATLAS_WIDTH - 2) - 1, n - 1]
		]);
		expectCellsOnLeds(model.pixels, pieces);
	});

	it('cuts a long ring into arcs that guard across the cuts and the seam', () => {
		const n = ATLAS_WIDTH + 100;
		const model = roomModel(room([ring({ count: n, radius: 4 })]));
		const pieces = stripPieces(model.pixels);
		expect(pieces.map((p) => [p.from, p.count, p.before, p.after])).toEqual([
			[0, ATLAS_WIDTH - 2, n - 1, ATLAS_WIDTH - 2],
			[ATLAS_WIDTH - 2, 102, ATLAS_WIDTH - 3, 0]
		]);
		expectCellsOnLeds(model.pixels, pieces);
	});

	it('faces a sloping run square to its own length and a vertical ceiling run somewhere', () => {
		const sloped = stripPieces(
			roomModel(room([path([[0, 0, 2], [1, 0, 2.8]], [30], 'ceiling')])).pixels
		)[0];
		const run = sub(pointAt(sloped.shape, 1), pointAt(sloped.shape, 0));
		expect(dot(sloped.normal, run)).toBeCloseTo(0, 9);
		expect(sloped.normal[2]).toBeLessThan(0);

		const upright = stripPieces(
			roomModel(room([path([[0, 0, 1], [0, 0, 2]], [30], 'ceiling')])).pixels
		)[0];
		expect(length(upright.normal)).toBeCloseTo(1, 9);
		expect(upright.normal[2]).toBeCloseTo(0, 9);
	});

	it('keeps a run of one LED finite', () => {
		const model = roomModel(room([path([[0, 0, 2.5], [0.5, 0, 2.5]], [1])]));
		const [p] = stripPieces(model.pixels);
		expect([p.count, p.before, p.after]).toEqual([1, 0, 0]);
		const band = bandVertices(p.shape, p.normal, 0.03, 0.012, stepsOf(p));
		expect(band.every(Number.isFinite)).toBe(true);
	});

	it('walks a closed wall path back to its first point', () => {
		const light = path(
			[
				[-1, 2.5, 1],
				[1, 2.5, 1],
				[1, 2.5, 2]
			],
			[40, 20, 30],
			'north',
			true
		);
		const model = roomModel(room([light]));
		const pieces = stripPieces(model.pixels);
		expect(pieces.map((p) => p.shape)).toEqual([
			{ kind: 'line', a: [-1, 2.5, 1], b: [1, 2.5, 1] },
			{ kind: 'line', a: [1, 2.5, 1], b: [1, 2.5, 2] },
			{ kind: 'line', a: [1, 2.5, 2], b: [-1, 2.5, 1] }
		]);
		for (const p of pieces) expect(p.normal).toEqual([0, -1, 0]);
		expectCellsOnLeds(model.pixels, pieces);
	});
});

describe('shapes', () => {
	it('points the tangent the way the cells run and keeps the band across it', () => {
		const west = ring({ clockwise: false, mount: 'west', centre: [-3, 0, 1.5] });
		for (const light of [ring(), west]) {
			const [p] = stripPieces(roomModel(room([light])).pixels);
			for (const x of [0, 0.3, 0.77]) {
				const ahead = sub(pointAt(p.shape, x + 1e-4), pointAt(p.shape, x));
				const across = acrossAt(p.shape, p.normal, x);
				expect(dot(tangentAt(p.shape, x), ahead)).toBeGreaterThan(0);
				expect(dot(across, tangentAt(p.shape, x))).toBeCloseTo(0, 9);
				expect(dot(across, p.normal)).toBeCloseTo(0, 9);
			}
		}
	});

	it('measures an arc along its curve', () => {
		const [p] = stripPieces(roomModel(room([ring({ radius: 0.5 })])).pixels);
		expect(lengthOf(p.shape)).toBeCloseTo(Math.PI, 9);
	});

	it('steps round a ring in whole cells, enough to read round', () => {
		const pieces = (count: number) => stripPieces(roomModel(room([ring({ count })])).pixels)[0];
		expect(stepsOf(pieces(24))).toBe(72);
		expect(stepsOf(pieces(1))).toBe(72);
		expect(stepsOf(pieces(100))).toBe(100);
	});

	it('lays a ribbon across its line, lifted off the mount', () => {
		const [p] = stripPieces(roomModel(DEFAULT_ROOM).pixels);
		const band = Array.from(bandVertices(p.shape, p.normal, 0.03, 0.012, 1));
		const expected = [
			[-1.5, 1.015, 2.388],
			[-1.5, 0.985, 2.388],
			[1.5, 1.015, 2.388],
			[1.5, 0.985, 2.388]
		].flat();
		band.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
	});
});
