import { error, json } from '@sveltejs/kit';
import { preparedNarration } from '@mv/analysis';
import { isLocal } from '$lib/server/access.ts';
import { evening } from '$lib/server/evening/store.ts';
import type { RequestHandler } from './$types';

/** A row's lighting, for the browser; the hardware renderer asks the store directly. */
export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the evening belongs to the machine running it');
	const { params } = event;
	const lighting = await evening.lightingSoon(params.key);
	if (!lighting) error(404, 'no such evening row');
	const audio = evening.narrationAudio(params.key);
	const measured = audio ? await preparedNarration(audio).catch(() => null) : null;
	return json(measured ? { ...lighting, measured } : lighting);
};
