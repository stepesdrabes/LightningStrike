/**
 * Finding the lights without being told where they are.
 *
 * The board already answers a UDP broadcast (`?room-node`, `firmware/wire/src/hello.rs`) and
 * that is what the desktop app uses - but a browser cannot send UDP, and it cannot browse mDNS
 * service types either. Two things it can do:
 *
 * 1. Resolve a name it already knows. The hostnames are compiled into the firmware, so
 *    `room-bounce.local` is a fixed address rather than a discovered one.
 * 2. Knock on every address on its own subnet and see what answers `/api/info` with our shape.
 *
 * The second needs a subnet, and a browser cannot learn its own - mDNS-obfuscated ICE candidates
 * closed that door years ago. But it can read where the page came from, and this app is served
 * from the board, so `location.hostname` is a light's address. That is the whole trick: the
 * first light found is what locates the rest.
 */

import { pooled, type Net } from './net.ts';
import { KNOWN_HOSTS, parseInfo, type DeviceInfo } from './protocol.ts';

/** A single board answered on a single address. */
export interface Found {
	host: string;
	info: DeviceInfo;
}

/** Long enough for a busy board to finish the request it is already serving. */
const DIRECT_TIMEOUT_MS = 2500;
/** Short: a sweep is 254 knocks and most of them are on nothing at all. */
const SWEEP_TIMEOUT_MS = 1200;
/** Phones throttle hard above this, and the sweep gets slower rather than faster. */
const SWEEP_CONCURRENCY = 24;

export function infoUrl(host: string): string {
	return `http://${host}/api/info`;
}

/** `192.168.0.106` -> `192.168.0`, and null for anything that is not a dotted quad. */
export function subnetOf(host: string): string | null {
	const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})$/.exec(host.trim());
	if (!m) return null;
	const prefix = m[1] as string;
	const parts = [...prefix.split('.'), m[2] as string].map(Number);
	return parts.every((n) => n >= 0 && n <= 255) ? prefix : null;
}

/** Every host on a /24 except the one we already have, gateway and broadcast included. */
export function hostsInSubnet(prefix: string, skip: ReadonlySet<string> = new Set()): string[] {
	const out: string[] = [];
	for (let i = 1; i <= 254; i++) {
		const host = `${prefix}.${i}`;
		if (!skip.has(host)) out.push(host);
	}
	return out;
}

export async function probe(net: Net, host: string, timeoutMs: number): Promise<Found | null> {
	const info = parseInfo(await net.get(infoUrl(host), timeoutMs));
	return info ? { host, info } : null;
}

export interface DiscoverOptions {
	net: Net;
	/** Where the page itself came from - an address here is what makes a sweep possible. */
	origin: string;
	/** Addresses that worked last time, tried before anything is scanned. */
	remembered?: readonly string[];
	/** Called as each board answers, so the interface fills in rather than waiting. */
	onFound: (found: Found) => void;
	/** Set once the direct attempts are done and a sweep is actually running. */
	onSweeping?: (sweeping: boolean) => void;
	signal?: AbortSignal;
}

/**
 * Known names and remembered addresses first, then the subnet.
 *
 * The fast path is the common one: the app is served by a board, so probing its own origin
 * finds a light in a single round trip and the sweep only ever runs to find its siblings.
 */
export async function discover(opts: DiscoverOptions): Promise<Found[]> {
	const { net, origin, remembered = [], onFound, onSweeping, signal } = opts;
	const found = new Map<string, Found>();
	const seenNames = new Set<string>();

	const keep = (hit: Found | null): void => {
		// One board answers on both its address and its name, and a second entry for it would
		// show up as a second light in the switcher.
		if (!hit || found.has(hit.host) || seenNames.has(hit.info.name)) return;
		found.set(hit.host, hit);
		seenNames.add(hit.info.name);
		onFound(hit);
	};

	const direct = [origin, ...remembered, ...KNOWN_HOSTS.map((h) => `${h}.local`), ...KNOWN_HOSTS]
		.map((h) => h.trim())
		.filter((h, i, all) => h !== '' && all.indexOf(h) === i);

	await Promise.all(direct.map(async (host) => keep(await probe(net, host, DIRECT_TIMEOUT_MS))));
	if (signal?.aborted) return [...found.values()];

	// Three ways to learn the subnet, in descending order of certainty. The origin is only an
	// address when the page was opened at one rather than at a name; a board that answered
	// reports its own; and a remembered address is worth reading even when nothing answered on
	// it, because a board that moved on DHCP moved within the same network.
	const prefix =
		subnetOf(origin) ??
		[...found.values()].map((f) => subnetOf(f.info.ip)).find((p) => p != null) ??
		remembered.map(subnetOf).find((p) => p != null);
	if (!prefix) return [...found.values()];

	onSweeping?.(true);
	try {
		const targets = hostsInSubnet(prefix, new Set(found.keys()));
		await pooled(targets, SWEEP_CONCURRENCY, async (host) => {
			if (signal?.aborted) return;
			keep(await probe(net, host, SWEEP_TIMEOUT_MS));
		});
	} finally {
		onSweeping?.(false);
	}
	return [...found.values()];
}
