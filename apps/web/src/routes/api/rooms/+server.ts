import { error, json } from '@sveltejs/kit';
import { emptyRoom, frameRoom, freshId, readRoom, type Room } from '$lib/rooms.ts';
import { rooms } from '$lib/server/rooms.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await rooms.ready());

/**
 * `create` starts a room empty, from the Frame, or as a copy of another; `import` takes a room
 * someone exported, under an id of its own here.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		action: 'create' | 'activate' | 'import';
		name?: string;
		from?: string;
		id?: string;
		room?: unknown;
	};
	const state = await rooms.ready();
	const taken = state.rooms.map((r) => r.id);

	if (body.action === 'activate') {
		if (!body.id || !taken.includes(body.id)) error(404, 'no such room');
		return json(await rooms.activate(body.id));
	}

	let room: Room;
	if (body.action === 'import') {
		const read = readRoom(body.room);
		if ('problems' in read) error(400, read.problems.join(' '));
		room = { ...read.room, id: freshId(read.room.name, taken) };
	} else if (body.action === 'create') {
		const name = (body.name ?? '').trim().slice(0, 60) || 'New room';
		const id = freshId(name, taken);
		const copy = state.rooms.find((r) => r.id === body.from);
		room = copy
			? { ...structuredClone(copy), id, name }
			: body.from === 'frame'
				? frameRoom(id, name)
				: emptyRoom(id, name);
	} else {
		error(400, 'unknown action');
	}
	await rooms.save(room);
	return json(await rooms.activate(room.id));
};
