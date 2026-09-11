import type { LyricLine, TrackContext } from '@mv/core';
import { CONTEXT_VERSION } from '@mv/core';
import { mapGenres } from './genreMap.ts';

/**
 * Optional, timeout-bound identity, genre, tempo, and lyric lookups. Network failures must
 * degrade to an empty context so enrichment never blocks analysis.
 */

interface EnrichInput {
	/** Raw upload title, e.g. "CHRYSTAL - THE DAYS (NOTION REMIX)". */
	title: string;
	uploader: string;
	/** Decoded duration, seconds. The tie-breaker every fuzzy match is checked against. */
	duration: number;
	webpageUrl?: string;
	/** From yt-dlp's music card / Topic metadata, when YouTube knows. */
	ytArtist?: string;
	ytTrack?: string;
	channel?: string;
	tags?: string[];
	onProgress?: (msg: string) => void;
}

const TIMEOUT_MS = 6000;
/** MusicBrainz requires a contact-carrying agent; the rest just deserve honesty. */
const USER_AGENT = 'LightningStrike/1.0 (personal music visualizer)';

async function getJson(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown | null> {
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(timeoutMs),
			headers: { 'user-agent': USER_AGENT, accept: 'application/json' }
		});
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

/** Noise a YouTube title carries that no catalogue does. Remix and edit names stay: they are the identity. */
const TITLE_NOISE = [
	/[([{][^)\]}]*\b(official|video|audio|lyric|lyrics|visuali[sz]er|premiere|hd|4k|m\/v|music video|videoclip|klip|explicit|clean|remaster(?:ed)?(?: \d{4})?|prod\.?[^)\]}]*)\b[^)\]}]*[)\]}]/gi,
	/[([{]\s*(?:from|taken from)[^)\]}]*[)\]}]/gi,
	/\[[A-Z]{2,6}\s?\d{2,4}\]/g,
	/\s*\|.*$/,
	/\s*#\w+/g
] as const;

export function cleanTitle(raw: string): string {
	let s = raw;
	for (const re of TITLE_NOISE) s = s.replace(re, ' ');
	return s.replace(/\s+/g, ' ').trim();
}

/** "Artist - Title" with any dash the world writes it with. */
const SPLIT = /\s+[-–—―:|]\s+/;

interface ParsedTitle {
	artist: string | null;
	title: string;
}

export function parseTitle(rawTitle: string, uploader: string, channel?: string): ParsedTitle {
	const cleaned = cleanTitle(rawTitle);

	// A "<name> - Topic" channel is YouTube's own statement of the artist, and the title is
	// then exactly the track name.
	if (channel?.endsWith(' - Topic')) {
		return { artist: channel.slice(0, -' - Topic'.length).trim(), title: cleaned };
	}

	const parts = cleaned.split(SPLIT);
	if (parts.length >= 2) {
		return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
	}

	const owner = uploader
		.replace(/\s*-?\s*(vevo|official|music|records|recordings|tv)$/i, '')
		.trim();
	return { artist: owner || null, title: cleaned };
}

const fold = (s: string) =>
	s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

/** Case-, diacritic- and punctuation-blind containment either way round. */
export function namesMatch(a: string | null, b: string | null): boolean {
	if (!a || !b) return false;
	const fa = fold(a);
	const fb = fold(b);
	if (!fa || !fb) return false;
	return fa.includes(fb) || fb.includes(fa);
}

/** The same, but whole-string: containment would call "THE DAYS (NOTION REMIX)" a match for "NOTION". */
export function namesEqual(a: string | null, b: string | null): boolean {
	if (!a || !b) return false;
	const fa = fold(a);
	return fa.length > 0 && fa === fold(b);
}

interface DeezerTrack {
	id: number;
	title: string;
	duration: number;
	isrc: string | null;
	bpm: number | null;
	artist: string | null;
}

async function deezerById(id: number): Promise<DeezerTrack | null> {
	const j = (await getJson(`https://api.deezer.com/track/${id}`)) as Record<string, unknown> | null;
	if (!j || typeof j.id !== 'number') return null;
	const artist = j.artist as Record<string, unknown> | undefined;
	return {
		id: j.id,
		title: String(j.title_short ?? j.title ?? ''),
		duration: Number(j.duration ?? 0),
		isrc: j.isrc ? String(j.isrc) : null,
		bpm: typeof j.bpm === 'number' && j.bpm > 0 ? j.bpm : null,
		artist: artist?.name ? String(artist.name) : null
	};
}

