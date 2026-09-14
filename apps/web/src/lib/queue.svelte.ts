import { EMPTY_QUEUE, currentItem, type NewItem, type QueueState } from './queueModel.ts';

/** The server owns queue state; all edits return over SSE so concurrent guests stay consistent. */
export class QueueClient {
	state = $state<QueueState>(EMPTY_QUEUE);

	private source: EventSource | null = null;

	get current() {
		return currentItem(this.state);
	}

	get items() {
		return this.state.items;
	}

	connect(): void {
		if (this.source) return;
		const es = new EventSource('/api/queue/stream');
		es.addEventListener('queue', (ev) => {
			this.state = JSON.parse((ev as MessageEvent).data) as QueueState;
		});
		this.source = es;
	}

	dispose(): void {
		this.source?.close();
		this.source = null;
	}

	private post(body: Record<string, unknown>): Promise<Response> {
		return fetch('/api/queue', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	/** Use this POST's returned rows; concurrent SSE appends could belong to another caller. */
	async add(items: NewItem[]): Promise<QueueState | null> {
		const res = await this.post({ action: 'add', items });
		if (!res.ok) return null;
		return (await res.json()) as QueueState;
	}

	remove(key: string): Promise<Response> {
		return this.post({ action: 'remove', key });
	}

	move(key: string, to: number): Promise<Response> {
		return this.post({ action: 'move', key, to });
	}

	playNext(key: string): Promise<Response> {
		return this.post({ action: 'playNext', key });
	}

	jump(key: string): Promise<Response> {
		return this.post({ action: 'jump', key });
	}

	/** `from` names the row that ended, so a repeated or late report cannot skip another. */
	next(from?: string): Promise<Response> {
		return this.post({ action: 'next', ...(from ? { from } : {}) });
	}

	prev(): Promise<Response> {
		return this.post({ action: 'prev' });
	}

	clear(keepCurrent = true): Promise<Response> {
		return this.post({ action: 'clear', keepCurrent });
	}

	retry(key: string): Promise<Response> {
		return this.post({ action: 'retry', key });
	}

	/** Override the grid-trust verdict: run this row's authored show, and remember that. */
	runShow(key: string): Promise<Response> {
		return this.post({ action: 'runShow', key });
	}
}
