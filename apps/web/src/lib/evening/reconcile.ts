import type { QueueItem, QueueState } from '../queueModel.ts';
import type { Plan, PlannedRow } from './plan.ts';

/** What the library already knows about a track, so a new row arrives ready and labelled. */
export type TrackFacts = (trackId: string) => Partial<Pick<QueueItem, 'authored' | 'genre' | 'loungeOnly' | 'trustNote' | 'thumbnail' | 'status'>> | null;

/** A queue row for a planned row, keeping what an existing row has learned while preparing. */
export function rowItem(row: PlannedRow, existing: QueueItem | undefined, facts: TrackFacts, now: number): QueueItem {
	const known = row.trackId ? facts(row.trackId) : null;
	const silent = row.kind !== 'song' && row.kind !== 'narration';
	const status = existing?.status ?? (silent || row.ready ? 'ready' : 'pending');
	return {
		key: row.key,
		source: row.source,
		trackId: row.trackId,
		title: row.title,
		uploader: row.artist,
		thumbnail: existing?.thumbnail || row.thumbnail || known?.thumbnail || '',
		duration: row.kind === 'song' && existing?.duration ? existing.duration : row.duration,
		status,
		message: existing?.message ?? '',
		authored: existing?.authored ?? known?.authored ?? 'none',
		...(existing?.attempts !== undefined ? { attempts: existing.attempts } : {}),
		...((existing?.genre ?? known?.genre) ? { genre: existing?.genre ?? known?.genre } : {}),
		...((existing?.loungeOnly ?? known?.loungeOnly) !== undefined ? { loungeOnly: existing?.loungeOnly ?? known?.loungeOnly } : {}),
		...((existing?.trustNote ?? known?.trustNote) ? { trustNote: existing?.trustNote ?? known?.trustNote } : {}),
		...((row.addedBy ?? existing?.addedBy) ? { addedBy: row.addedBy ?? existing?.addedBy } : {}),
		...(existing?.auto ? { auto: existing.auto } : {}),
		addedAt: existing?.addedAt ?? now,
		...(row.kind !== 'song' ? { kind: row.kind } : {}),
		...(row.tag ? { evening: row.tag } : {})
	};
}

function same(a: QueueItem, b: QueueItem): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Lay a plan over the queue: history and the current row stay as they are, planned rows follow
 * in order, and requests the plan did not place wait at the end. An unchanged plan leaves the
 * state untouched, so a replan never publishes a new revision for nothing.
 */
export function reconcileQueue(state: QueueState, plan: Plan, run: string, facts: TrackFacts, now: number): QueueState {
	const byKey = new Map(state.items.map((i) => [i.key, i]));
	const at = state.items.findIndex((i) => i.key === state.currentKey);
	const head = at === -1 ? [] : state.items.slice(0, at + 1);
	const headKeys = new Set(head.map((i) => i.key));
	const planned = plan.rows
		.filter((r) => !headKeys.has(r.key))
		.map((r) => rowItem(r, byKey.get(r.key), facts, now));
	const placed = new Set(planned.map((i) => i.key));
	const rest = state.items
		.slice(at + 1)
		.filter((i) => !placed.has(i.key) && !(i.evening?.run === run && i.evening.role !== 'request'))
		.map((i) => {
			if (i.evening?.run !== run) return i;
			const { evening: _tag, ...request } = i;
			return request;
		});
	// Refresh the current row's tag and length, which a file edit may have renamed.
	const current = at === -1 ? null : plan.rows.find((r) => r.key === state.currentKey);
	const headItems = current ? [...head.slice(0, -1), rowItem(current, head[head.length - 1], facts, now)] : head;
	const items = [...headItems, ...planned, ...rest];
	const currentKey = state.currentKey ?? items[0]?.key ?? null;
	if (items.length === state.items.length && currentKey === state.currentKey && items.every((item, i) => same(item, state.items[i]))) {
		return state;
	}
	return { items, currentKey, revision: state.revision + 1 };
}

/** The queue after bailing out: the playing row, then the planned songs and requests, untagged, each once. */
export function bailQueue(state: QueueState): QueueState {
	const at = state.items.findIndex((i) => i.key === state.currentKey);
	const isSong = (i: QueueItem) => (i.kind ?? 'song') === 'song';
	const strip = (i: QueueItem): QueueItem => {
		const { evening: _tag, kind: _kind, ...plain } = i;
		return plain;
	};
	const current = at === -1 ? null : state.items[at];
	const coming = new Set<string>();
	const items = state.items.filter((item, i) => {
		if (!isSong(item)) return false;
		if (i < at || !item.trackId) return true;
		if (coming.has(item.trackId)) return false;
		coming.add(item.trackId);
		return true;
	});
	// A silent row was playing: the music carries on from the next song.
	const currentKey = current && !isSong(current) ? (state.items.slice(at + 1).find(isSong)?.key ?? null) : state.currentKey;
	return { items: items.map(strip), currentKey, revision: state.revision + 1 };
}
