import { error, json } from '@sveltejs/kit';
import { isLocal } from '$lib/server/access.ts';
import { evening } from '$lib/server/evening/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the evening belongs to the machine running it');
	await evening.ready();
	return json(evening.view());
};

interface Body {
	action:
		| 'open'
		| 'close'
		| 'reload'
		| 'start'
		| 'rehearse'
		| 'go'
		| 'holdAfter'
		| 'skip'
		| 'jump'
		| 'seek'
		| 'bail'
		| 'end'
		| 'restore'
		| 'prepare'
		| 'progress'
		| 'advance';
	file?: string;
	key?: string;
	direction?: number;
	time?: number;
	position?: number;
	playing?: boolean;
}

export const POST: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the evening belongs to the machine running it');
	const body = (await event.request.json()) as Body;
	try {
		switch (body.action) {
			case 'open':
				if (!body.file?.trim()) error(400, 'file required');
				await evening.open(body.file);
				break;
			case 'close':
				await evening.close();
				break;
			case 'reload':
				await evening.reload();
				break;
			case 'start':
				await evening.start('running');
				break;
			case 'rehearse':
				await evening.start('rehearsal');
				break;
			case 'go':
				await evening.go();
				break;
			case 'holdAfter':
				await evening.holdAfter();
				break;
			case 'skip':
				await evening.skip(body.direction === -1 ? -1 : 1);
				break;
			case 'jump':
				if (!body.key) error(400, 'key required');
				await evening.jump(body.key);
				break;
			case 'seek':
				if (typeof body.time !== 'number' || !Number.isFinite(body.time)) error(400, 'time required');
				await evening.seek(body.time);
				break;
			case 'bail':
				await evening.bail();
				break;
			case 'end':
				await evening.end();
				break;
			case 'restore':
				await evening.restoreQueue();
				break;
			case 'prepare':
				void evening.prepareAll().catch(() => {});
				break;
			case 'progress':
				if (!body.key || typeof body.position !== 'number') error(400, 'key and position required');
				evening.progress(body.key, body.position, body.playing ?? false);
				return json({ ok: true });
			case 'advance':
				if (!body.key) error(400, 'key required');
				await evening.advance(body.key);
				break;
			default:
				error(400, 'unknown action');
		}
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(409, (e as Error).message);
	}
	return json(evening.view());
};
