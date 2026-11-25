import { createSocket, type Socket } from 'node:dgram';
import type { LedFrame, LedSink, LedSinkStats } from '@mv/core';

export const ARTNET_PORT = 6454;

/** 170 RGB pixels fill 510 channels, so a pixel never straddles two universes. */
export const ARTNET_PIXELS_PER_UNIVERSE = 170;

const ID = Buffer.from('Art-Net\0', 'ascii');
const OP_POLL = 0x2000;
const OP_POLL_REPLY = 0x2100;
const OP_DMX = 0x5000;
const PROTOCOL_VERSION = 14;
const DMX_HEADER = 18;
const POLL_REPLY_MIN = 207;

interface ArtnetTarget {
	host: string;
	port?: number;
	/** The first 15-bit Port-Address (net, sub-net, universe); the device's pixels run on from it. */
	universe: number;
	/** Pixels this device takes, from the start of every frame it is sent. */
	ledCount: number;
}

/** One ArtDmx per universe, unicast: Art-Net 4 never allows data to be broadcast. */
export function createArtnetSink(opts: { targets: readonly ArtnetTarget[] }): LedSink {
	let socket: Socket | null = null;
	const stats: LedSinkStats = { framesSent: 0, framesDropped: 0, bytesSent: 0 };
	const universes = opts.targets.flatMap((t) =>
		Array.from({ length: Math.ceil(t.ledCount / ARTNET_PIXELS_PER_UNIVERSE) }, (_, k) => ({
			host: t.host,
			port: t.port ?? ARTNET_PORT,
			address: t.universe + k,
			from: k * ARTNET_PIXELS_PER_UNIVERSE,
			pixels: Math.min(ARTNET_PIXELS_PER_UNIVERSE, t.ledCount - k * ARTNET_PIXELS_PER_UNIVERSE),
			sequence: 1
		}))
	);

	return {
		kind: 'artnet',

		async open() {
			socket = createSocket('udp4');
			socket.unref();
			await new Promise<void>((resolve, reject) => {
				socket!.once('error', reject);
				socket!.bind(() => {
					socket!.off('error', reject);
					resolve();
				});
			});
			// A send that fails later, say to a name that no longer resolves, must not end the process.
			socket.on('error', (err) => {
				stats.lastError = err.message;
			});
		},

		send(frame: LedFrame) {
			if (!socket) {
				stats.framesDropped++;
				return;
			}
			for (const u of universes) {
				const length = u.pixels * 3;
				// A fresh packet each time: dgram.send reads it later and does not copy it.
				const packet = dmxPacket(u.address, length, u.sequence);
				u.sequence = u.sequence >= 255 ? 1 : u.sequence + 1;
				packet.set(frame.rgb.subarray(u.from * 3, u.from * 3 + length), DMX_HEADER);
				try {
					socket.send(packet, u.port, u.host);
					stats.bytesSent += packet.length;
				} catch (err) {
					stats.lastError = (err as Error).message;
				}
			}
			stats.framesSent++;
		},

		async close() {
			socket?.close();
			socket = null;
		},

		stats: () => ({ ...stats })
	};
}

/** Channels are padded to an even count, as ArtDmx requires. */
function dmxPacket(address: number, channels: number, sequence: number): Buffer {
	const length = channels + (channels % 2);
	const packet = Buffer.alloc(DMX_HEADER + length);
	ID.copy(packet, 0);
	packet.writeUInt16LE(OP_DMX, 8);
	packet[10] = 0;
	packet[11] = PROTOCOL_VERSION;
	packet[12] = sequence;
	packet[13] = 0;
	packet[14] = address & 0xff;
	packet[15] = (address >> 8) & 0x7f;
	packet.writeUInt16BE(length, 16);
	return packet;
}

/** Asks every node on the network to describe itself. */
export function artPoll(): Buffer {
	const packet = Buffer.alloc(14);
	ID.copy(packet, 0);
	packet.writeUInt16LE(OP_POLL, 8);
	packet[10] = 0;
	packet[11] = PROTOCOL_VERSION;
	return packet;
}

export interface ArtnetNode {
	ip: string;
	name: string;
	/** The Port-Address of its first output. */
	universe: number;
	/** Lowercase hex without separators, or '' when the node does not report one. */
	mac: string;
}

export function parseArtPollReply(packet: Uint8Array): ArtnetNode | null {
	if (packet.length < POLL_REPLY_MIN) return null;
	const buf = Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength);
	if (!buf.subarray(0, 8).equals(ID) || buf.readUInt16LE(8) !== OP_POLL_REPLY) return null;
	const text = (from: number, to: number) => buf.toString('ascii', from, to).replace(/\0.*$/s, '').trim();
	const net = buf[18] & 0x7f;
	const sub = buf[19] & 0x0f;
	const mac = [...buf.subarray(201, 207)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return {
		ip: [...buf.subarray(10, 14)].join('.'),
		name: text(44, 108) || text(26, 44),
		universe: (net << 8) | (sub << 4) | (buf[190] & 0x0f),
		mac: /^0+$/.test(mac) ? '' : mac
	};
}
