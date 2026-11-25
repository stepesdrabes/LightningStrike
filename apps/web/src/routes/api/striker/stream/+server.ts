import { eventStream } from '$lib/server/eventStream.ts';
import { strikerLive, type StrikerEvent } from '$lib/server/strikerLive.ts';
import type { RequestHandler } from './$types';

/** Each song as Striker 2.0 prepares it, chunk by chunk, for the model view. */
export const GET: RequestHandler = async ({ request }) =>
	eventStream<StrikerEvent>(request, 'striker', (send, onClose) => {
		onClose(strikerLive.subscribe(send));
	});
