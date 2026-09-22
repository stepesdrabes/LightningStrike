import { describe, expect, it } from 'vitest';
import { ledCount, type PathLight } from '@mv/core';
import { emptyRoom, frameRoom } from './rooms.ts';
import {
	foundIn,
	keepInside,
	lightFor,
	movePoint,
	nextFreePixel,
	removePoint,
	setClosed,
	splitRun,
	translate,
	waitingFor,
	wire,
	withController,
	withCopy,
	withoutController
} from './roomEdit.ts';

const strip: PathLight = {
	id: 's',
	name: 'Strip',
	kind: 'path',
	points: [
		[0, 0, 2],
		[1, 0, 2]
	],
	counts: [60],
	closed: false,
	density: 60,
	mount: 'ceiling',
	role: 'auto'
};

describe('editing a light', () => {
	it('moves every point of it together', () => {
		expect(translate(strip, 0.5, -0.25)).toMatchObject({ points: [[0.5, -0.25, 2], [1.5, -0.25, 2]] });
	});

	it('keeps it inside the room without changing its shape', () => {
		const moved = keepInside(translate(strip, 2.4, 0), 5, 4, 2.6) as PathLight;
		expect(moved.points).toEqual([
			[1.5, 0, 2],
			[2.5, 0, 2]
		]);
	});

	it('gives a run the LEDs its new length holds at the strip density', () => {
		expect(movePoint(strip, 1, [2, 0, 2]).counts).toEqual([120]);
		expect(movePoint(strip, 1, [0, 0, 2]).counts).toEqual([1]);
	});

	it('splits a run in two and joins two back into one', () => {
		const split = splitRun(strip, 0);
		expect(split.points).toEqual([
			[0, 0, 2],
			[0.5, 0, 2],
			[1, 0, 2]
		]);
		expect(split.counts).toEqual([30, 30]);
		expect(removePoint(split, 1).counts).toEqual([60]);
		expect(removePoint(strip, 0)).toBe(strip);
		expect(splitRun(strip, 0, 0.25).counts).toEqual([15, 45]);
	});

	it('closes a path with a run back to its start, and opens it again', () => {
		const path = { ...strip, points: [...strip.points, [1, 1, 2]] as PathLight['points'], counts: [60, 60] };
		const loop = setClosed(path, true);
		expect(loop.counts).toEqual([60, 60, 85]);
		expect(setClosed(loop, false).counts).toEqual([60, 60]);
		expect(setClosed(strip, true)).toBe(strip);
	});
});

describe('wiring', () => {
	it('starts a new light on the pixel after the last one a controller carries', () => {
		const room = frameRoom('r');
		expect(nextFreePixel(room, 'frame')).toBe(673);
		expect(nextFreePixel(room, 'bounce')).toBe(1);
		expect(nextFreePixel(room, 'frame', 'beam')).toBe(564);
		expect(nextFreePixel(room, 'nobody')).toBe(0);
	});

	it('copies a light beside the original, unwired, under a name of its own', () => {
		const copy = withCopy(frameRoom('r'), 'beam')!;
		const light = copy.room.layout.lights.find((l) => l.id === copy.id) as PathLight;
		expect(light).toMatchObject({ id: 'beam-2', name: 'Beam 2', points: [[0.2, -1.2, 2.4], [0.2, 0.8, 2.4]] });
		expect(light.wiring).toBeUndefined();
	});

	it('wires a light after the last one and leaves lights behind when a controller goes', () => {
		const room = wire(frameRoom('r'), 'beam', 'bounce');
		expect(room.layout.lights.find((l) => l.id === 'beam')?.wiring).toEqual({ controller: 'bounce', start: 1 });
		const bare = withoutController(room, 'frame');
		expect(bare.controllers.map((c) => c.id)).toEqual(['bounce']);
		expect(bare.layout.lights.find((l) => l.id === 'frame')?.wiring).toBeUndefined();
	});
});

describe('a light for a found controller', () => {
	const layout = emptyRoom('r', 'Room').layout;

	it('is a panel on the front wall for a 2D setup', () => {
		const light = lightFor({ kind: 'wled', host: 'h', name: 'n', pixels: 256, matrix: { width: 16, height: 16 } }, layout, 'p', 'Panel');
		expect(light).toMatchObject({ kind: 'matrix', columns: 16, rows: 16, mount: 'south' });
	});

	it('goes round the ceiling when it is long enough, and along the front wall when not', () => {
		const loop = lightFor({ kind: 'wled', host: 'h', name: 'n', pixels: 900 }, layout, 'l', 'Loop') as PathLight;
		expect(loop.closed).toBe(true);
		expect(ledCount(loop)).toBe(900);
		const short = lightFor({ kind: 'wled', host: 'h', name: 'n', pixels: 120 }, layout, 's', 'Strip') as PathLight;
		expect(short).toMatchObject({ closed: false, counts: [120] });
		expect(short.points[0][1]).toBeLessThan(0);
		expect(lightFor({ kind: 'artnet', host: 'h', name: 'n' }, layout, 'x', 'X')).toBeNull();
	});
});

describe('a found controller', () => {
	const frame = frameRoom('r');

	it('is offered first to the controller already sent as many pixels as it drives', () => {
		const board = { kind: 'lightningstrike' as const, host: '10.0.0.7', name: 'room-node', pixels: 673 };
		expect(waitingFor(frame, board).map((c) => c.id)).toEqual(['frame', 'bounce']);
		const lamp = { kind: 'lightningstrike' as const, host: '10.0.0.8', name: 'bounce-lamp', pixels: 1 };
		expect(waitingFor(frame, lamp).map((c) => c.id)).toEqual(['bounce', 'frame']);
		expect(waitingFor(frame, { kind: 'wled', host: '10.0.0.9', name: 'desk' })).toEqual([]);
	});

	it('is recognised by its address or its hardware once it is in the room', () => {
		const room = withController(frame, { ...frame.controllers[0], host: '10.0.0.7', mac: 'aabbccddeeff' });
		expect(foundIn(room, { kind: 'lightningstrike', host: '10.0.0.7', name: 'x' })?.id).toBe('frame');
		expect(foundIn(room, { kind: 'lightningstrike', host: '10.0.0.70', name: 'x', mac: 'aabbccddeeff' })?.id).toBe('frame');
		expect(foundIn(room, { kind: 'lightningstrike', host: '10.0.0.71', name: 'x' })).toBeUndefined();
	});
});
