import { json } from '@sveltejs/kit';
import { runner } from '$lib/server/ingestRunner.ts';
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
		runner.editsChanged(body.trackId);
		return json({ ok: true });
	}
	if (!body.judgement?.trackId) return new Response('trackId required', { status: 400 });
	await writeJudgement(body.judgement);
	// Section and movement marks change the analysis; ratings and notes do not.
	const j = body.judgement;
	if (j.sections !== undefined || j.movements !== undefined || j.movementVetoes !== undefined) {
		runner.editsChanged(j.trackId);
	}
	return json({ ok: true });
};
