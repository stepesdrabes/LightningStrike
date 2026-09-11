import { readLibrary } from '@mv/analysis';
import type { NewItem } from '$lib/queueModel.ts';

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
