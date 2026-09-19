import { createSocket, type Socket } from 'node:dgram';
import type { LedFrame, LedSink, LedSinkStats } from '@mv/core';
import { Packer } from './pack.ts';

export const DDP_PORT = 4048;

// WLED's own receive buffer is 1458 bytes and its sender uses 1440 data bytes. Do not
// raise this: a larger packet is silently dropped, not fragmented.
const MAX_DATA = 1440;

const FLAG_VER1 = 0x40;
const FLAG_PUSH = 0x01;
const TYPE_RGB24 = 0x0b;
// The same pixels packed. The top bit is DDP's customer-defined flag, so a receiver that does
// not know this format cannot mistake it for one it does.
const TYPE_RGB24_PACKED = 0x8b;
const ID_DISPLAY = 1;

export interface DdpTarget {
	host: string;
	port?: number;
	/** Slice of the global frame this device owns. */
	firstLed: number;
	ledCount: number;
	/** Where that slice lands in the device's own buffer. Normally 0. */
	deviceFirstLed?: number;
	/** The board named `pack` in its hello line, so its frames can go out packed. */
	packed?: boolean;
}

interface DdpOptions {
	targets: readonly DdpTarget[];
}

export function createDdpSink(opts: DdpOptions): LedSink {
	let socket: Socket | null = null;
	let seq = 1;
	const stats: LedSinkStats = { framesSent: 0, framesDropped: 0, bytesSent: 0 };

	/**
	 * Only the final packet per host/port carries PUSH, including when wrapping regions split one
	 * device into targets.
	 */
	const deviceKey = (t: DdpTarget) => `${t.host}:${t.port ?? DDP_PORT}`;
	const lastForDevice = new Map<string, number>();
	opts.targets.forEach((t, i) => lastForDevice.set(deviceKey(t), i));

	const widest = Math.max(0, ...opts.targets.map((t) => t.ledCount));
	const packer = opts.targets.some((t) => t.packed) ? new Packer(widest * 3) : null;
	// One frame at a time, so one buffer serves every packed target.
	const packBuffer = new Uint8Array(MAX_DATA);

	return {
		kind: 'ddp',

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
		},

		send(frame: LedFrame) {
			if (!socket) {
				stats.framesDropped++;
				return;
			}

			for (const [index, target] of opts.targets.entries()) {
				const byteStart = target.firstLed * 3;
				const byteLen = target.ledCount * 3;
				const deviceStart = (target.deviceFirstLed ?? 0) * 3;
				const port = target.port ?? DDP_PORT;
				const closesDevice = lastForDevice.get(deviceKey(target)) === index;

				// A packed slice is whole or it is nothing: splitting it would cost the very
				// property that makes it worth sending, that one datagram decodes on its own.
				const packed = packer && target.packed
					? packer.pack(frame.rgb, byteStart, target.ledCount, packBuffer)
					: 0;
				if (packed > 0) {
					const datagram = Buffer.allocUnsafe(10 + packed);
					datagram[0] = FLAG_VER1 | (closesDevice ? FLAG_PUSH : 0);
					datagram[1] = seq;
					datagram[2] = TYPE_RGB24_PACKED;
					datagram[3] = ID_DISPLAY;
					datagram.writeUInt32BE(deviceStart, 4);
					datagram.writeUInt16BE(packed, 8);
					datagram.set(packBuffer.subarray(0, packed), 10);
					try {
						socket.send(datagram, port, target.host);
						stats.bytesSent += 10 + packed;
					} catch (err) {
						stats.lastError = (err as Error).message;
					}
					seq = seq === 15 ? 1 : seq + 1;
					continue;
				}

				for (let sent = 0; sent < byteLen; sent += MAX_DATA) {
					const len = Math.min(MAX_DATA, byteLen - sent);
					const isLast = sent + len >= byteLen && closesDevice;

					// A fresh buffer per packet, not a reused one: dgram.send is asynchronous and
					// does not copy, so a shared buffer gets overwritten by the next iteration
					// before the kernel reads it and every packet ships the last one's header.
					const packet = Buffer.allocUnsafe(10 + len);

					// PUSH only on the final packet. Without it WLED renders on every packet
					// and a 1320-LED frame tears three ways.
					packet[0] = FLAG_VER1 | (isLast ? FLAG_PUSH : 0);
					packet[1] = seq;
					packet[2] = TYPE_RGB24;
					packet[3] = ID_DISPLAY;
					packet.writeUInt32BE(deviceStart + sent, 4);
					packet.writeUInt16BE(len, 8);
					packet.set(frame.rgb.subarray(byteStart + sent, byteStart + sent + len), 10);

					try {
						socket.send(packet, port, target.host);
						stats.bytesSent += 10 + len;
					} catch (err) {
						stats.lastError = (err as Error).message;
					}

					seq = seq === 15 ? 1 : seq + 1;
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
