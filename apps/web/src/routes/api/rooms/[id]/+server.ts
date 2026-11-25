import { error, json } from '@sveltejs/kit';
import { readRoom } from '$lib/rooms.ts';
import { rooms } from '$lib/server/rooms.ts';
import type { RequestHandler } from './$types';

/** Save a room as the setup edits it; the one that plays follows at once. */
export const PUT: RequestHandler = async ({ params, request }) => {
	const read = readRoom(await request.json());
	if ('problems' in read) error(400, read.problems.join(' '));
	if (read.room.id !== params.id) error(400, 'the room names another id');
	const state = await rooms.ready();
	if (!state.rooms.some((r) => r.id === params.id)) error(404, 'no such room');
	return json(await rooms.save(read.room));
};

export const DELETE: RequestHandler = async ({ params }) => {
	const state = await rooms.ready();
	if (!state.rooms.some((r) => r.id === params.id)) error(404, 'no such room');
	if (state.rooms.length === 1) error(409, 'the last room stays');
	return json(await rooms.remove(params.id));
};
