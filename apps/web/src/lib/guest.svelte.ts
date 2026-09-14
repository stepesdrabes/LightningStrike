import type { QueueState } from './queueModel.ts';
import { EMPTY_QUEUE } from './queueModel.ts';

const STORE_KEY = 'lightningstrike.guest';

export interface Guest {
	token: string;
	name: string;
}

/** Persist the guest locally: the token grants access and the name identifies removable rows. */
export function loadGuest(): Guest | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(STORE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<Guest>;
		if (!parsed.token || !parsed.name) return null;
		return { token: parsed.token, name: parsed.name };
	} catch {
		return null;
	}
}

export function saveGuest(guest: Guest): void {
	localStorage.setItem(STORE_KEY, JSON.stringify(guest));
}

/** Guest changes use /api/guest; the shared SSE stream remains authoritative. */
export class GuestQueue {
	state = $state<QueueState>(EMPTY_QUEUE);
	failure = $state('');

	private source: EventSource | null = null;

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

	private async post(guest: Guest, body: Record<string, unknown>): Promise<boolean> {
		this.failure = '';
		try {
			const res = await fetch('/api/guest', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...guest, ...body })
			});
			if (res.ok) return true;
			const text = await res.text();
			try {
				this.failure = (JSON.parse(text) as { message?: string }).message ?? text.slice(0, 200);
			} catch {
				this.failure = text.slice(0, 200);
			}
			return false;
		} catch (e) {
			this.failure = (e as Error).message;
			return false;
		}
	}

	add(guest: Guest, item: Record<string, unknown>): Promise<boolean> {
		return this.post(guest, { action: 'add', item });
	}

	remove(guest: Guest, key: string): Promise<boolean> {
		return this.post(guest, { action: 'remove', key });
	}
}
