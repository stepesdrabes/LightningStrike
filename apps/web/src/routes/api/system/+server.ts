import { error, json } from '@sveltejs/kit';
import { reveal, systemInfo } from '$lib/server/system.ts';
import type { RequestHandler } from './$types';

/** Folders, tools and versions for the settings. */
export const GET: RequestHandler = async () => json(await systemInfo());

/** `{ reveal: 'cache' | 'models' }` opens that folder in the file manager. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { reveal?: unknown };
	if (body.reveal !== 'cache' && body.reveal !== 'models') error(400, 'reveal cache or models');
	reveal(body.reveal);
	return new Response(null, { status: 204 });
};
