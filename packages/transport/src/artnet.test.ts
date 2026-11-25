import { createSocket, type Socket } from 'node:dgram';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LedFrame } from '@mv/core';
import { ARTNET_PIXELS_PER_UNIVERSE, artPoll, createArtnetSink, parseArtPollReply } from './artnet.ts';

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

async function capture(ledCount: number, universe: number, frames: LedFrame[]): Promise<Buffer[]> {
	inbox.length = 0;
	const sink = createArtnetSink({ targets: [{ host: '127.0.0.1', port, universe, ledCount }] });
	await sink.open();
	for (const f of frames) sink.send(f);
	await new Promise((r) => setTimeout(r, 60));
	await sink.close();
	return [...inbox].sort((a, b) => a[14] + a[15] * 256 - (b[14] + b[15] * 256) || a[12] - b[12]);
}

describe('Art-Net output', () => {
	it('cuts a device into ArtDmx universes of 170 pixels from its first Port-Address', async () => {
		const frame = frameOf(200, (i) => i % 256);
		const packets = await capture(200, 0x0123, [frame]);
		expect(packets).toHaveLength(2);
		for (const p of packets) {
			expect(p.subarray(0, 8).toString('ascii')).toBe('Art-Net\0');
			expect(p.readUInt16LE(8)).toBe(0x5000);
			expect(p[11]).toBe(14);
		}
		const [first, second] = packets;
		expect([first[14], first[15]]).toEqual([0x23, 0x01]);
		expect([second[14], second[15]]).toEqual([0x24, 0x01]);
		expect(first.readUInt16BE(16)).toBe(ARTNET_PIXELS_PER_UNIVERSE * 3);
		expect(second.readUInt16BE(16)).toBe(30 * 3);
		expect([...first.subarray(18, 24)]).toEqual([0, 1, 2, 3, 4, 5]);
		expect(second[18]).toBe((ARTNET_PIXELS_PER_UNIVERSE * 3) % 256);
	});

	it('pads an odd channel count and counts the sequence up past zero', async () => {
		const frames = Array.from({ length: 3 }, () => frameOf(1, () => 9));
		const packets = await capture(1, 0, frames);
		expect(packets.map((p) => p.readUInt16BE(16))).toEqual([4, 4, 4]);
		expect(packets.map((p) => p[12])).toEqual([1, 2, 3]);
	});
});

describe('Art-Net discovery', () => {
	it('asks with a minimal ArtPoll', () => {
		const poll = artPoll();
		expect(poll.length).toBe(14);
		expect(poll.readUInt16LE(8)).toBe(0x2000);
	});

	it('reads a node from its ArtPollReply', () => {
		const reply = Buffer.alloc(239);
		reply.write('Art-Net\0', 0, 'ascii');
		reply.writeUInt16LE(0x2100, 8);
		reply.set([192, 168, 0, 40], 10);
		reply[18] = 1;
		reply[19] = 2;
		reply.write('Pixel', 26, 'ascii');
		reply.write('Pixel Node 4', 44, 'ascii');
		reply[190] = 3;
		reply.set([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01], 201);
		expect(parseArtPollReply(reply)).toEqual({
			ip: '192.168.0.40',
			name: 'Pixel Node 4',
			universe: 0x123,
			mac: 'deadbeef0001'
		});
		expect(parseArtPollReply(reply.subarray(0, 100))).toBeNull();
	});
});
