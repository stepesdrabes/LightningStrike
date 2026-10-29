import { error, json } from '@sveltejs/kit';
import { isLocal } from '$lib/server/access.ts';
import { reveal, systemInfo } from '$lib/server/system.ts';
import type { RequestHandler } from './$types';

/** Folders, tools and versions for the settings; loopback only, as the paths are the machine's. */
export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'settings belong to the machine running the show');
	return json(await systemInfo());
};

/** `{ reveal: 'cache' | 'models' }` opens that folder in the file manager. */
export const POST: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'settings belong to the machine running the show');
	const body = (await event.request.json()) as { reveal?: unknown };
	if (body.reveal !== 'cache' && body.reveal !== 'models') error(400, 'reveal cache or models');
	reveal(body.reveal);
	return new Response(null, { status: 204 });
};
