import { error, json } from '@sveltejs/kit';
import { canGuestRemove, type NewItem } from '$lib/queueModel.ts';
import { queue } from '$lib/server/queueStore.ts';
import { enrichFromLibrary, fromRequest } from '$lib/server/queueAdd.ts';
import { autopilot } from '$lib/server/autopilot.ts';
import { runner } from '$lib/server/ingestRunner.ts';
import { room } from '$lib/server/room.ts';
import type { RequestHandler } from './$types';

/**
 * The guest API implements only adding tracks and removing owned rows; host controls stay
 * separate.
 */
interface Body {
	token?: string;
	name?: string;
	action: 'join' | 'add' | 'remove';
	item?: NewItem;
	key?: string;
}

/** Enough to tell two people apart on a screen, short enough to fit a queue row. */
const NAME_MAX = 24;

function cleanName(name: string | undefined): string {
	return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Body;

	if (!(await room.accepts(body.token))) {
		error(403, 'that code is no longer valid; scan the QR again');
	}

	const name = cleanName(body.name);
	if (!name) error(400, 'a name is required');

	if (body.action === 'join') {
		return json({ ok: true, name });
	}

	if (body.action === 'add') {
		const item = body.item;
		if (!item?.source?.trim()) error(400, 'nothing to add');
		const now = await queue.ready();
		const from = Math.max(0, now.items.findIndex((i) => i.key === now.currentKey));
		if (item.trackId && now.items.slice(from).some((i) => i.trackId === item.trackId)) {
			error(409, 'That one is already coming up.');
		}

		const state = await queue.add(await enrichFromLibrary([fromRequest(item, name)]));
		autopilot.handAdded();
		void runner.pump();
		return json(state);
	}

	if (body.action === 'remove') {
		if (!body.key) error(400, 'key required');
		const state = await queue.ready();
		if (!canGuestRemove(state, body.key, name)) {
			error(403, 'you can only take back something you added that is not playing yet');
		}
		return json(await queue.remove(body.key));
	}

	error(400, 'unknown action');
};
