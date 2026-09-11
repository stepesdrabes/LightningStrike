import { error, json } from '@sveltejs/kit';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, isValidId } from '@mv/analysis';
import { currentItem } from '$lib/queueModel.ts';
import { queue } from '$lib/server/queueStore.ts';
import { isLocal } from '$lib/server/access.ts';
import type { RequestHandler } from './$types';

/** Cache deletion is loopback-only because guests do not own downloaded or authored artifacts. */
export const DELETE: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the cache belongs to the machine running the show');

	const id = event.params.id;
	if (!isValidId(id)) error(400, 'valid track id required');

	// Use resolved queue IDs to protect tracks still needed for playback.
	const state = await queue.ready();
	if (currentItem(state)?.trackId === id) error(409, 'that track is playing');
	if (state.items.some((i) => i.trackId === id)) error(409, 'that track is in the queue');

	// Delete artifacts by track prefix so future ingest sidecars are included.
	const files = await readdir(CACHE_DIR);
	const mine = files.filter((f) => f === id || f.startsWith(`${id}.`));
	await Promise.all(mine.map((f) => rm(join(CACHE_DIR, f), { force: true })));

	return json({ id, removed: mine.length });
};
