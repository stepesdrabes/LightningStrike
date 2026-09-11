import { describe, expect, it } from 'vitest';
import {
	displayName,
	effectLabel,
	isStreaming,
	parseInfo,
	parseState,
	type LightState
} from './protocol.ts';

/** The exact bytes `firmware/api` answers with, from the samples pinned in docs/FIRMWARE.md. */
const STATE_JSON = JSON.parse(
	'{"power":"on","colour":"#ffb46e","brightness":160,"effect":"twinkle","powerOn":"restore","mode":"smart"}'
) as unknown;

const INFO_JSON = JSON.parse(
	'{"name":"room-bounce","ip":"192.168.0.106","firmware":"0.2.0","uptimeS":42,"pixels":1,"ddpPort":4048,"statsPort":4049,"leds":"lamp","effects":["wash"]}'
) as unknown;

describe('parseState', () => {
	it('reads what the firmware serialises', () => {
		expect(parseState(STATE_JSON)).toEqual({
			power: 'on',
			colour: '#ffb46e',
			brightness: 160,
			effect: 'twinkle',
			powerOn: 'restore',
			mode: 'smart'
		});
	});

	it('rejects a reply that is not a light', () => {
		expect(parseState(null)).toBeNull();
		expect(parseState('<html>')).toBeNull();
		expect(parseState({ power: 'maybe', colour: '#ffb46e' })).toBeNull();
		expect(parseState({ power: 'on', colour: 'ffb46e' })).toBeNull();
	});

	it('clamps brightness rather than trusting it', () => {
		const wild = { ...(STATE_JSON as object), brightness: 9000 };
		expect(parseState(wild)?.brightness).toBe(255);
	});

	/** The tolerant-reader stance the firmware takes, from this end. */
	it('falls back rather than failing on a vocabulary it does not know', () => {
		const future = { ...(STATE_JSON as object), powerOn: 'solar', mode: 'disco' };
		const parsed = parseState(future);
		expect(parsed?.powerOn).toBe('restore');
		expect(parsed?.mode).toBe('smart');
	});
});

describe('parseInfo', () => {
	it('reads the lamp, which runs one effect', () => {
		const info = parseInfo(INFO_JSON);
		expect(info?.name).toBe('room-bounce');
		expect(info?.ip).toBe('192.168.0.106');
		expect(info?.effects).toEqual(['wash']);
	});

	it('does not mistake another device for a light', () => {
		expect(parseInfo({ status: 'ok' })).toBeNull();
		expect(parseInfo({ name: 'printer' })).toBeNull();
		expect(parseInfo('<html>')).toBeNull();
		expect(parseInfo({ name: 'room-frame', ddpPort: 4048 })?.effects).toEqual([]);
	});
});

describe('labels', () => {
	it('names the boards the way the room does', () => {
		expect(displayName(parseInfo(INFO_JSON), '192.168.0.106')).toBe('Bounce Lamp');
	});

	it('keeps an unknown board name rather than inventing one', () => {
		expect(displayName(parseInfo({ name: 'room-porch', ddpPort: 4048 }), 'x')).toBe('room-porch');
		expect(effectLabel('shimmer')).toBe('Shimmer');
	});
});

describe('isStreaming', () => {
	it('is true for both party readings and nothing else', () => {
		const base = parseState(STATE_JSON) as LightState;
		expect(isStreaming(base)).toBe(false);
		expect(isStreaming({ ...base, mode: 'party' })).toBe(true);
		expect(isStreaming({ ...base, mode: 'party-muted' })).toBe(true);
		expect(isStreaming(null)).toBe(false);
	});
});
