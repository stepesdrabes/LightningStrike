/** Pure queue transitions; queueStore owns persistence and publication. */

import type { Authored } from '$lib/types.ts';

export type ItemStatus =
	| 'pending'
	| 'resolving'
	| 'downloading'
	| 'analysing'
	| 'ready'
	| 'error';

export interface QueueItem {
	/** Row identity, independent of track identity, so repeated songs remain addressable. */
	key: string;
	/** A YouTube URL or a local path. The only thing known before it is resolved. */
	source: string;
	/** Null until resolving succeeds. */
	trackId: string | null;
	title: string;
	uploader: string;
	thumbnail: string;
	/** Seconds; 0 when not yet known. */
	duration: number;
	status: ItemStatus;
	/** Why it failed, or which stage it is in. Empty when there is nothing to say. */
	message: string;
	authored: Authored;
	/** Fetch attempts during transient retry; absent for untouched rows and first attempts. */
	attempts?: number;
	/** The lighting family, once the track has been enriched. Absent until then. */
	genre?: string;
	/** An untrusted analysis grid selects lounge scenes until the host overrides it. */
	loungeOnly?: boolean;
	/** Why the grid is not trusted, for the row and the inspector. */
	trustNote?: string;
	/** Reserved for guests adding from their own device. Absent means the host added it. */
	addedBy?: string;
	/** Set only by the radio topping the queue up, so a row nobody chose can say so. */
	auto?: true;
	addedAt: number;
}

export interface QueueState {
	items: QueueItem[];
	/** The row that is playing, by key. Null when the queue is empty or has run out. */
	currentKey: string | null;
	/** Bumped on every mutation, so a client can tell a stale snapshot from a fresh one. */
	revision: number;
}

export const EMPTY_QUEUE: QueueState = { items: [], currentKey: null, revision: 0 };

export interface NewItem {
	source: string;
	trackId?: string | null;
	title?: string;
	uploader?: string;
	thumbnail?: string;
	duration?: number;
	authored?: Authored;
	genre?: string;
	loungeOnly?: boolean;
	trustNote?: string;
	addedBy?: string;
	auto?: true;
}

const WATCH_ID = /^[A-Za-z0-9_-]{11}$/;

/** Normalise YouTube host/path aliases so radio cannot repeat the same video. */
export function videoIdOf(source: string): string | null {
	try {
		const url = new URL(source);
		const v = url.searchParams.get('v');
		if (v && WATCH_ID.test(v)) return v;
		if (url.hostname.endsWith('youtu.be')) {
			const seg = url.pathname.slice(1);
			if (WATCH_ID.test(seg)) return seg;
		}
	} catch {
		// A local path, which is a perfectly good source and simply is not a URL.
	}
	return null;
}

/**
 * Deduplicate songs across release IDs and remixes. Ignore duration: listings of one recording
 * often differ by seconds.
 */
