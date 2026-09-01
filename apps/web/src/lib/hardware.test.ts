import { describe, expect, it } from 'vitest';
import {
	CONTRAST_MAX,
	CONTRAST_MIN,
	OUTPUT_BRIGHTNESS_MIN,
	faultsIn,
	isContrast,
	isOutputBrightness,
	lightsRoom,
	parseIdentity,
	parseTelemetry,
	type DeviceTelemetry
} from './hardware.ts';

// The exact line firmware/wire/src/hello.rs formats, asserted against this same text there.
const HELLO = 'room-node host room-frame fw 0.1.0 up 42s px 720 ddp 4048 stats 4049 leds ws2815';

const withLeds = (leds: string) => HELLO.replace('leds ws2815', `leds ${leds}`);

// The exact line firmware/wire/src/stats.rs formats, asserted against this same text there,
// plus the shorter one FIRMWARE.md documents.
const STATS =
	'up 42s  720 px  120 pkt/s  127.7 KB/s  60.0 fps  gap 15.9/17.8 ms  late 0/0/0  ' +
	'asm 2.1 ms  led 210 us  seqgap 0  bad 0  oob 0  torn 0';
const STATS_NO_LATE =
	'up 42s  720 px  120 pkt/s  127.7 KB/s  60.0 fps  gap 15.9/17.8 ms  asm 2.1 ms  ' +
	'seqgap 0  bad 0  oob 0  torn 0';

describe('the output stage', () => {
	it('never dims all the way off, because that is a switch and the room has one', () => {
		expect(OUTPUT_BRIGHTNESS_MIN).toBeGreaterThan(0);
		expect(isOutputBrightness(0)).toBe(false);
		expect(isOutputBrightness(1)).toBe(true);
	});

	/**
	 * Both ends are where they are for a reason the room paid for: below 2 the mids sit level with
	 * the hits and nothing lands, and at 2.8 every input under a tenth quantises to black, so slow
	 * fades stop fading. A stored value outside them is refused rather than used.
	 */
	it('keeps the exponent inside what a room can be lit at', () => {
		expect(isContrast(CONTRAST_MIN)).toBe(true);
		expect(isContrast(CONTRAST_MAX)).toBe(true);
		expect(isContrast(1)).toBe(false);
		expect(isContrast(3.2)).toBe(false);
		expect(isContrast('2.45')).toBe(false);
	});
});

describe('parseIdentity', () => {
	it('reads every field of the discovery answer', () => {
		const id = parseIdentity(HELLO, '192.168.0.106');
		expect(id).toEqual({
			host: '192.168.0.106',
			name: 'room-frame',
			firmware: '0.1.0',
			uptimeS: 42,
			pixels: 720,
			ddpPort: 4048,
			statsPort: 4049,
			leds: 'ws2815'
		});
	});

	it('reads the output kinds verbatim, including ones it has never heard of', () => {
		expect(parseIdentity(withLeds('ws2815'), 'h')?.leds).toBe('ws2815');
	});

	it('counts anything that emits light as lighting the room', () => {
		const kind = (leds: string) => lightsRoom(parseIdentity(withLeds(leds), 'h'));
		expect(kind('ws2815')).toBe(true);
		expect(kind('lamp')).toBe(true);
		// Both of these receive the whole fixture and light none of it, so the panel has to
		// keep saying the room is dark rather than reading `monitor` as an output.
		expect(kind('stub')).toBe(false);
		expect(kind('monitor')).toBe(false);
		// A build can carry several outputs at once, and one of them being dark says nothing
		// about the board, so the answer is about the list rather than about its first entry.
		expect(kind('monitor+lamp')).toBe(true);
		expect(kind('stub+monitor')).toBe(false);
		expect(lightsRoom(null)).toBe(false);
	});

	it('ignores whatever else is on the port', () => {
		expect(parseIdentity('OK 200 something-else', 'h')).toBeNull();
		expect(parseIdentity('', 'h')).toBeNull();
	});

	it('survives a firmware that drops a field rather than throwing', () => {
		const id = parseIdentity('room-node up 9s px 720', 'h');
		expect(id?.uptimeS).toBe(9);
		expect(id?.firmware).toBe('unknown');
	});
});

describe('parseTelemetry', () => {
	it('reads the whole stats line', () => {
		expect(parseTelemetry(STATS, 1000)).toEqual({
			uptimeS: 42,
			pixels: 720,
			packetsPerSecond: 120,
			kbPerSecond: 127.7,
			fps: 60,
			gapMinMs: 15.9,
			gapMaxMs: 17.8,
			late: [0, 0, 0],
			assemblyMaxMs: 2.1,
			ledMaxUs: 210,
			seqGaps: 0,
			bad: 0,
			outOfRange: 0,
			torn: 0,
			at: 1000
		});
	});

	it('treats late as optional, since the documented sample predates it', () => {
		expect(parseTelemetry(STATS_NO_LATE, 0)?.late).toEqual([0, 0, 0]);
	});

	it('reads the bad numbers the bench actually produced', () => {
		const bad = STATS.replace('late 0/0/0', 'late 322/98/30').replace('60.0 fps', '57.8 fps');
		const t = parseTelemetry(bad, 0);
		expect(t?.late).toEqual([322, 98, 30]);
		expect(t?.fps).toBe(57.8);
	});

	it('rejects a line with no frame rate in it', () => {
		expect(parseTelemetry('up 42s  1320 px', 0)).toBeNull();
		expect(parseTelemetry('', 0)).toBeNull();
	});
});

describe('faultsIn', () => {
	const clean = parseTelemetry(STATS, 0) as DeviceTelemetry;

	it('says nothing about a clean line', () => {
		expect(faultsIn(clean)).toEqual([]);
	});

	it('reports torn frames, which stay valid however the fixture is split', () => {
		expect(faultsIn({ ...clean, torn: 3 })[0]).toContain('3 torn frames');
	});

	it('stays silent about seqgap, which is not a loss count on a split fixture', () => {
		expect(faultsIn({ ...clean, seqGaps: 40 })).toEqual([]);
	});

	it('reports a stall over 100 ms ahead of a merely low frame rate', () => {
		expect(faultsIn({ ...clean, fps: 40, late: [0, 0, 2] })).toEqual(['2 stalls over 100 ms']);
	});

	it('falls back to the frame rate when nothing stalled outright', () => {
		expect(faultsIn({ ...clean, fps: 41.2 })).toEqual(['41.2 fps']);
	});
});
