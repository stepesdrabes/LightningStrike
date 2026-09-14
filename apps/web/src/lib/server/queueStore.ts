import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CACHE_DIR, readLibrary } from '@mv/analysis';
import {
	EMPTY_QUEUE,
	addItems,
	advanceFrom,
	clearQueue,
	jumpTo,
	moveItem,
	patchItem,
	playNext,
	removeItem,
	replaceItems,
	step,
	type NewItem,
	type QueueItem,
	type QueueState
} from '$lib/queueModel.ts';

const QUEUE_FILE = join(CACHE_DIR, 'queue.json');

type Listener = (state: QueueState) => void;

/**
 * The server owns the shared queue and currentKey. Retain every row until explicitly removed;
 * this set list also supports multi-session corpus review.
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
			// Refresh cached genre and grid trust for older queue rows.
			const entries = new Map((await readLibrary()).map((e) => [e.id, e]));
			const items = raw.items.map((i) => {
				const hit = i.trackId ? entries.get(i.trackId) : undefined;
				const genre = i.genre ?? hit?.genreFamily ?? undefined;
				// Reset interrupted work and invalidate rows prepared by stale analysis/engine versions.
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

	/** Publish before persistence so disk latency cannot delay queue state updates. */
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
				// Rename a complete temporary file so crashes cannot erase the queue with a partial write.
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

	/** Advance past a row only if it is still the current one. */
	async advanceFrom(key: string): Promise<QueueState> {
		await this.ready();
		return this.commit(advanceFrom(this.state, key));
	}

	async replace(items: QueueItem[], currentKey: string | null): Promise<QueueState> {
		await this.ready();
		return this.commit(replaceItems(this.state, items, currentKey));
	}

	/** Apply a whole-queue change computed from the latest state; an identical result commits nothing. */
	async transform(change: (state: QueueState) => QueueState): Promise<QueueState> {
		await this.ready();
		return this.commit(change(this.state));
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
