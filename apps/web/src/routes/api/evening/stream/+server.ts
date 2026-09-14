import { error } from '@sveltejs/kit';
import { isLocal } from '$lib/server/access.ts';
import { eventStream } from '$lib/server/eventStream.ts';
import { evening } from '$lib/server/evening/store.ts';
import type { EveningView } from '$lib/evening/view.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the evening belongs to the machine running it');
	return eventStream<EveningView>(event.request, 'evening', async (send, onClose) => {
		onClose(evening.subscribe(send));
		await evening.ready();
		send(evening.view());
	});
};
