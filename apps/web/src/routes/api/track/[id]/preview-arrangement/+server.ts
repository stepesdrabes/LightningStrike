import { error, json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import type { TrackAnalysis } from '@mv/core';
import { analysisPath, isValidId, readContext, readMeta } from '@mv/analysis';
import { composeShow } from '@mv/author-engine';
import { isLocal } from '$lib/server/access.ts';
import { readJudgements, type JudgedSection } from '$lib/server/judge.ts';
import { applyHandSections } from '$lib/server/previewArrangement.ts';
import type { RequestHandler } from './$types';

/**
 * Compose an ephemeral deterministic preview without disk writes. Prefer the request draft,
 * falling back to the saved map.
 */
export const POST: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!isValidId(id)) error(400, 'invalid track id');

	if (!isLocal(event)) error(403, 'forbidden');

	let analysis: TrackAnalysis;
	try {
		analysis = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
	} catch {
		error(404, 'that track has not been analysed yet');
	}

	const body = (await event.request.json().catch(() => ({}))) as { sections?: JudgedSection[] };
	const sections =
		body.sections?.length && body.sections.length >= 2
			? body.sections
			: (await readJudgements()).find((j) => j.trackId === id)?.sections;
	if (!sections?.length) error(404, 'no hand-drawn section map for this track');

	const preview = applyHandSections(analysis, sections);
	// Match analysis's map rejection rules so previews show only adoptable arrangements.
	if (!preview) error(422, 'that map does not resolve to two sections on this grid');
	const artHue = (await readMeta(id))?.artHue;
	const context = await readContext(id);
	// Return the preview analysis with its show so effects and every timeline readout share the
	// arrangement.
	return json({ show: composeShow(preview, { artHue, context }), analysis: preview });
};
