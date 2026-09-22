import { error, json } from '@sveltejs/kit';
import { watchUrl } from '@mv/analysis';
import { autopilot } from '$lib/server/autopilot.ts';
import type { RequestHandler } from './$types';

const WATCH_ID = /^[A-Za-z0-9_-]{11}$/;

export const GET: RequestHandler = async ({ url }) => {
	const seed = url.searchParams.get('seed');
	const limit = Math.max(1, Math.min(30, Number(url.searchParams.get('limit') ?? 12)));
	// Validate outside the try so request errors are not reclassified as upstream failures.
	if (seed !== null && !WATCH_ID.test(seed)) error(400, 'not a track id');

	try {
		// A seed asks what follows one track; without one, the queue as a whole is the seed.
		const songs = seed ? await autopilot.around(seed, limit) : await autopilot.ahead(limit);
		return json({ results: songs.map((s) => ({ ...s, webpageUrl: watchUrl(s.id) })) });
	} catch (e) {
		error(502, (e as Error).message);
	}
};
