import type { OutputStatus } from '$lib/controllers.ts';
import { controllers } from '$lib/server/controllers.ts';
import { eventStream } from '$lib/server/eventStream.ts';
import { output } from '$lib/server/output.ts';
import type { RequestHandler } from './$types';

/** Whether the room plays, and how each of its controllers is doing, while anyone looks. */
export const GET: RequestHandler = async ({ request }) =>
	eventStream<OutputStatus>(request, 'output', (send, onClose) => {
		const publish = () =>
			send({ running: output.running, room: output.status.room ?? '', controllers: controllers.statuses });
		onClose(controllers.subscribe(publish));
		onClose(output.subscribe(publish));
		onClose(controllers.watch());
		publish();
	});
