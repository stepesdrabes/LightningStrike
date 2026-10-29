import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { hearingPath, isValidId } from '@mv/analysis';
import type { RequestHandler } from './$types';

/** What Striker 2.0 heard and answered for this song, in `readHearing`'s layout. */
export const GET: RequestHandler = async ({ params }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');
	const packed = await readFile(hearingPath(params.id)).catch(() => null);
	if (!packed) error(404, 'prepared before the model view kept what it heard');
	return new Response(new Uint8Array(await promisify(gunzip)(packed)), {
		headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-cache' }
	});
};
