import { describe, expect, it } from 'vitest';
import { firstRoom } from './rooms.ts';

describe('the first room', () => {
	it('plays the Frame in the preview for an installation that never ran', () => {
		const room = firstRoom(null);
		expect(room.controllers).toEqual([]);
		expect(room.layout.lights.map((l) => l.id)).toEqual(['frame', 'beam', 'bounce']);
		expect(room.layout.lights.every((l) => l.wiring === undefined)).toBe(true);
	});

	it('carries an existing installation into the Frame as it was set, without lighting itself', () => {
		const room = firstRoom({ offsetMs: 40, fps: 120, brightness: 0.8, contrast: 2.2, lampBrightness: 0.6, protocol: 'sacn' });
		expect(room.output).toEqual({ fps: 120, leadMs: 40, level: 0.8, punch: 2.2, autoStart: false });
		expect(room.controllers[0]).toMatchObject({ id: 'frame', kind: 'sacn', universe: 1 });
		expect(room.controllers[1]).toMatchObject({ id: 'bounce', kind: 'lightningstrike' });
		// The lamp was set on its own; now it is a share of the room's level, delivering the same.
		expect(room.layout.lights.find((l) => l.id === 'bounce')?.level).toBe(0.75);
	});

	it('leaves a lamp at the room level as it is', () => {
		const room = firstRoom({ brightness: 0.8, lampBrightness: 0.9 });
		expect(room.layout.lights.find((l) => l.id === 'bounce')?.level).toBeUndefined();
	});
});
