import { eventStream } from '$lib/server/eventStream.ts';
import { evening } from '$lib/server/evening/store.ts';
import type { EveningView } from '$lib/evening/view.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) =>
	eventStream<EveningView>(request, 'evening', async (send, onClose) => {
		onClose(evening.subscribe(send));
		await evening.ready();
		send(evening.view());
	});
