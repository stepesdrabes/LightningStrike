/** Keyless YouTube Music InnerTube search returns releases, avoiding upload edits that distort DSP. */

const ENDPOINT = 'https://music.youtube.com/youtubei/v1';

/**
 * WEB_REMIX supplies structured artist/album metadata. Omit gl so search and yt-dlp use the
 * same IP region and agree on availability.
 */
const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en' };

/** Protobuf filter pinning a search to songs. yt-dlp publishes the set; this is its `songs`. */
const SONGS_ONLY = 'EgWKAQIIAWoKEAoQAxAEEAkQBQ==';

/** Auto-generated distributor Art Tracks identify clean release audio without title heuristics. */
const ART_TRACK = 'MUSIC_VIDEO_TYPE_ATV';

const ARTIST_PAGE = 'MUSIC_PAGE_TYPE_ARTIST';
const ALBUM_PAGE = 'MUSIC_PAGE_TYPE_ALBUM';

const TIMEOUT_MS = 6000;
const USER_AGENT = 'LightningStrike/1.0 (personal music visualizer)';

/** The music.youtube.com host lets yt-dlp select its Music client for the release search returned. */
export function watchUrl(id: string): string {
	return `https://music.youtube.com/watch?v=${id}`;
}

export interface Song {
	/** The 11-character YouTube video id; the same id plays on either host. */
	id: string;
	/** Track title alone. The artist is a separate field here, not glued to the front. */
	title: string;
	artist: string;
	album: string | null;
	/** Seconds. */
	duration: number;
	/** Cover art, not a video still. */
	thumbnail: string;
}

type Json = unknown;

/** Walk a key path, giving up rather than throwing the moment the shape is not what we assume. */
function at(node: Json, ...path: (string | number)[]): Json {
	let cur = node;
	for (const step of path) {
		if (cur === null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string | number, Json>)[step];
	}
	return cur;
}

function str(node: Json): string | null {
	return typeof node === 'string' ? node : null;
}

/** InnerTube writes every visible string as a list of runs, because any run may be a link. */
function text(node: Json): string {
	const runs = at(node, 'runs');
	if (!Array.isArray(runs)) return '';
	return runs.map((run) => str(at(run, 'text')) ?? '').join('');
}

/** Every value stored under `key`, at any depth. Does not descend into what it has matched. */
function* collect(node: Json, key: string): Generator<Json> {
	if (Array.isArray(node)) {
		for (const item of node) yield* collect(item, key);
	} else if (node !== null && typeof node === 'object') {
		for (const [k, v] of Object.entries(node)) {
			if (k === key) yield v;
			else yield* collect(v, key);
		}
	}
}

const CLOCK = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;

