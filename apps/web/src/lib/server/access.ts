import type { RequestEvent } from '@sveltejs/kit';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** What a guest's phone may call. Every other route belongs to the machine running the show. */
const GUEST_ROUTES: ReadonlyMap<string, readonly string[]> = new Map([
	['/api/guest', ['POST']],
	['/api/queue', ['GET']],
	['/api/queue/stream', ['GET']],
	['/api/search', ['GET']]
]);

/** Host pages a guest is sent away from, to the page made for them. */
const HOST_PAGES = new Set(['/', '/drums']);

/**
 * Loopback by socket and by Host header. A page in the host's own browser can rebind its domain
 * to 127.0.0.1, but its requests still name that domain as their host.
 */
export function isLocal(event: RequestEvent): boolean {
	let address: string;
	try {
		address = event.getClientAddress();
	} catch {
		// No address is available for a prerender or a synthetic request; treat it as remote.
		return false;
	}
	return LOOPBACK.has(address) && LOOPBACK_NAMES.has(hostname(event.request.headers.get('host')));
}

function hostname(host: string | null): string {
	if (!host) return '';
	const bracket = host.indexOf(']');
	if (host.startsWith('[') && bracket > 0) return host.slice(0, bracket + 1);
	return host.split(':')[0].toLowerCase();
}

export function guestAllowed(routeId: string, method: string): boolean {
	return GUEST_ROUTES.get(routeId)?.includes(method === 'HEAD' ? 'GET' : method) ?? false;
}

export function isHostPage(routeId: string): boolean {
	return HOST_PAGES.has(routeId);
}

/**
 * A browser names the page that sent a request. A write from any other site is refused, since
 * a plain-text POST reaches the server without a preflight.
 */
export function crossSite(request: Request): boolean {
	const origin = request.headers.get('origin');
	if (origin === null) return false;
	try {
		return new URL(origin).host !== request.headers.get('host');
	} catch {
		return true;
	}
}
