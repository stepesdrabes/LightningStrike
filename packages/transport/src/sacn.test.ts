import { createSocket, type Socket } from 'node:dgram';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LedFrame } from '@mv/core';
import { SACN_PIXELS_PER_UNIVERSE, createSacnSink, sacnMulticastHost } from './sacn.ts';

/**
 * Validate all three nested PDU lengths from received bytes; a receiver silently drops
 * inconsistent lengths.
 */
function frameOf(pixels: number, fill: (i: number) => number): LedFrame {
	const rgb = new Uint8Array(pixels * 3);
	for (let i = 0; i < rgb.length; i++) rgb[i] = fill(i);
	return { rgb, frameId: 1, dt: 1 / 60, presentAtMs: 0 };
}

let socket: Socket;
let port: number;
const inbox: Buffer[] = [];

beforeAll(async () => {
	socket = createSocket('udp4');
	socket.on('message', (msg) => inbox.push(Buffer.from(msg)));
	await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
	port = socket.address().port;
});

afterAll(async () => {
	await new Promise<void>((resolve) => socket.close(() => resolve()));
});

/** Send one frame to the listening socket and hand back what actually arrived. */
async function capture(targets: Parameters<typeof createSacnSink>[0]['targets'], frame: LedFrame) {
	inbox.length = 0;
	const sink = createSacnSink({ targets, sourceName: 'test' });
	await sink.open();
	sink.send(frame);
	await new Promise((r) => setTimeout(r, 60));
	await sink.close();
	return [...inbox];
}

describe('the sACN sink', () => {
	it('writes a packet a receiver will accept', async () => {
		const packets = await capture(
			[{ host: '127.0.0.1', port, firstLed: 0, ledCount: 2, universe: 1 }],
			frameOf(2, (i) => i + 1)
		);

		expect(packets).toHaveLength(1);
		const p = packets[0];
		expect(p.length).toBe(126 + 6);
		expect(p.readUInt16BE(0)).toBe(0x0010);
		expect(p.toString('ascii', 4, 13)).toBe('ASC-E1.17');
		expect(p.readUInt32BE(18)).toBe(4);
		expect(p.readUInt32BE(40)).toBe(2);
		expect(p[108]).toBe(100);
		expect(p.readUInt16BE(113)).toBe(1);
		expect(p[117]).toBe(0x02);
		expect(p[118]).toBe(0xa1);
		expect(p.readUInt16BE(121)).toBe(1);

		// Each PDU's length counts from its own first byte to the end of the packet.
		expect(p.readUInt16BE(16)).toBe(0x7000 | (p.length - 16));
		expect(p.readUInt16BE(38)).toBe(0x7000 | (p.length - 38));
		expect(p.readUInt16BE(115)).toBe(0x7000 | (p.length - 115));

		// The start code shares the count with the channels, and is the first of them.
		expect(p.readUInt16BE(123)).toBe(7);
		expect(p[125]).toBe(0);
		expect([...p.subarray(126)]).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('cuts a fixture into universes at 170 pixels, never mid-pixel', async () => {
		const pixels = SACN_PIXELS_PER_UNIVERSE + 5;
		const packets = await capture(
			[{ host: '127.0.0.1', port, firstLed: 0, ledCount: pixels, universe: 7 }],
			frameOf(pixels, (i) => i % 256)
		);

		expect(packets).toHaveLength(2);
		expect(packets[0].readUInt16BE(113)).toBe(7);
		expect(packets[1].readUInt16BE(113)).toBe(8);
		expect(packets[0].length - 126).toBe(SACN_PIXELS_PER_UNIVERSE * 3);
		expect(packets[1].length - 126).toBe(15);
		// The second universe picks up exactly where the first left off.
		expect(packets[1][126]).toBe((SACN_PIXELS_PER_UNIVERSE * 3) % 256);
	});

	it('assembles a device from its slices before cutting universes', async () => {
		// Two runs of the frame landing in one controller's buffer, the far one first: the ring
		// wraps and the frame does not, which is why a slice can arrive out of order.
		const packets = await capture(
			[
				{ host: '127.0.0.1', port, firstLed: 3, ledCount: 1, deviceFirstLed: 1, universe: 1 },
				{ host: '127.0.0.1', port, firstLed: 0, ledCount: 1, deviceFirstLed: 0, universe: 1 }
			],
			frameOf(4, (i) => i + 1)
		);

		expect(packets).toHaveLength(1);
		// Device pixel 0 is frame pixel 0, device pixel 1 is frame pixel 3.
		expect([...packets[0].subarray(126)]).toEqual([1, 2, 3, 10, 11, 12]);
	});

	it('numbers each universe on its own sequence counter', async () => {
		const targets = [
			{ host: '127.0.0.1', port, firstLed: 0, ledCount: SACN_PIXELS_PER_UNIVERSE + 1, universe: 1 }
		];
		const frame = frameOf(SACN_PIXELS_PER_UNIVERSE + 1, () => 9);
		inbox.length = 0;
		const sink = createSacnSink({ targets, sourceName: 'test' });
		await sink.open();
		sink.send(frame);
		sink.send(frame);
		await new Promise((r) => setTimeout(r, 60));
		await sink.close();

		const byUniverse = new Map<number, number[]>();
		for (const p of inbox) {
			const u = p.readUInt16BE(113);
			byUniverse.set(u, [...(byUniverse.get(u) ?? []), p[111]]);
		}
		expect(byUniverse.get(1)).toEqual([1, 2]);
		expect(byUniverse.get(2)).toEqual([1, 2]);
	});

	it('addresses the universe multicast group when no host is named', () => {
		expect(sacnMulticastHost(1)).toBe('239.255.0.1');
		expect(sacnMulticastHost(256)).toBe('239.255.1.0');
		expect(sacnMulticastHost(513)).toBe('239.255.2.1');
	});
});
