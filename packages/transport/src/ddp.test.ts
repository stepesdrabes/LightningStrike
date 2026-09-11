import { createSocket } from 'node:dgram';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDdpSink } from './index.ts';

const LEDS = 1320;
let port = 0;
const received: Buffer[] = [];
const server = createSocket('udp4');

beforeAll(async () => {
	await new Promise<void>((resolve) => {
		server.on('message', (msg) => received.push(Buffer.from(msg)));
		server.bind(0, '127.0.0.1', () => {
			port = server.address().port;
			resolve();
		});
	});
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

function frame(): Uint8Array {
	const rgb = new Uint8Array(LEDS * 3);
	for (let i = 0; i < rgb.length; i++) rgb[i] = i % 256;
	return rgb;
}

it('splits 1320 LEDs into 3 packets and pushes only on the last', async () => {
	const sink = createDdpSink({
		targets: [{ host: '127.0.0.1', port, firstLed: 0, ledCount: LEDS }]
	});
	await sink.open();

	received.length = 0;
	const rgb = frame();
	sink.send({ rgb, dt: 1 / 60, frameId: 0, presentAtMs: 0 });

	await new Promise((r) => setTimeout(r, 120));
	await sink.close();

	expect(received.length).toBe(3);

	const lengths = received.map((p) => p.readUInt16BE(8));
	expect(lengths).toEqual([1440, 1440, 1080]);
	expect(lengths.reduce((a, b) => a + b, 0)).toBe(LEDS * 3);

	const offsets = received.map((p) => p.readUInt32BE(4));
	expect(offsets).toEqual([0, 1440, 2880]);

	const pushes = received.map((p) => (p[0] & 0x01) === 1);
	expect(pushes).toEqual([false, false, true]);

	for (const p of received) {
		expect(p[0] & 0xc0).toBe(0x40);
		expect(p[2]).toBe(0x0b);
		expect(p[3]).toBe(1);
		expect(p[1]).toBeGreaterThanOrEqual(1);
		expect(p[1]).toBeLessThanOrEqual(15);
		expect(p.length).toBeLessThanOrEqual(1450);
	}

	const payload = Buffer.concat(received.map((p) => p.subarray(10)));
	expect(Buffer.from(rgb).equals(payload)).toBe(true);
});

it('addresses each target into its own device buffer', async () => {
	const sink = createDdpSink({
		targets: [
			{ host: '127.0.0.1', port, firstLed: 0, ledCount: 300 },
			{ host: '127.0.0.1', port, firstLed: 300, ledCount: 240, deviceFirstLed: 0 }
		]
	});
	await sink.open();

	received.length = 0;
	sink.send({ rgb: frame(), dt: 1 / 60, frameId: 1, presentAtMs: 0 });
	await new Promise((r) => setTimeout(r, 120));
	await sink.close();

	expect(received.length).toBe(2);
	expect(received.map((p) => p.readUInt32BE(4))).toEqual([0, 0]);
	expect(received.map((p) => p.readUInt16BE(8))).toEqual([900, 720]);
});

/** Two targets from a wrapping region still belong to one device and require one PUSH. */
it('pushes once per device, however many targets it is cut into', async () => {
	const sink = createDdpSink({
		targets: [
			{ host: '127.0.0.1', port, firstLed: 1020, ledCount: 60, deviceFirstLed: 0 },
			{ host: '127.0.0.1', port, firstLed: 0, ledCount: 60, deviceFirstLed: 60 }
		]
	});
	await sink.open();

	received.length = 0;
	const rgb = frame();
	sink.send({ rgb, dt: 1 / 60, frameId: 2, presentAtMs: 0 });
	await new Promise((r) => setTimeout(r, 120));
	await sink.close();

	expect(received.length).toBe(2);
	expect(received.map((p) => (p[0] & 0x01) === 1)).toEqual([false, true]);

	// Both halves land where the device expects them, back to back, in ring order.
	expect(received.map((p) => p.readUInt32BE(4))).toEqual([0, 180]);
	const payload = Buffer.concat(received.map((p) => p.subarray(10)));
	const expected = Buffer.concat([
		Buffer.from(rgb.subarray(1020 * 3, 1080 * 3)),
		Buffer.from(rgb.subarray(0, 60 * 3))
	]);
	expect(payload.equals(expected)).toBe(true);
});
