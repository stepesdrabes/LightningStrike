import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { isLocal } from '$lib/server/access.ts';
import { evening } from '$lib/server/evening/store.ts';
import type { RequestHandler } from './$types';

const TYPES: Record<string, string> = {
	'.m4a': 'audio/mp4',
	'.mp4': 'audio/mp4',
	'.webm': 'audio/webm',
	'.opus': 'audio/ogg',
	'.ogg': 'audio/ogg',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.flac': 'audio/flac'
};

/** A narration's audio, served only for a row the evening plans, never an arbitrary path. */
export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the evening belongs to the machine running it');
	const { params } = event;
	await evening.settled();
	const path = evening.narrationAudio(params.key);
	if (!path) error(404, 'no narration for this row');
	let data: Buffer;
	try {
		data = await readFile(path);
	} catch {
		error(404, 'the narration file is missing');
	}
	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
			'content-length': String(data.byteLength),
			'cache-control': 'no-store'
		}
	});
};
