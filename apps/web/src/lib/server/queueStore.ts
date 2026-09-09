import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CACHE_DIR, readLibrary } from '@mv/analysis';
import {
	EMPTY_QUEUE,
	addItems,
	clearQueue,
	jumpTo,
	moveItem,
	patchItem,
	playNext,
	removeItem,
	step,
	type NewItem,
	type QueueItem,
	type QueueState
} from '$lib/queueModel.ts';

const QUEUE_FILE = join(CACHE_DIR, 'queue.json');

type Listener = (state: QueueState) => void;

/**
 * The queue lives here rather than in the browser because people in the room will add to it
 * from their phones. That makes the server the only place that can hold one list, and it
 * makes `currentKey` server state: the browser watches it and plays what it is told, so a
 * skip from any device works without the desktop tab being involved in the decision.
 *
 * Nothing in here forgets a row on its own. The queue is the owner's set list: a corpus of
 * sixty-five tracks is played through and judged over days, and a history cap that trimmed
 * rows played more than thirty ago (kept for the size of the payload pushed to phones) took
 * the head of that list away. Only a person removes a row.
 */
class QueueStore {
	private state: QueueState = EMPTY_QUEUE;
	private listeners = new Set<Listener>();
	private loaded: Promise<void> | null = null;
	/** Serialises writes so two quick mutations cannot interleave into a torn file. */
	private writing: Promise<void> = Promise.resolve();

	async ready(): Promise<QueueState> {
		this.loaded ??= this.load();
		await this.loaded;
		return this.state;
	}

	private async load(): Promise<void> {
		try {
			const raw = JSON.parse(await readFile(QUEUE_FILE, 'utf8')) as QueueState;
			if (!Array.isArray(raw.items)) throw new Error('not a queue');
			// A row written before the genre was carried has one in the cache already, and a set
			// list where only the newest rows say what they are reads as a bug rather than as a
			// field that arrived late. The trust verdict is refreshed the same way.
			const entries = new Map((await readLibrary()).map((e) => [e.id, e]));
			const items = raw.items.map((i) => {
				const hit = i.trackId ? entries.get(i.trackId) : undefined;
				const genre = i.genre ?? hit?.genreFamily ?? undefined;
				// Anything that was mid-flight when the process died is not mid-flight now - and
				// a row left ready by an older build is not ready now: its analysis or its engine
				// show is the old version's, and replaying it as-is is how a fix never arrives.
				const stale = i.status === 'ready' && hit !== undefined && !hit.current;
				const revived =
					(i.status === 'ready' && !stale) || i.status === 'error'
						? i
						: { ...i, status: 'pending' as const, message: '' };
				const loungeOnly = hit
					? hit.gridTrust?.trusted === false && !hit.gridTrustOverride
					: revived.loungeOnly;
				const trustNote = hit
					? hit.gridTrust?.reasons.join('; ') || undefined
					: revived.trustNote;
				return { ...revived, genre, loungeOnly, trustNote };
			});
			this.state = { items, currentKey: raw.currentKey ?? null, revision: raw.revision ?? 0 };
		} catch {
			// No queue yet, or one this version cannot read. An empty queue is a fine start.
			this.state = EMPTY_QUEUE;
		}
	}

	get snapshot(): QueueState {
		return this.state;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Apply a transition, publish it, and persist it.
	 *
	 * Publishing before persisting on purpose: a listener waiting on a disk write to hear that
	 * a track finished would show a stale row for as long as the write takes.
	 */
	private commit(next: QueueState): QueueState {
		if (next === this.state) return this.state;
		this.state = next;
		for (const listener of this.listeners) listener(next);
		this.persist();
		return next;
	}

	private persist(): void {
		const snapshot = this.state;
		this.writing = this.writing
			.then(async () => {
				await mkdir(CACHE_DIR, { recursive: true });
				// Written beside and renamed, so a crash mid-write cannot leave a half file that
				// the next boot silently reads as an empty queue.
				const tmp = `${QUEUE_FILE}.${process.pid}.tmp`;
				await writeFile(tmp, JSON.stringify(snapshot, null, '\t'));
				await rename(tmp, QUEUE_FILE);
			})
			.catch(() => {
				// A queue that cannot be saved is still a queue that works this session.
			});
	}

	async add(inputs: NewItem[]): Promise<QueueState> {
		await this.ready();
		return this.commit(addItems(this.state, inputs, () => randomUUID(), Date.now()));
	}

	async remove(key: string): Promise<QueueState> {
		await this.ready();
		return this.commit(removeItem(this.state, key));
	}

	async move(key: string, to: number): Promise<QueueState> {
		await this.ready();
		return this.commit(moveItem(this.state, key, to));
	}

	async playNext(key: string): Promise<QueueState> {
		await this.ready();
		return this.commit(playNext(this.state, key));
	}

	async jump(key: string): Promise<QueueState> {
		await this.ready();
		return this.commit(jumpTo(this.state, key));
	}

	async step(dir: -1 | 1): Promise<QueueState> {
		await this.ready();
		return this.commit(step(this.state, dir));
	}

	async clear(keepCurrent: boolean): Promise<QueueState> {
		await this.ready();
		return this.commit(clearQueue(this.state, keepCurrent));
	}

	/** Used by the ingest runner to report progress against a row. */
	patch(key: string, patch: Partial<Omit<QueueItem, 'key'>>): QueueState {
		return this.commit(patchItem(this.state, key, patch));
	}
}

export const queue = new QueueStore();
