import { error, json } from '@sveltejs/kit';
import { isLocal } from '$lib/server/access.ts';
import { lanAddress, room } from '$lib/server/room.ts';
import type { RequestHandler } from './$types';

/** Everything the desktop needs to draw a QR somebody can scan. */
async function snapshot(port: string) {
	const address = lanAddress();
	const token = await room.currentToken();
	return {
		token,
		address,
		// Without a LAN address, return null; localhost QR codes cannot reach this host from phones.
		url: address ? `http://${address}:${port}/join?t=${token}` : null
	};
}

export const GET: RequestHandler = async ({ url, request }) => {
	const port = url.port || new URL(request.url).port || '5180';
	return json(await snapshot(port));
};

export const POST: RequestHandler = async (event) => {
	// Rotating is how an evening's access is ended, so it belongs to whoever is running it.
	if (!isLocal(event)) error(403, 'only the machine running the show can rotate the code');

	const body = (await event.request.json()) as { action: 'rotate' };
	if (body.action !== 'rotate') error(400, 'unknown action');

	await room.rotate();
	const port = event.url.port || new URL(event.request.url).port || '5180';
	return json(await snapshot(port));
};
