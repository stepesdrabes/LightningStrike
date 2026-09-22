import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM } from '../geometry.ts';
import { readLayout } from './validate.ts';

const problemsOf = (value: unknown) => {
	const read = readLayout(value);
	return 'problems' in read ? read.problems : [];
};

describe('reading a layout', () => {
	it('takes the frame as it is', () => {
		expect(readLayout(JSON.parse(JSON.stringify(DEFAULT_ROOM)))).toEqual({ layout: DEFAULT_ROOM });
	});

	it('names every problem in words rather than stopping at the first', () => {
		const problems = problemsOf({
			width: 0,
			depth: 4,
			height: 2.5,
			front: 'up',
			lights: [
				{ id: 'a', name: 'Shelf', kind: 'path', points: [[0, 0, 1]], counts: [], closed: false, density: 60, mount: 'ceiling', role: 'auto' },
				{ id: 'a', name: 'Glow', kind: 'lamp', at: [0, 0, 0], height: 1, diameter: 0.2, mode: 'summary' },
				{ id: 'b', name: 'Mystery', kind: 'laser' }
			]
		});
		expect(problems).toEqual([
			'The room width has to be from 0.5 to 100 metres.',
			'The front has to be one of the four walls.',
			'"Shelf" needs at least two points in metres.',
			'Two lights share the id "a".',
			'"Mystery" has to be a path, a ring, a matrix or a lamp.'
		]);
	});

	it('refuses wiring that names no controller or starts before the first pixel', () => {
		const lamp = { id: 'l', name: 'Lamp', kind: 'lamp', at: [0, 0, 0], height: 0, diameter: 0.1, mode: 'pixel' };
		expect(problemsOf({ ...DEFAULT_ROOM, lights: [{ ...lamp, wiring: { controller: '', start: 0 } }] })).toHaveLength(1);
		expect(problemsOf({ ...DEFAULT_ROOM, lights: [{ ...lamp, wiring: { controller: 'c', start: -1 } }] })).toHaveLength(1);
		expect(problemsOf({ ...DEFAULT_ROOM, lights: [{ ...lamp, wiring: { controller: 'c', start: 3 } }] })).toEqual([]);
	});

	it('caps a room at what the ring maps can address', () => {
		const run = { id: 'r', name: 'Run', kind: 'ring', centre: [0, 0, 2], radius: 1, count: 10000, startAngle: 0, clockwise: true, mount: 'ceiling', role: 'auto' };
		const lights = Array.from({ length: 7 }, (_, i) => ({ ...run, id: `r${i}` }));
		expect(problemsOf({ ...DEFAULT_ROOM, lights })).toEqual(['A room can hold 65535 LEDs; this one has 70000.']);
	});
});
