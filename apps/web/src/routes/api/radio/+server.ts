import { error, json } from '@sveltejs/kit';
import { watchUrl } from '@mv/analysis';
import { isLocal } from '$lib/server/access.ts';
import { autopilot } from '$lib/server/autopilot.ts';
import type { RequestHandler } from './$types';

/** Radio suggestions are host-only; guest search uses /api/search. */
const WATCH_ID = /^[A-Za-z0-9_-]{11}$/;

export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the radio belongs to the machine running the show');

	const seed = event.url.searchParams.get('seed');
	const limit = Math.max(1, Math.min(30, Number(event.url.searchParams.get('limit') ?? 12)));
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
