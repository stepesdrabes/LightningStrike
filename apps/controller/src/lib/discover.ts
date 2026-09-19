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

export async function probe(
	net: Net,
	host: string,
	timeoutMs: number,
	signal?: AbortSignal
): Promise<Found | null> {
	const info = parseInfo(await net.get(infoUrl(host), timeoutMs, signal));
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
	const here = subnetOf(origin);

	/**
	 * Address the board by the address it reports, once that address is on the subnet this page
	 * was served from. Polling a name waits on mDNS every time, and a name is also what a later
	 * sweep cannot read a subnet from. A board reporting an address somewhere else is reached
	 * only by the name that already worked.
	 */
	const keep = (hit: Found | null): void => {
		if (!hit || signal?.aborted) return;
		const host = here !== null && subnetOf(hit.info.ip) === here ? hit.info.ip : hit.host;
		// Deduplicate boards reachable by both address and name.
		if (found.has(host) || seenNames.has(hit.info.name)) return;
		const at: Found = { host, info: hit.info };
		found.set(host, at);
		seenNames.add(hit.info.name);
		onFound(at);
	};

	// The origin is often a remembered address as well, and asking one board the same question
	// twice at once is what spends the listeners it has.
	const tried = new Set<string>();
	const wave = async (hosts: readonly string[]): Promise<void> => {
		const fresh: string[] = [];
		for (const raw of hosts) {
			const host = raw.trim();
			if (host === '' || tried.has(host) || seenNames.has(host.replace(/\.local$/, ''))) continue;
			tried.add(host);
			fresh.push(host);
		}
		await Promise.all(
			fresh.map(async (h) => {
				try {
					keep(await probe(net, h, DIRECT_TIMEOUT_MS, signal));
				} catch {
					// One name failing must not abandon the others, nor the sweep running beside them.
				}
			})
		);
	};

	/**
	 * One wave per way of naming a board, never all of them at once: the three names for one
	 * board would otherwise arrive together and spend every listener it has, and the alias that
	 * got refused would look like a board that is not there.
	 */
	const byName = async (): Promise<void> => {
		await wave(KNOWN_HOSTS.map((h) => `${h}.local`));
		if (!signal?.aborted) await wave([...KNOWN_HOSTS]);
	};

	// Addresses first: they answer at once where a name that resolves to nothing costs the whole
	// timeout, and one of them is usually all the subnet the sweep needs.
	await wave([origin, ...remembered]);
	if (signal?.aborted) return [...found.values()];

	// Prefer the origin IP, then a responding board, then remembered DHCP addresses for the subnet.
	const prefix =
		subnetOf(origin) ??
		[...found.values()].map((f) => subnetOf(f.info.ip)).find((p) => p != null) ??
		remembered.map(subnetOf).find((p) => p != null);
	if (!prefix) {
		await byName();
		return [...found.values()];
	}

	onSweeping?.(true);
	try {
		// The names run alongside the sweep rather than ahead of it: they address different
		// boards, and waiting out three name lookups first is seconds of spinner for nothing.
		await Promise.all([
			byName(),
			pooled(
				outwardFrom(origin, hostsInSubnet(prefix, new Set(found.keys()))),
				SWEEP_CONCURRENCY,
				async (host) => {
					// A board already found, by whatever name, is still at its own address.
					// Checked here rather than up front because a name can answer mid-sweep.
					const already = [...found.values()].some((f) => f.info.ip === host);
					if (!already) keep(await probe(net, host, SWEEP_TIMEOUT_MS, signal));
				},
				signal
			)
		]);
	} finally {
		if (!signal?.aborted) onSweeping?.(false);
	}
	return [...found.values()];
}

/**
 * Sweep outward from whatever the page was served by. A board and the machine serving this page
 * come from the same DHCP pool far more often than not, so nearest-first finds it seconds sooner
 * than counting from .1; where the origin is a name there is no centre and the order is the
 * range's own.
 */
export function outwardFrom(origin: string, hosts: readonly string[]): string[] {
	const centre = Number(/\.(\d{1,3})$/.exec(origin.trim())?.[1]);
	if (!Number.isFinite(centre)) return [...hosts];
	const last = (h: string) => Number(h.slice(h.lastIndexOf('.') + 1));
	return [...hosts].sort((a, b) => Math.abs(last(a) - centre) - Math.abs(last(b) - centre));
}
