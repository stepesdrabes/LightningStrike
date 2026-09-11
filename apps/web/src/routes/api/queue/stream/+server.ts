import { queue } from '$lib/server/queueStore.ts';
import { runner } from '$lib/server/ingestRunner.ts';
import { eventStream } from '$lib/server/eventStream.ts';
import type { QueueState } from '$lib/queueModel.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) =>
	eventStream<QueueState>(request, 'queue', async (send, onClose) => {
		onClose(queue.subscribe(send));
		send(await queue.ready());
		void runner.pump();
	});