async function deezerSearch(artist: string | null, title: string, duration: number): Promise<DeezerTrack | null> {
	const q = artist ? `artist:"${artist}" track:"${title}"` : title;
	const j = (await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=8`)) as
		| { data?: { id: number; duration: number; artist?: { name?: string } }[] }
		| null;
	const rows = j?.data ?? [];
	// Use duration to disambiguate versions. With no duration, require artist agreement; otherwise
	// the artist's top hit is fallback when video length prevents a close match.
	const near =
		duration > 0
			? rows.find((r) => Math.abs(Number(r.duration ?? 0) - duration) <= 6)
			: artist
				? rows.find((r) => namesMatch(r.artist?.name ?? null, artist))
				: rows[0];
	const hit = near ?? (artist ? rows.find((r) => namesMatch(r.artist?.name ?? null, artist)) : null);
	return hit ? deezerById(hit.id) : null;
}

/**
 * song.link catalogue identities can resolve malformed titles; ignore YouTube entities that
 * echo channel names as artists.
 */
const ODESLI_PLATFORMS = ['DEEZER_SONG', 'SPOTIFY_SONG', 'ITUNES_SONG', 'TIDAL_SONG', 'AMAZON_SONG', 'SOUNDCLOUD_SONG'];

async function odesli(url: string): Promise<{ artist: string | null; title: string | null; deezerId: number | null } | null> {
	const j = (await getJson(
		`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}&songIfSingle=true`
	)) as Record<string, unknown> | null;
	if (!j) return null;
	const entities = (j.entitiesByUniqueId ?? {}) as Record<string, Record<string, unknown>>;

	let artist: string | null = null;
	let title: string | null = null;
	let deezerId: number | null = null;
	for (const platform of ODESLI_PLATFORMS) {
		for (const [key, e] of Object.entries(entities)) {
			if (!key.startsWith(`${platform}::`)) continue;
			if (!artist && e.artistName) artist = String(e.artistName);
			if (!title && e.title) title = String(e.title);
			if (platform === 'DEEZER_SONG') deezerId = Number(key.split('::')[1]) || null;
		}
		if (artist && title) break;
	}
	return artist || title || deezerId ? { artist, title, deezerId } : null;
}

async function itunesGenre(artist: string | null, title: string, duration: number): Promise<string | null> {
	const term = [artist, title].filter(Boolean).join(' ');
	for (const country of ['CZ', 'US']) {
		const j = (await getJson(
			`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=10&country=${country}`
		)) as { results?: Record<string, unknown>[] } | null;
		const rows = (j?.results ?? []).filter((r) => r.primaryGenreName);
		// The artist has to match or the genre is a cover's: duration-matching alone returned
		// an "Instrumental" karaoke cut for a rap track. Duration then splits namesake tracks.
		const credited = artist ? rows.filter((r) => namesMatch(String(r.artistName ?? ''), artist)) : rows;
		const hit =
			credited.find(
				(r) => duration > 0 && Math.abs(Number(r.trackTimeMillis ?? 0) / 1000 - duration) <= 6
			) ?? credited[0];
		if (hit) return String(hit.primaryGenreName);
	}
	return null;
}

/** Recording-level genres by ISRC, falling back to the artist's, which are far more often filled. */
async function musicbrainzGenres(isrc: string): Promise<string[]> {
	const j = (await getJson(
		`https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(isrc)}?inc=genres+artist-credits&fmt=json`
	)) as { recordings?: Record<string, unknown>[] } | null;
	const rec = j?.recordings?.[0];
	if (!rec) return [];
	const out: string[] = [];
	for (const g of (rec.genres ?? []) as { name?: string }[]) if (g.name) out.push(g.name);
	if (out.length > 0) return out;

	const credit = (rec['artist-credit'] ?? []) as { artist?: { id?: string } }[];
	const artistId = credit[0]?.artist?.id;
	if (!artistId) return [];
	// MusicBrainz asks for one request a second; the ISRC call above just happened, so wait.
	await new Promise((r) => setTimeout(r, 1100));
	const a = (await getJson(
		`https://musicbrainz.org/ws/2/artist/${artistId}?inc=genres&fmt=json`
	)) as { genres?: { name?: string }[] } | null;
	return (a?.genres ?? []).map((g) => g.name).filter((n): n is string => !!n);
}

interface LrcHit {
	syncedLyrics: string | null;
	plainLyrics: string | null;
	instrumental: boolean;
	duration: number;
}

/** Search finds synced duplicates that the exact-signature /get endpoint can miss. */
async function lrclib(artist: string | null, title: string, duration: number): Promise<LrcHit | null> {
	const params = artist
		? `track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`
		: `q=${encodeURIComponent(title)}`;
	const j = (await getJson(`https://lrclib.net/api/search?${params}`)) as
		| Record<string, unknown>[]
		| null;
	if (!j || !Array.isArray(j)) return null;
	const rows = j.map((r) => ({
		syncedLyrics: r.syncedLyrics ? String(r.syncedLyrics) : null,
		plainLyrics: r.plainLyrics ? String(r.plainLyrics) : null,
		instrumental: !!r.instrumental,
		duration: Number(r.duration ?? 0)
	}));
	// Prefer duration matches, but permit video-length gaps within artist-scoped lyric results.
	const near = rows.filter((r) => duration <= 0 || Math.abs(r.duration - duration) <= 6);
	const pool = near.length > 0 ? near : rows;
	return pool.find((r) => r.syncedLyrics) ?? pool[0] ?? null;
}

