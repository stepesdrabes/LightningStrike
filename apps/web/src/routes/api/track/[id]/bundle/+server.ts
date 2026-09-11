import { error, json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { analysisPath, isValidId, readContext, readMeta, showPath } from '@mv/analysis';
import type { Show, TrackAnalysis } from '@mv/core';
import type { RequestHandler } from './$types';

/** Return analysis and show together to avoid rendering cues against a mismatched grid. */
export const GET: RequestHandler = async ({ params }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');

	let analysis: TrackAnalysis;
	try {
		analysis = JSON.parse(await readFile(analysisPath(params.id), 'utf8')) as TrackAnalysis;
	} catch {
		error(404, 'that track has not been analysed yet');
	}

	let show: Show | null = null;
	try {
		const candidate = JSON.parse(await readFile(showPath(params.id), 'utf8')) as Show;
		// A show addressed to a grid that has since been re-analysed points at the wrong music.
		if (candidate.analysisHash === analysis.hash) show = candidate;
	} catch {
		// No show for this track yet.
	}

	return json({
		analysis,
		show,
		meta: await readMeta(params.id),
		context: await readContext(params.id)
	});
};
