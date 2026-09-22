import { readLibrary, watchUrl } from '@mv/analysis';
import { videoIdOf, type NewItem } from '$lib/queueModel.ts';

/** Shared queue admission for host, guest and radio. */

/**
 * Whitelist request fields: callers cannot assert radio ownership, authored readiness or
 * analysed genre.
 */
export function fromRequest(item: NewItem, addedBy?: string): NewItem {
	return {
		source: item.source,
		trackId: item.trackId ?? null,
		title: item.title,
		uploader: item.uploader,
		thumbnail: item.thumbnail,
		duration: item.duration,
		addedBy
	};
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ARTWORK_HOSTS = ['ytimg.com', 'googleusercontent.com', 'ggpht.com'];
const LONGEST_TRACK_S = 6 * 3600;

/**
 * A guest names a YouTube track and nothing more. The source is built here, so a phone cannot
 * point preparation at a path on this machine, nor the artwork fetch at an arbitrary address.
 */
export function fromGuest(item: NewItem, addedBy: string): NewItem | null {
	const id = item.trackId && VIDEO_ID.test(item.trackId) ? item.trackId : videoIdOf(item.source);
	if (!id) return null;
	return {
		source: watchUrl(id),
		trackId: id,
		title: text(item.title, 200),
		uploader: text(item.uploader, 120),
		thumbnail: artwork(item.thumbnail) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
		duration:
			typeof item.duration === 'number' && item.duration > 0 && item.duration < LONGEST_TRACK_S
				? item.duration
				: undefined,
		addedBy
	};
}

function text(value: unknown, max: number): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function artwork(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	try {
		const url = new URL(value);
		const host = url.hostname;
		const known = ARTWORK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
		return url.protocol === 'https:' && known ? url.href : null;
	} catch {
		return null;
	}
}

/** Only cache evidence may mark a row authored and ready without preparation. */
export async function enrichFromLibrary(items: NewItem[]): Promise<NewItem[]> {
	if (items.length === 0) return items;
	const library = await readLibrary();
	const byId = new Map(library.map((e) => [e.id, e]));

	return items.map((item) => {
		const hit = item.trackId ? byId.get(item.trackId) : undefined;
		// Require current analysis and engine versions before skipping preparation.
		const cached = hit?.analysed && hit.current && hit.authored !== 'none' ? hit : undefined;
		return {
			...item,
			title: item.title ?? hit?.title,
			uploader: item.uploader ?? hit?.uploader,
			thumbnail: item.thumbnail ?? hit?.thumbnail,
			duration: item.duration ?? hit?.duration ?? 0,
			authored: cached?.authored ?? 'none',
			loungeOnly:
				cached !== undefined &&
				cached.gridTrust?.trusted === false &&
				!cached.gridTrustOverride,
			trustNote: cached?.gridTrust?.reasons.join('; ') || undefined,
			// A track played before already knows its family; a new one learns it at ingest.
			genre: hit?.genreFamily ?? undefined
		};
	});
}
