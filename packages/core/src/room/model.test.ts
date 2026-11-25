import { describe, expect, it } from 'vitest';
import type { Light, MatrixLight, RoomLayout } from '../contracts/room.ts';
import { runGate } from '../effects/gate.ts';
import { BUILT_IN_EFFECTS, EffectRegistry } from '../effects/index.ts';
import { DEFAULT_ROOM, buildGeometry, roomModel } from '../geometry.ts';
import { matrixOrder } from './lights.ts';

const room = (lights: Light[], front: RoomLayout['front'] = 'south'): RoomLayout => ({
	width: 4,
	depth: 3,
	height: 2.5,
	front,
	lights
});

const strip = (id: string, from: [number, number, number], to: [number, number, number], count = 60): Light => ({
	id,
	name: id,
	kind: 'path',
	points: [from, to],
	counts: [count],
	closed: false,
	density: 60,
	mount: 'ceiling',
	role: 'auto'
});

/** 3 by 2 metres at 30 LED/m: 90 along the long walls, 60 along the short, east wall first. */
const loop = (id: string, counts = [60, 90, 60, 90]): Light => ({
	id,
	name: id,
	kind: 'path',
	// Drawn counter-clockwise from the south-east corner on purpose.
	points: [
		[1.5, -1, 2.4],
		[1.5, 1, 2.4],
		[-1.5, 1, 2.4],
		[-1.5, -1, 2.4]
	],
	counts,
	closed: true,
	density: 30,
	mount: 'ceiling',
	role: 'auto'
});

const panel = (overrides: Partial<MatrixLight> = {}): MatrixLight => ({
	id: 'panel',
	name: 'Panel',
	kind: 'matrix',
	centre: [0, 1.5, 1.4],
	width: 1.5,
	height: 1.5,
	columns: 16,
	rows: 16,
	mount: 'north',
	first: 'top-left',
	horizontal: true,
	serpentine: true,
	role: 'auto',
	...overrides
});

const lamp = (id: string, at: [number, number, number], mode: 'summary' | 'pixel' = 'pixel'): Light => ({
	id,
	name: id,
	kind: 'lamp',
	at,
	height: 0,
	diameter: 0.1,
	mode
});

/** Every LED of every lit light lands on exactly one effect pixel, and every effect pixel is one. */
function expectOneToOne(layout: RoomLayout): void {
	const model = roomModel(layout);
	const seen = new Set<number>();
	for (const p of model.pixels) {
		for (const i of p.index) {
			expect(i).toBeGreaterThanOrEqual(0);
			expect(seen.has(i)).toBe(false);
			seen.add(i);
		}
	}
	expect(seen.size).toBe(model.geometry.count);
}

