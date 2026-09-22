import { error, json } from '@sveltejs/kit';
import { invite, lanAddress } from '$lib/server/invite.ts';
import type { RequestHandler } from './$types';

/** Everything the desktop needs to draw a QR somebody can scan. */
async function snapshot(port: string) {
	const address = lanAddress();
	const token = await invite.currentToken();
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
	const body = (await event.request.json()) as { action: 'rotate' };
	if (body.action !== 'rotate') error(400, 'unknown action');

	await invite.rotate();
	const port = event.url.port || new URL(event.request.url).port || '5180';
	return json(await snapshot(port));
};
