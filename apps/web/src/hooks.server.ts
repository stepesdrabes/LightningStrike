import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { crossSite, guestAllowed, isHostPage, isLocal } from '$lib/server/access.ts';
import { boot } from '$lib/server/output.ts';

/** The room that plays comes up with the server, so it can light itself before any page opens. */
export const init: ServerInit = async () => {
	await boot();
};

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The server binds the LAN so guests can reach their page. Every API route is the host's unless
 * it is one of the few a guest's phone calls, so a new route is private without remembering to
 * make it so.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const route = event.route.id;
	const method = event.request.method;

	if (route?.startsWith('/api/')) {
		if (!READS.has(method) && crossSite(event.request)) {
			return new Response('refused a request sent from another site', { status: 403 });
		}
		if (!guestAllowed(route, method) && !isLocal(event)) {
			return new Response('only the machine running the show can do that', { status: 403 });
		}
	} else if (route !== null && isHostPage(route) && !isLocal(event)) {
		redirect(303, '/guest');
	}

	return resolve(event);
};
