/**
 * Browsers cannot discover via UDP or mDNS. Probe known names, then sweep the subnet learned
 * from the page origin or a board's reported IP.
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

function infoUrl(host: string): string {
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

interface DiscoverOptions {
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

/** Probe known and remembered hosts before sweeping for sibling boards. */
export async function discover(opts: DiscoverOptions): Promise<Found[]> {
	const { net, origin, remembered = [], onFound, onSweeping, signal } = opts;
	const found = new Map<string, Found>();
	const seenNames = new Set<string>();

	const keep = (hit: Found | null): void => {
		// Deduplicate boards reachable by both address and name.
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

	// Prefer the origin IP, then a responding board, then remembered DHCP addresses for the subnet.
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
