import { describe, expect, it } from 'vitest';
import { ledCount } from '@mv/core';
import { emptyRoom, frameRoom, freshId, newLight, previewRoom, readRoom, type Room } from './rooms.ts';

function problemsOf(room: unknown): string[] {
	const read = readRoom(room);
	return 'problems' in read ? read.problems : [];
}

describe('reading a room', () => {
	it('takes back what it wrote', () => {
		for (const room of [frameRoom('f'), previewRoom('p'), emptyRoom('e', 'Empty')]) {
			expect(readRoom(JSON.parse(JSON.stringify(room)))).toEqual({ room });
		}
	});

	it('says what is wrong with a controller in words', () => {
		const room = frameRoom('f');
		const broken = {
			...room,
			controllers: [
				{ ...room.controllers[0], kind: 'dmx' },
				{ ...room.controllers[1], host: 'http://10.0.0.2/' }
			]
		};
		expect(problemsOf(broken)).toEqual([
			'"The Frame" is not a kind of controller this app speaks to.',
			'"Bounce Lamp" needs an address or a network name.'
		]);
		expect(problemsOf({ ...room, controllers: [] })).toEqual([
			'"Frame" is wired to a controller this room does not have.',
			'"Beam" is wired to a controller this room does not have.',
			'"Bounce Lamp" is wired to a controller this room does not have.'
		]);
	});

	it('wants a first universe in range for sACN and Art-Net only', () => {
		const room = frameRoom('f');
		const with_ = (kind: string, universe?: number): Room =>
			({ ...room, controllers: [{ ...room.controllers[0], kind, universe }, room.controllers[1]] }) as Room;
		expect(problemsOf(with_('sacn', 0))).toEqual(['"The Frame" needs its first universe, from 1 to 63999.']);
		expect(problemsOf(with_('artnet', 0))).toEqual([]);
		const ddp = readRoom(with_('ddp', 7));
		expect('room' in ddp && ddp.room.controllers[0].universe).toBe(undefined);
	});

	it('keeps output settings within what the hardware can take', () => {
		const room = frameRoom('f');
		expect(problemsOf({ ...room, output: { ...room.output, fps: 90 } })).toEqual([
			'The frame rate has to be 30, 60 or 120.'
		]);
		expect(problemsOf({ ...room, output: { ...room.output, level: 0 } })).toEqual(['The level has to be from 0.1 to 1.']);
	});
});

describe('new rooms and lights', () => {
	it('gives ids that read like their names and never repeat', () => {
		expect(freshId('Living room', [])).toBe('living-room');
		expect(freshId('Living room', ['living-room', 'living-room-2'])).toBe('living-room-3');
		expect(freshId('!!!', [])).toBe('item');
	});

	it('places a new light where it reads: on the wall in view, else the front wall or the ceiling', () => {
		const layout = emptyRoom('e', 'Empty').layout;
		expect(newLight('matrix', layout, 'p')).toMatchObject({ mount: 'south', centre: [0, -1.98, 1.3] });
		expect(newLight('matrix', layout, 'p', 'east')).toMatchObject({ mount: 'east', centre: [2.48, 0, 1.3] });
		expect(newLight('ring', layout, 'r')).toMatchObject({ mount: 'ceiling', centre: [0, 0, 2.58] });
		const strip = newLight('strip', layout, 's', 'west');
		expect(strip).toMatchObject({ mount: 'west', points: [[-2.48, -1.5, 2.4], [-2.48, 1.5, 2.4]] });
		expect(ledCount(newLight('loop', layout, 'l'))).toBe(936);
	});
});