const LRC_LINE = /^\s*(?:\[(\d+):(\d+(?:\.\d+)?)\])+\s*(.*)$/;
const LRC_TIME = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

export function parseLrc(lrc: string): LyricLine[] {
	const out: LyricLine[] = [];
	for (const line of lrc.split('\n')) {
		if (!LRC_LINE.test(line)) continue;
		const text = line.replace(LRC_TIME, '').trim();
		if (!text) continue;
		for (const m of line.matchAll(LRC_TIME)) {
			out.push({ t: Math.round((Number(m[1]) * 60 + Number(m[2])) * 100) / 100, text });
		}
	}
	return out.sort((a, b) => a.t - b.t);
}

export async function enrichTrack(input: EnrichInput): Promise<TrackContext> {
	const log = input.onProgress ?? (() => {});
	const sources: string[] = [];
	const genres: string[] = [];

	let artist: string | null = null;
	let title: string | null = null;
	let resolvedBy: string | null = null;

	if (input.ytArtist && input.ytTrack) {
		artist = input.ytArtist;
		title = input.ytTrack;
		resolvedBy = 'ytmeta';
		sources.push('ytmeta');
	} else {
		const parsed = parseTitle(input.title, input.uploader, input.channel);
		artist = parsed.artist;
		title = parsed.title;
		resolvedBy = 'titleparse';
		// "In The End - Linkin Park" reads backwards: when the parsed title IS the uploader's
		// name, the two halves are swapped. Whole-string equality only - a remix title merely
		// containing the channel name is the normal case, not a reversal.
		const owner = input.channel ?? input.uploader;
		if (artist && title && namesEqual(title, owner) && !namesEqual(artist, owner)) {
			[artist, title] = [title, artist];
		}
	}

	let deezerId: number | null = null;
	if (input.webpageUrl) {
		log('resolving identity');
		const linked = await odesli(input.webpageUrl);
		if (linked) {
			sources.push('odesli');
			deezerId = linked.deezerId;
			// song.link's read is catalogue-backed where the title parse is a guess - but its
			// matching is fuzzy enough to land on a namesake by another act, so it only
			// replaces a parse it broadly agrees with, or one that produced no artist at all.
			const agrees =
				namesMatch(linked.artist, artist) ||
				namesMatch(linked.title, title) ||
				(!artist && !!linked.artist);
			if (linked.artist && linked.title && resolvedBy === 'titleparse' && agrees) {
				artist = linked.artist;
				title = linked.title;
				resolvedBy = 'odesli';
			}
		}
	}

	log('looking the track up');
	let deezer = deezerId ? await deezerById(deezerId) : null;
	// A linked id whose duration is nowhere near the audio is a mismatched link: a live cut,
	// a namesake, a re-record. Fall back to searching by name, where duration arbitrates.
	if (deezer && input.duration > 0 && Math.abs(deezer.duration - input.duration) > 12) {
		deezer = null;
	}
	if (!deezer && title) deezer = await deezerSearch(artist, title, input.duration);
	if (deezer) {
		sources.push('deezer');
		if (resolvedBy === 'titleparse' && deezer.artist && namesMatch(deezer.title, title)) {
			artist = deezer.artist;
			title = deezer.title || title;
			resolvedBy = 'deezer';
		}
	}

	const [genre, mbGenres, lyricsHit] = await Promise.all([
		title ? itunesGenre(artist, title, input.duration) : null,
		deezer?.isrc ? musicbrainzGenres(deezer.isrc) : [],
		title ? lrclib(artist, title, input.duration) : null
	]);

	if (genre) {
		genres.push(genre);
		sources.push('itunes');
	}
	if (mbGenres.length > 0) {
		genres.push(...mbGenres);
		sources.push('musicbrainz');
	}

	let lyrics: LyricLine[] | null = null;
	let instrumental: boolean | null = null;
	if (lyricsHit) {
		sources.push('lrclib');
		instrumental = lyricsHit.instrumental;
		if (lyricsHit.syncedLyrics) {
			const lines = parseLrc(lyricsHit.syncedLyrics);
			if (lines.length > 3) lyrics = lines;
		}
	}

	// Source genres and uploader tags vote; the artist's own name is struck from every string
	// first, or Daft Punk plays punk rooms forever.
	const strike = (s: string) =>
		artist ? s.toLowerCase().replaceAll(artist.toLowerCase(), ' ') : s;
	const vote = mapGenres([...genres, ...(input.tags ?? [])].map(strike));

	return {
		version: CONTEXT_VERSION,
		artist,
		title,
		resolvedBy,
		isrc: deezer?.isrc ?? null,
		publishedBpm: deezer?.bpm ?? null,
		genres,
		audioGenres: [],
		genreFamily: vote.family,
		genreConfidence: Math.round(vote.confidence * 100) / 100,
		lyrics,
		instrumental,
		fetchedAt: new Date().toISOString(),
		sources
	};
}
