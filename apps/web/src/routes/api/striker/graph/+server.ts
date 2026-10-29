import { error, json } from '@sveltejs/kit';
import { chosenStriker2Graph } from '@mv/analysis';
import type { RequestHandler } from './$types';

/** The chosen model's stages, read from its installed graph. */
export const GET: RequestHandler = async () => {
	const graph = await chosenStriker2Graph().catch(() => null);
	if (!graph) error(404, 'no Striker 2.0 graph can be read');
	return json(graph);
};
