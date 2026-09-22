import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import makeMdns from 'multicast-dns';
import { ARTNET_PORT, artPoll, parseArtPollReply } from '@mv/transport';
import { parseIdentity } from '$lib/hardware.ts';
import type { Found } from '$lib/controllers.ts';
import { wledInfo } from './controllers.ts';

/** Long enough for a board across a busy Wi-Fi to answer, short enough to wait for. */
const LISTEN_MS = 2200;
const DDP_PORT = 4048;
const WLED_SERVICE = '_wled._tcp.local';
/** WLED announces itself here every half minute or so, which catches one mDNS missed. */
const WLED_NOTIFY_PORT = 65506;

interface Lan {
	address: string;
	/** The rest of the /24 around it, which is as far as a sweep goes. */
	neighbours: string[];
	broadcast: string;
}

export function lans(): Lan[] {
	const out: Lan[] = [];
	for (const entry of Object.values(networkInterfaces()).flat()) {
		if (!entry || entry.family !== 'IPv4' || entry.internal) continue;
		const parts = entry.address.split('.').map(Number);
		const mask = entry.netmask.split('.').map(Number);
		const prefix = parts.slice(0, 3).join('.');
		out.push({
			address: entry.address,
			neighbours: Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`).filter((a) => a !== entry.address),
			broadcast: parts.map((p, i) => (p & mask[i]) | (~mask[i] & 255)).join('.')
		});
	}
	return out;
}

/** Every controller that answers within a couple of seconds, each once however it was heard. */
export async function discover(): Promise<Found[]> {
	const networks = lans();
	const [boards, wleds, nodes] = await Promise.all([findBoards(networks), findWleds(), findArtnet(networks)]);
	const found = new Map<string, Found>();
	for (const f of [...boards, ...wleds, ...nodes]) if (!found.has(f.host)) found.set(f.host, f);
	return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findBoards(networks: Lan[]): Promise<Found[]> {
	const hello = Buffer.from('?room-node');
	return listen(
		{},
		(socket) => {
			for (const lan of networks) for (const address of lan.neighbours) socket.send(hello, DDP_PORT, address);
		},
		(buf, from) => {
			const identity = parseIdentity(buf.toString(), from);
			return identity
				? {
						kind: 'lightningstrike',
						host: from,
						name: identity.name,
						pixels: identity.pixels || undefined,
						firmware: identity.firmware
					}
				: null;
		}
	);
}

async function findWleds(): Promise<Found[]> {
	const addresses = new Set<string>();
	const mdns = makeMdns();
	mdns.on('error', () => {});
	mdns.on('response', (response, rinfo) => {
		const records = [...response.answers, ...(response.additionals ?? [])];
		if (records.some((r) => r.name === WLED_SERVICE || r.name.endsWith(`.${WLED_SERVICE}`))) addresses.add(rinfo.address);
	});
	mdns.query({ questions: [{ name: WLED_SERVICE, type: 'PTR' }] });
	const announced = await listen({ port: WLED_NOTIFY_PORT }, () => {}, (buf, from) =>
		buf[0] === 0xff && buf[1] === 0x01 ? from : null
	);
	mdns.destroy();
	for (const address of announced) addresses.add(address);

	const found = await Promise.all(
		[...addresses].map(async (host): Promise<Found | null> => {
			const info = await wledInfo(host);
			if (!info) return null;
			return {
				kind: 'wled',
				host,
				name: info.name,
				mac: info.mac || undefined,
				pixels: info.leds,
				matrix: info.matrix ?? undefined,
				white: info.white,
				firmware: info.version
			};
		})
	);
	return found.filter((f): f is Found => f !== null);
}

function findArtnet(networks: Lan[]): Promise<Found[]> {
	const poll = artPoll();
	return listen(
		{ port: ARTNET_PORT, broadcast: true },
		(socket) => {
			for (const lan of networks) socket.send(poll, ARTNET_PORT, lan.broadcast);
		},
		(buf, from) => {
			const node = parseArtPollReply(buf);
			if (!node || networks.some((n) => n.address === from)) return null;
			return {
				kind: 'artnet',
				host: node.ip || from,
				name: node.name || node.ip,
				mac: node.mac || undefined,
				universe: node.universe
			};
		}
	);
}

/**
 * Bind, send once listening, gather what answers for a while, and close. A socket that cannot
 * bind, such as a port another app holds, simply hears nothing.
 */
function listen<T>(
	options: { port?: number; broadcast?: boolean },
	send: (socket: Socket) => void,
	read: (buf: Buffer, from: string) => T | null
): Promise<T[]> {
	return new Promise((done) => {
		const heard: T[] = [];
		const socket = createSocket({ type: 'udp4', reuseAddr: options.port !== undefined });
		socket.on('error', () => {});
		socket.on('message', (buf, rinfo) => {
			const value = read(buf, rinfo.address);
			if (value !== null) heard.push(value);
		});
		socket.bind(options.port ?? 0, () => {
			try {
				if (options.broadcast) socket.setBroadcast(true);
				send(socket);
			} catch {
				// A network that refuses to send still lets the others answer.
			}
		});
		setTimeout(() => {
			try {
				socket.close();
			} catch {
				// Never bound, so nothing to close.
			}
			done(heard);
		}, LISTEN_MS);
	});
}
