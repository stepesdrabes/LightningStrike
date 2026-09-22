import type { RoomsState } from '$lib/rooms.ts';
import { eventStream } from '$lib/server/eventStream.ts';
import { rooms } from '$lib/server/rooms.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) =>
	eventStream<RoomsState>(request, 'rooms', async (send, onClose) => {
		onClose(rooms.subscribe(send));
		send(await rooms.ready());
	});
