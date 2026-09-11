import { error, json } from '@sveltejs/kit';
import { searchSongs, watchUrl, type Song } from '@mv/analysis';
import type { RequestHandler } from './$types';

/** A song plus where to fetch it, which is the shape the browser is handed. */
type SearchResult = Song & { webpageUrl: string };

/** Bound a session query cache so backspacing can reuse results without unbounded growth. */
const CACHE = new Map<string, SearchResult[]>();
const CACHE_MAX = 60;

function remember(key: string, results: SearchResult[]): void {
	CACHE.delete(key);
	CACHE.set(key, results);
	if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
}

export const GET: RequestHandler = async ({ url, request }) => {
	const query = (url.searchParams.get('q') ?? '').trim();
	if (!query) return json({ results: [] });
	if (query.length > 200) error(400, 'query too long');

	const limit = Math.max(1, Math.min(40, Number(url.searchParams.get('limit') ?? 18)));
	const key = `${limit}:${query.toLowerCase()}`;

	const hit = CACHE.get(key);
	if (hit) return json({ results: hit, cached: true });

	try {
		const songs = await searchSongs(query, limit, request.signal);
		const results = songs.map((song) => ({ ...song, webpageUrl: watchUrl(song.id) }));
		// An aborted search resolves empty; caching that would poison the query it was for.
		if (!request.signal.aborted && results.length > 0) remember(key, results);
		return json({ results });
	} catch (e) {
		error(502, (e as Error).message);
	}
};
