import { queue } from '$lib/server/queueStore.ts';
import { runner } from '$lib/server/ingestRunner.ts';
import { eventStream } from '$lib/server/eventStream.ts';
import { isLocal } from '$lib/server/access.ts';
import { guestView, type QueueState } from '$lib/queueModel.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const view = isLocal(event) ? (state: QueueState) => state : guestView;
	return eventStream<QueueState>(event.request, 'queue', async (send, onClose) => {
		onClose(queue.subscribe((state) => send(view(state))));
		send(view(await queue.ready()));
		void runner.pump();
	});
};
