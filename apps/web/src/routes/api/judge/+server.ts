import { json } from '@sveltejs/kit';
import {
	clearJudgement,
	readJudgements,
	writeJudgement,
	type Judgement
} from '$lib/server/judge.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json({ judgements: await readJudgements() });

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		judgement?: Judgement;
		trackId?: string;
		clear?: boolean;
	};

	if (body.clear && body.trackId) {
		await clearJudgement(body.trackId);
		return json({ ok: true });
	}
	if (!body.judgement?.trackId) return new Response('trackId required', { status: 400 });
	await writeJudgement(body.judgement);
	return json({ ok: true });
};
