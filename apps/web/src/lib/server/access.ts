import type { RequestEvent } from '@sveltejs/kit';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Host control is loopback-only because the server binds the LAN for token-limited guest
 * access.
 */
export function isLocal(event: RequestEvent): boolean {
	try {
		return LOOPBACK.has(event.getClientAddress());
	} catch {
		// No address is available for a prerender or a synthetic request; treat it as remote.
		return false;
	}
}
