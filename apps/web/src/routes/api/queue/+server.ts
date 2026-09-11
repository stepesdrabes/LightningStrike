import { error, json } from '@sveltejs/kit';
import { markGridTrusted } from '@mv/analysis';
import type { NewItem, QueueState } from '$lib/queueModel.ts';
import { isLocal } from '$lib/server/access.ts';
import { queue } from '$lib/server/queueStore.ts';
import { enrichFromLibrary, fromRequest } from '$lib/server/queueAdd.ts';
import { autopilot } from '$lib/server/autopilot.ts';
import { runner } from '$lib/server/ingestRunner.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await queue.ready());

interface Body {
	action:
		| 'add'
		| 'remove'
		| 'move'
		| 'playNext'
		| 'jump'
		| 'next'
		| 'prev'
		| 'clear'
		| 'retry'
		| 'runShow';
	items?: NewItem[];
	key?: string;
	to?: number;
	keepCurrent?: boolean;
}

export const POST: RequestHandler = async (event) => {
	// Guests reach the queue through /api/guest, which can only add and take back their own.
	if (!isLocal(event)) error(403, 'use the guest page to add to this queue');

	const body = (await event.request.json()) as Body;
	let state: QueueState;

	switch (body.action) {
		case 'add': {
			const items = (body.items ?? [])
				.filter((i) => i.source?.trim())
				.map((i) => fromRequest(i));
			if (items.length === 0) error(400, 'nothing to add');
			state = await queue.add(await enrichFromLibrary(items));
			// Somebody is steering, so the radio's ceilings start again.
			autopilot.handAdded();
			break;
		}
		case 'remove':
			if (!body.key) error(400, 'key required');
			state = await queue.remove(body.key);
			break;
		case 'move':
			if (!body.key || body.to === undefined) error(400, 'key and to required');
			state = await queue.move(body.key, body.to);
			break;
		case 'playNext':
			if (!body.key) error(400, 'key required');
			state = await queue.playNext(body.key);
			break;
		case 'jump':
			if (!body.key) error(400, 'key required');
			state = await queue.jump(body.key);
			break;
		case 'next':
			state = await queue.step(1);
			break;
		case 'prev':
			state = await queue.step(-1);
			break;
		case 'clear':
			state = await queue.clear(body.keepCurrent ?? true);
			break;
		case 'retry':
			if (!body.key) error(400, 'key required');
			await runner.retry(body.key);
			state = queue.snapshot;
			break;
		case 'runShow': {
			// Persist grid-trust overrides in track metadata as well as the queue row.
			if (!body.key) error(400, 'key required');
			const item = queue.snapshot.items.find((i) => i.key === body.key);
			if (!item) error(404, 'no such row');
			if (item.trackId) await markGridTrusted(item.trackId);
			state = queue.patch(body.key, { loungeOnly: false });
			break;
		}
		default:
			error(400, 'unknown action');
	}

	// Whatever just changed may have changed what is worth preparing. The runner decides.
	void runner.pump();
	return json(state);
};