/** "3:54" or "1:02:11" to seconds. 0 for anything that is not a running time. */
export function clockToSeconds(label: string): number {
	const m = CLOCK.exec(label.trim());
	if (!m) return 0;
	return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Increase URL-encoded artwork size beyond 120 px for backdrop and dominant-hue sampling. */
const ART_SIZE = /=w\d+-h\d+/;

function artwork(thumbs: Json): string {
	if (!Array.isArray(thumbs) || thumbs.length === 0) return '';
	const url = str(at(thumbs[thumbs.length - 1], 'url'));
	if (!url) return '';
	return url.replace(ART_SIZE, '=w544-h544');
}

interface Byline {
	artist: string;
	album: string | null;
	duration: number;
}

/** Identify subtitle runs by link target, not position; singles, albums, and collaborations reorder them. */
function readByline(runs: Json[]): Byline {
	const artists: string[] = [];
	const out: Byline = { artist: '', album: null, duration: 0 };
	for (const run of runs) {
		const label = str(at(run, 'text')) ?? '';
		const page = str(
			at(
				run,
				'navigationEndpoint',
				'browseEndpoint',
				'browseEndpointContextSupportedConfigs',
				'browseEndpointContextMusicConfig',
				'pageType'
			)
		);
		if (page === ARTIST_PAGE) {
			// A collaboration is one linked run per act, with the separator as its own unlinked
			// run, so the credit has to be rebuilt rather than read off a single run.
			artists.push(label);
		} else if (page === ALBUM_PAGE) {
			if (!out.album) out.album = label;
		} else if (!out.duration) {
			out.duration = clockToSeconds(label);
		}
	}
	out.artist = artists.join(' & ');
	return out;
}

/** Read the title's watch endpoint; overflow menus can contain unrelated video ids. */
export function parseSearchRow(row: Json): Song | null {
	const columns = at(row, 'flexColumns');
	if (!Array.isArray(columns) || columns.length === 0) return null;

	const title = at(columns[0], 'musicResponsiveListItemFlexColumnRenderer', 'text');
	const watch = at(title, 'runs', 0, 'navigationEndpoint', 'watchEndpoint');
	const id = str(at(watch, 'videoId'));
	const kind = str(
		at(watch, 'watchEndpointMusicSupportedConfigs', 'watchEndpointMusicConfig', 'musicVideoType')
	);
	if (!id || kind !== ART_TRACK) return null;

	const runs: Json[] = [];
	for (const column of columns.slice(1)) {
		const more = at(column, 'musicResponsiveListItemFlexColumnRenderer', 'text', 'runs');
		if (Array.isArray(more)) runs.push(...more);
	}
	const byline = readByline(runs);

	return {
		id,
		title: text(title),
		artist: byline.artist,
		album: byline.album,
		duration: byline.duration,
		thumbnail: artwork(at(row, 'thumbnail', 'musicThumbnailRenderer', 'thumbnail', 'thumbnails'))
	};
}

/** One row of a radio queue, which InnerTube shapes differently from a search result. */
export function parseRadioRow(row: Json): Song | null {
	const watch = at(row, 'navigationEndpoint', 'watchEndpoint');
	const id = str(at(watch, 'videoId'));
	const kind = str(
		at(watch, 'watchEndpointMusicSupportedConfigs', 'watchEndpointMusicConfig', 'musicVideoType')
	);
	if (!id || kind !== ART_TRACK) return null;

	const runs = at(row, 'longBylineText', 'runs');
	const byline = readByline(Array.isArray(runs) ? runs : []);

	return {
		id,
		title: text(at(row, 'title')),
		artist: byline.artist,
		album: byline.album,
		// The byline here ends in a release year rather than a running time, which lives apart.
		duration: clockToSeconds(text(at(row, 'lengthText'))),
		thumbnail: artwork(at(row, 'thumbnail', 'thumbnails'))
	};
}

/** Qualifiers a release uses to mark a version that is not the studio recording. */
const VARIANT = /\b(?:live|slowed|sped ?-? ?up|karaoke|instrumental|cover|extended|acoustic|remaster(?:ed)?)\b/i;

/** "remastered" and "remaster" are one ask; "sped up" and "sped-up" are one qualifier. */
function stem(word: string): string {
	return word.toLowerCase().replace(/[\s-]/g, '').replace(/ed$/, '');
}

/** Only suffix qualifiers count; matching whole titles would misclassify names such as Cover Me In Sunshine. */
export function variantOf(title: string): string | null {
	const marks: string[] = [];
	for (const m of title.matchAll(/[([{]([^)\]}]*)[)\]}]/g)) marks.push(m[1]);
	const dash = /\s[-–]\s(.+)$/.exec(title);
	if (dash) marks.push(dash[1]);

	for (const mark of marks) {
		const hit = VARIANT.exec(mark);
		if (hit) return stem(hit[0]);
	}
	return null;
}

/** Stable-partition unrequested variants below plain recordings while preserving search relevance order. */
export function demoteVariants(songs: Song[], query: string): Song[] {
	const asked = new Set<string>();
	for (const m of query.matchAll(new RegExp(VARIANT.source, 'gi'))) asked.add(stem(m[0]));

	const plain: Song[] = [];
	const variants: Song[] = [];
	for (const song of songs) {
		const mark = variantOf(song.title);
		(mark !== null && !asked.has(mark) ? variants : plain).push(song);
	}
	return [...plain, ...variants];
}

async function post(path: string, body: Record<string, unknown>, signal?: AbortSignal) {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	const res = await fetch(`${ENDPOINT}/${path}`, {
		method: 'POST',
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		headers: {
			'content-type': 'application/json',
			// InnerTube answers a request that looks like it came from the player, and 400s one
			// that does not.
			origin: 'https://music.youtube.com',
			'user-agent': USER_AGENT
		},
		body: JSON.stringify({ context: { client: CLIENT }, ...body })
	});
	if (!res.ok) throw new Error(`YouTube Music returned ${res.status}`);
	return (await res.json()) as Json;
}

/** An aborted search is a superseded keystroke, not a failure worth showing anyone. */
function aborted(e: unknown): boolean {
	return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

export async function searchSongs(
	query: string,
	limit = 20,
	signal?: AbortSignal
): Promise<Song[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];

	let payload: Json;
	try {
		payload = await post('search', { query: trimmed, params: SONGS_ONLY }, signal);
	} catch (e) {
		if (aborted(e)) return [];
		throw e;
	}

	const songs: Song[] = [];
	for (const row of collect(payload, 'musicResponsiveListItemRenderer')) {
		const song = parseSearchRow(row);
		if (song) songs.push(song);
	}
	return demoteVariants(songs, trimmed).slice(0, Math.max(1, Math.floor(limit)));
}

/** RDAMVM<id> selects a track's own YouTube Music radio. */
export async function radioFor(videoId: string, limit = 25, signal?: AbortSignal): Promise<Song[]> {
	let payload: Json;
	try {
		payload = await post(
			'next',
			{ videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true },
			signal
		);
	} catch (e) {
		if (aborted(e)) return [];
		throw e;
	}

	const songs: Song[] = [];
	for (const row of collect(payload, 'playlistPanelVideoRenderer')) {
		const song = parseRadioRow(row);
		// The seed itself leads its own radio, and queueing it again would repeat the track.
		if (song && song.id !== videoId) songs.push(song);
	}
	return songs.slice(0, Math.max(1, Math.floor(limit)));
}
