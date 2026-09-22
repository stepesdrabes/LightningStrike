import { describe, expect, it } from 'vitest';
import { roomState, type ControllerState, type ControllerStatus } from './controllers.ts';

function statuses(...states: ControllerState[]): ControllerStatus[] {
	return states.map((state, i) => ({
		id: `c${i}`,
		state,
		address: '',
		identity: null,
		telemetry: null,
		wled: null,
		latencyMs: null,
		notes: []
	}));
}

describe('the room in one state', () => {
	it('puts trouble first, then whether frames are going out', () => {
		expect(roomState(statuses('streaming', 'degraded'), true)).toBe('degraded');
		expect(roomState(statuses('streaming', 'offline'), true)).toBe('offline');
		expect(roomState(statuses('sending', 'streaming'), true)).toBe('streaming');
		expect(roomState(statuses('sending'), true)).toBe('sending');
		expect(roomState(statuses('online', 'searching'), false)).toBe('searching');
		expect(roomState(statuses('online'), false)).toBe('online');
	});

	it('has nothing to say about controllers without an address', () => {
		expect(roomState(statuses('unconfigured'), false)).toBe('unconfigured');
		expect(roomState(statuses('unconfigured', 'online'), false)).toBe('online');
		expect(roomState([], true)).toBe('unconfigured');
	});
});