/** Everything that is not a letter or a digit, so punctuation and case cannot split a match. */
function condense(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** A dash clause that names a version rather than the act, which an upload title leads with. */
const DASHED_VERSION =
	/\s[-–]\s[^-–]*\b(?:remix|mix|edit|version|live|remaster(?:ed)?|acoustic|instrumental|slowed|sped)\b.*$/i;

/**
 * Strip version clauses; skipping an unrelated same-title suggestion is preferable to replaying
 * a song.
 */
export function titleKeyOf(title: string): string {
	// Strip brackets before dashed version clauses so Artist - Title (Remix) retains its title.
	const unbracketed = title.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
	return condense(unbracketed.replace(DASHED_VERSION, '').replace(/\bfeat\.?\b.*$/i, ' '));
}

/** Use the lead artist credit so adding a remixer cannot bypass song deduplication. */
export function signatureOf(artist: string, title: string): string {
	const lead = artist.split(/\s*[&,]\s*|\s+x\s+/i)[0];
	return `${condense(lead)}:${titleKeyOf(title)}`;
}

export function indexOfKey(state: QueueState, key: string | null): number {
	return key === null ? -1 : state.items.findIndex((i) => i.key === key);
}

export function currentItem(state: QueueState): QueueItem | null {
	const i = indexOfKey(state, state.currentKey);
	return i === -1 ? null : state.items[i];
}

/** The row after the current one, which is the only one worth preparing ahead. */
export function nextItem(state: QueueState): QueueItem | null {
	const i = indexOfKey(state, state.currentKey);
	if (i === -1) return state.items[0] ?? null;
	return state.items[i + 1] ?? null;
}

function makeItem(input: NewItem, key: string, now: number): QueueItem {
	return {
		key,
		source: input.source,
		trackId: input.trackId ?? null,
		title: input.title ?? input.source,
		uploader: input.uploader ?? '',
		thumbnail: input.thumbnail ?? '',
		duration: input.duration ?? 0,
		// A track already in the cache is ready the moment it is queued; nothing to fetch.
		status: input.trackId && input.authored && input.authored !== 'none' ? 'ready' : 'pending',
		message: '',
		authored: input.authored ?? 'none',
		genre: input.genre,
		loungeOnly: input.loungeOnly,
		trustNote: input.trustNote,
		addedBy: input.addedBy,
		auto: input.auto,
		addedAt: now
	};
}

/** Append without interrupting playback; select a current row only if none is playing. */
export function addItems(
	state: QueueState,
	inputs: NewItem[],
	keyFor: (index: number) => string,
	now: number
): QueueState {
	if (inputs.length === 0) return state;
	const added = inputs.map((input, i) => makeItem(input, keyFor(i), now));
	const items = [...state.items, ...added];
	return {
		...state,
		items,
		currentKey: state.currentKey ?? added[0].key,
		revision: state.revision + 1
	};
}

/** Removing the current row advances to its successor. */
export function removeItem(state: QueueState, key: string): QueueState {
	const at = indexOfKey(state, key);
	if (at === -1) return state;
	const items = state.items.filter((i) => i.key !== key);
	let currentKey = state.currentKey;
	if (state.currentKey === key) currentKey = items[at]?.key ?? items[at - 1]?.key ?? null;
	return { ...state, items, currentKey, revision: state.revision + 1 };
}

export function clearQueue(state: QueueState, keepCurrent: boolean): QueueState {
	const current = keepCurrent ? currentItem(state) : null;
	return {
		...state,
		items: current ? [current] : [],
		currentKey: current?.key ?? null,
		revision: state.revision + 1
	};
}

/** Move a row to an absolute index, clamped. Reordering never changes what is playing. */
export function moveItem(state: QueueState, key: string, to: number): QueueState {
	const from = indexOfKey(state, key);
	if (from === -1) return state;
	const target = Math.max(0, Math.min(state.items.length - 1, Math.floor(to)));
	if (target === from) return state;
	const items = [...state.items];
	const [row] = items.splice(from, 1);
	items.splice(target, 0, row);
	return { ...state, items, revision: state.revision + 1 };
}

/** Put a row directly after the current one, which is what "play next" means. */
export function playNext(state: QueueState, key: string): QueueState {
	const at = indexOfKey(state, state.currentKey);
	return moveItem(state, key, at === -1 ? 0 : at + 1);
}

export function jumpTo(state: QueueState, key: string): QueueState {
	if (indexOfKey(state, key) === -1) return state;
	return { ...state, currentKey: key, revision: state.revision + 1 };
}

/** Stop at queue boundaries rather than restarting the set. */
export function step(state: QueueState, dir: -1 | 1): QueueState {
	const at = indexOfKey(state, state.currentKey);
	if (at === -1) {
		const first = dir > 0 ? state.items[0] : state.items[state.items.length - 1];
		return first ? { ...state, currentKey: first.key, revision: state.revision + 1 } : state;
	}
	const target = state.items[at + dir];
	if (!target) return state;
	return { ...state, currentKey: target.key, revision: state.revision + 1 };
}

export function patchItem(
	state: QueueState,
	key: string,
	patch: Partial<Omit<QueueItem, 'key'>>
): QueueState {
	const at = indexOfKey(state, key);
	if (at === -1) return state;
	const items = [...state.items];
	items[at] = { ...items[at], ...patch };
	return { ...state, items, revision: state.revision + 1 };
}

/** Guests may remove only their own non-current rows; anonymous rows belong to nobody. */
export function canGuestRemove(state: QueueState, key: string, guest: string): boolean {
	if (!guest) return false;
	const item = state.items.find((i) => i.key === key);
	return item !== undefined && item.addedBy === guest && state.currentKey !== key;
}
