import { error, json } from '@sveltejs/kit';
import { readFile, writeFile } from 'node:fs/promises';
import { BUILT_IN_EFFECTS, type Show, type TrackAnalysis } from '@mv/core';
import { analysisPath, isValidId, readContext, readMeta, showPath } from '@mv/analysis';
import { composeShow, formatFindings, lintShow } from '@mv/author-engine';
import { isLocal } from '$lib/server/access.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');
	try {
		return json(JSON.parse(await readFile(showPath(params.id), 'utf8')));
	} catch {
		error(404, 'no show authored yet');
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');
	const body = await request.text();
	if (!body) error(400, 'empty body');
	await writeFile(showPath(params.id), body);
	return new Response(null, { status: 204 });
};

/** Use Numerical Recipes' LCG so rerolls form a reproducible sequence. */
function nextSeed(from: number): number {
	return (Math.imul(from, 1664525) + 1013904223) >>> 0 || 1;
}

/** Persist rerolls so preview and hardware, which loads from disk, play the same composition. */
export const POST: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!isValidId(id)) error(400, 'invalid track id');
	if (!isLocal(event)) error(403, 'composing belongs to the machine running the show');

	let analysis: TrackAnalysis;
	try {
		analysis = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
	} catch {
		error(404, 'that track has not been analysed yet');
	}

	let current: Show | null = null;
	try {
		current = JSON.parse(await readFile(showPath(id), 'utf8')) as Show;
	} catch {
		// No show yet, so this is the first roll rather than the next one.
	}

	// Reject engine rerolls of model shows to preserve paid authoring work.
	if (current && current.authoredBy && current.authoredBy !== 'engine') {
		error(409, `${current.authoredBy} wrote this show; revising it is the way to change it`);
	}

	const artHue = (await readMeta(id))?.artHue;
	const context = await readContext(id);
	const show = composeShow(analysis, {
		artHue,
		context,
		seed: current?.seed ? nextSeed(current.seed) : undefined
	});

	const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
	const verdict = lintShow(show, { analysis, effects, context });
	if (!verdict.ok) error(500, `the composed show does not lint clean:\n${formatFindings(verdict)}`);

	await writeFile(showPath(id), JSON.stringify(show, null, '\t'));
	return json({ show });
};
