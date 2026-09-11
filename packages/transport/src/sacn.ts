import { randomUUID } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import type { LedFrame, LedSink, LedSinkStats } from '@mv/core';

export const SACN_PORT = 5568;

/** 170 RGB pixels fit 510 DMX channels; leave two unused so pixels never straddle universes. */
export const SACN_PIXELS_PER_UNIVERSE = 170;

/**
 * Header through the start code at byte 125; channels start at 126 and exclude that property
 * value.
 */
const HEADER = 126;
const ACN_ID = 'ASC-E1.17';
const VECTOR_ROOT_E131_DATA = 0x00000004;
const VECTOR_E131_DATA_PACKET = 0x00000002;
const VECTOR_DMP_SET_PROPERTY = 0x02;
const ADDRESS_DATA_TYPE = 0xa1;
const DEFAULT_PRIORITY = 100;

interface SacnTarget {
	/** Unicast host, or the universe multicast group when omitted. */
	host?: string;
	port?: number;
	/** Slice of the global frame this device owns. */
	firstLed: number;
	ledCount: number;
	/** Where that slice lands in the device's own buffer. Normally 0. */
	deviceFirstLed?: number;
	/** The device's first universe; its buffer runs on from there. */
	universe: number;
}

interface SacnOptions {
	targets: readonly SacnTarget[];
	/** Shown in receivers' source lists. */
	sourceName?: string;
	/** 0-200. Higher wins where two sources drive one universe. */
	priority?: number;
}

/** 239.255.{universe high}.{universe low}, per E1.31 section 9.3.1. */
export function sacnMulticastHost(universe: number): string {
	return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

interface Device {
	host?: string;
	port: number;
	firstUniverse: number;
	/** Every target writing into this device's buffer. */
	slices: { at: number; from: number; length: number }[];
	/** The device's own pixel buffer, assembled before it is cut into universes. */
	buffer: Uint8Array;
	pixels: number;
}


export function createSacnSink(opts: SacnOptions): LedSink {
	let socket: Socket | null = null;
	const stats: LedSinkStats = { framesSent: 0, framesDropped: 0, bytesSent: 0 };
	const priority = opts.priority ?? DEFAULT_PRIORITY;

	// One identity for this source, stable for as long as it runs: receivers use the CID to
	// tell two sources apart when they arbitrate a universe.
	const cid = Buffer.from(randomUUID().replace(/-/g, ''), 'hex');
	const sourceName = Buffer.alloc(64);
	sourceName.write((opts.sourceName ?? 'LightningStrike').slice(0, 63), 'utf8');

	/**
	 * Assemble each device before splitting universes; a mid-universe slice alone would blank
	 * neighboring pixels.
	 */
	const devices = new Map<string, Device>();
	for (const t of opts.targets) {
		const port = t.port ?? SACN_PORT;
		const key = `${t.host ?? 'multicast'}:${port}:${t.universe}`;
		let device = devices.get(key);
		if (!device) {
			device = {
				host: t.host,
				port,
				firstUniverse: t.universe,
				slices: [],
				buffer: new Uint8Array(0),
				pixels: 0
			};
			devices.set(key, device);
		}
		const at = t.deviceFirstLed ?? 0;
		device.slices.push({ at, from: t.firstLed, length: t.ledCount });
		device.pixels = Math.max(device.pixels, at + t.ledCount);
	}
	for (const device of devices.values()) {
		device.buffer = new Uint8Array(device.pixels * 3);
	}

	/** Per universe, not per source: E1.31 receivers detect loss on a universe's own counter. */
	const sequence = new Map<number, number>();

	return {
		kind: 'sacn',

		async open() {
			socket = createSocket({ type: 'udp4', reuseAddr: true });
			socket.unref();
			await new Promise<void>((resolve, reject) => {
				socket!.once('error', reject);
				socket!.bind(() => {
					socket!.off('error', reject);
					// Default TTL 1 keeps multicast on the local segment, which is where the rig is.
					try {
						socket!.setMulticastTTL(1);
					} catch {
						// Not fatal: unicast targets never need it.
					}
					resolve();
				});
			});
		},

		send(frame: LedFrame) {
			if (!socket) {
				stats.framesDropped++;
				return;
			}

			for (const device of devices.values()) {
				for (const slice of device.slices) {
					device.buffer.set(
						frame.rgb.subarray(slice.from * 3, (slice.from + slice.length) * 3),
						slice.at * 3
					);
				}

				for (let done = 0; done < device.pixels; done += SACN_PIXELS_PER_UNIVERSE) {
					const pixels = Math.min(SACN_PIXELS_PER_UNIVERSE, device.pixels - done);
					const channels = pixels * 3;
					const universe = device.firstUniverse + done / SACN_PIXELS_PER_UNIVERSE;
					const total = HEADER + channels;

					// A fresh buffer per packet: dgram.send is asynchronous and does not copy, so a
					// reused one is overwritten by the next universe before the kernel reads it.
					const packet = Buffer.alloc(total);

					// Root layer.
					packet.writeUInt16BE(0x0010, 0);
					packet.write(ACN_ID, 4, 'ascii');
					packet.writeUInt16BE(0x7000 | (total - 16), 16);
					packet.writeUInt32BE(VECTOR_ROOT_E131_DATA, 18);
					cid.copy(packet, 22);

					// Framing layer.
					packet.writeUInt16BE(0x7000 | (total - 38), 38);
					packet.writeUInt32BE(VECTOR_E131_DATA_PACKET, 40);
					sourceName.copy(packet, 44);
					packet[108] = priority;
					const seq = ((sequence.get(universe) ?? 0) + 1) & 0xff;
					sequence.set(universe, seq);
					packet[111] = seq;
					packet.writeUInt16BE(universe, 113);

					// DMP layer, then the start code and the channels themselves.
					packet.writeUInt16BE(0x7000 | (total - 115), 115);
					packet[117] = VECTOR_DMP_SET_PROPERTY;
					packet[118] = ADDRESS_DATA_TYPE;
					packet.writeUInt16BE(0x0001, 121);
					packet.writeUInt16BE(channels + 1, 123);
					packet.set(device.buffer.subarray(done * 3, done * 3 + channels), HEADER);

					const host = device.host ?? sacnMulticastHost(universe);
					try {
						socket.send(packet, device.port, host);
						stats.bytesSent += total;
					} catch (err) {
						stats.lastError = (err as Error).message;
					}
				}
			}

			stats.framesSent++;
		},

		async close() {
			const s = socket;
			socket = null;
			if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
		},

		stats() {
			return { ...stats };
		}
	};
}