describe('a room of any shape', () => {
	it('walks a lone strip as its ring, cut into four even walls', () => {
		const g = buildGeometry(room([strip('shelf', [-1.5, 1.4, 2], [1.5, 1.4, 2], 60)]));
		expect(g.strips.map((s) => [s.count, s.inPerimeter])).toEqual([
			[15, true],
			[15, true],
			[15, true],
			[15, true]
		]);
		expect(g.perim[0]).toBeGreaterThanOrEqual(0);
		expect(g.perim[59]).toBeLessThan(1);
		expect(g.spine).toBe(false);
	});

	it('starts a loop at its corner nearest the north-west and walks it clockwise', () => {
		const g = buildGeometry(room([loop('loop')]));
		expect(g.strips.map((s) => s.count)).toEqual([90, 60, 90, 60]);
		// The north wall runs west to east.
		expect(g.x[0]).toBeLessThan(g.x[89]);
		expect(g.y[0]).toBeCloseTo(1);
		for (let i = 1; i < g.count; i++) expect(g.perim[i]).toBeGreaterThan(g.perim[i - 1]);
		expectOneToOne(room([loop('loop')]));
	});

	it('turns the room so its front wall is where effects point', () => {
		const southFacing = buildGeometry(room([loop('loop')]));
		const northFacing = buildGeometry(room([loop('loop')], 'north'));
		const theta = (g: typeof southFacing, i: number) => g.theta[i];
		// The show's south wall is the room's north wall once the room faces north.
		const southWall = northFacing.strips[2];
		const mid = southWall.offset + Math.floor(southWall.count / 2);
		expect(theta(northFacing, mid)).toBeCloseTo(0.75, 1);
		// Pixel maps stay in room coordinates: the data still enters on the east wall.
		expect(roomModel(room([loop('loop')], 'north')).pixels[0].position[0]).toBeCloseTo(1.5);
		expect(southFacing.count).toBe(northFacing.count);
	});

	it('takes a straight run across the middle of a loop as its spine', () => {
		const layout = room([loop('loop'), strip('beam', [0, -1, 2.4], [0, 1, 2.4], 40)]);
		const g = buildGeometry(layout);
		expect(g.spine).toBe(true);
		expect(g.strips[4]).toMatchObject({ name: 'beam', count: 40, inPerimeter: false });
		expectOneToOne(layout);
	});

	it('rings a lone panel with its border and fills the middle as a field', () => {
		const layout = room([panel()]);
		const g = buildGeometry(layout);
		expect(g.count).toBe(256);
		const ringCount = g.strips.filter((s) => s.inPerimeter).reduce((n, s) => n + s.count, 0);
		expect(ringCount).toBe(60);
		expect(g.strips.at(-1)).toMatchObject({ count: 196, inPerimeter: false });
		expectOneToOne(layout);
	});

	it('joins separate lights round the room into one ring', () => {
		const layout = room([
			strip('north', [-1.5, 1.4, 2], [1.5, 1.4, 2], 40),
			strip('south', [1.5, -1.4, 2], [-1.5, -1.4, 2], 40),
			lamp('east', [1.9, 0, 1]),
			lamp('west', [-1.9, 0, 1])
		]);
		const g = buildGeometry(layout);
		expect(g.strips.filter((s) => s.inPerimeter).reduce((n, s) => n + s.count, 0)).toBe(82);
		expectOneToOne(layout);
	});

	it('borrows the frame when it has only summary lamps, so they still have a room to reduce', () => {
		const model = roomModel(room([lamp('a', [1, 1, 0], 'summary'), lamp('b', [-1, 1, 0], 'summary')]));
		expect(model.borrowed).toBe(true);
		expect(model.pixels).toEqual([]);
		expect(model.lamps.map((l) => l.id)).toEqual(['a', 'b']);
		expect(model.geometry.count).toBe(buildGeometry(DEFAULT_ROOM).count);
	});

	it('keeps strip ids within a byte however many lights there are', () => {
		const lamps = Array.from({ length: 300 }, (_, i) =>
			lamp(`l${i}`, [Math.cos(i) * 1.8, Math.sin(i) * 1.3, 1 + (i % 3) * 0.1])
		);
		const layout = room([loop('loop'), ...lamps.map((l) => ({ ...l, role: 'field' }) as Light)]);
		const g = buildGeometry(layout);
		expect(g.strips.length).toBeLessThanOrEqual(256);
		expect(g.strips.every((s, i) => s.id === i)).toBe(true);
		expectOneToOne(layout);
	});
});

describe('panel wiring', () => {
	it('snakes from the corner the data enters at', () => {
		const order = matrixOrder(panel({ columns: 3, rows: 2, first: 'bottom-right' }));
		expect(order).toEqual([
			[2, 1],
			[1, 1],
			[0, 1],
			[0, 0],
			[1, 0],
			[2, 0]
		]);
	});
});

describe('effects in rooms without a spine', () => {
	it('play a relative of the same role in place of a beam effect, and leave the frame alone', () => {
		const onFrame = new EffectRegistry();
		onFrame.fitTo(buildGeometry(DEFAULT_ROOM));
		expect(onFrame.get('snareWhip')?.id).toBe('snareWhip');

		const onLoop = new EffectRegistry();
		onLoop.fitTo(buildGeometry(room([loop('loop')])));
		const stand = onLoop.get('snareWhip');
		expect(stand?.id).not.toBe('snareWhip');
		expect(stand?.role).toBe('transient');
		expect(stand?.needs ?? []).not.toContain('spine');
	});
});

describe('every built-in effect in odd rooms', () => {
	const rooms: [string, RoomLayout][] = [
		['a lone strip', room([strip('s', [-1, 0.5, 2], [1, 0.5, 2], 50)])],
		['a vertical strip', room([strip('v', [0, 1.4, 0.2], [0, 1.4, 2.2], 30)])],
		['a ring', room([{ id: 'r', name: 'r', kind: 'ring', centre: [0, 0, 2.4], radius: 0.6, count: 48, startAngle: 0, clockwise: true, mount: 'ceiling', role: 'auto' }])],
		['a wall panel', room([panel({ columns: 8, rows: 8 })])],
		['three lamps', room([lamp('a', [1, 1, 1]), lamp('b', [-1, 1, 1]), lamp('c', [0, -1, 1])])],
		['one lamp', room([lamp('a', [0, 0, 1])])]
	];

	it.each(rooms)('renders every effect bounded, finite and deterministic in %s', (_, layout) => {
		const g = buildGeometry(layout);
		const failures = BUILT_IN_EFFECTS.flatMap((def) =>
			runGate(def, g).failures.map((f) => `${def.id}: ${f}`)
		);
		expect(failures).toEqual([]);
	});
});
