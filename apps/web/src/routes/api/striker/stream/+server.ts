import { error } from '@sveltejs/kit';
import { isLocal } from '$lib/server/access.ts';
import { eventStream } from '$lib/server/eventStream.ts';
import { strikerLive, type StrikerEvent } from '$lib/server/strikerLive.ts';
import type { RequestHandler } from './$types';

/** Each song as Striker 2.0 prepares it, chunk by chunk, for the model view. */
export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the model view belongs to the machine running the show');
	return eventStream<StrikerEvent>(event.request, 'striker', (send, onClose) => {
		onClose(strikerLive.subscribe(send));
	});
};
