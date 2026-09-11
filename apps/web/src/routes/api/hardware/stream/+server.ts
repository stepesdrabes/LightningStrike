import { hardware } from '$lib/server/hardware.ts';
import { eventStream } from '$lib/server/eventStream.ts';
import type { HardwareStatus } from '$lib/hardware.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) =>
	eventStream<HardwareStatus[]>(request, 'hardware', (send, onClose) => {
		onClose(hardware.subscribe(send));
		onClose(hardware.watch());
		send(hardware.statuses);
	});
