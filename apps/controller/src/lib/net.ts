/** Inject networking so discovery and queued edits can be tested without a board. */

export interface Net {
	/** Resolves to the parsed JSON body, or null for any failure at all. */
	get(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown>;
	/** Resolves to the parsed JSON body on 2xx, or null. */
	post(url: string, body: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown>;
}

async function json(res: Response): Promise<unknown> {
	if (!res.ok) return null;
	if (res.status === 204) return {};
	try {
		return await res.json();
	} catch {
		return null;
	}
}

/**
 * A timeout the caller can also cancel. Without the caller's signal a stale sweep's requests
 * keep running and keep reporting boards into a room that has moved on. `AbortSignal.any` is
 * newer than the phones this is meant for, and losing cancellation there is worth far less
 * than losing every request to a thrown name.
 */
function deadline(timeoutMs: number, signal?: AbortSignal): AbortSignal {
	const timer = AbortSignal.timeout(timeoutMs);
	if (!signal || typeof AbortSignal.any !== 'function') return timer;
	return AbortSignal.any([timer, signal]);
}

export const browserNet: Net = {
	async get(url, timeoutMs, signal) {
		try {
			return await json(await fetch(url, { signal: deadline(timeoutMs, signal) }));
		} catch {
			return null;
		}
	},

	async post(url, body, timeoutMs, signal) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				// text/plain avoids a CORS preflight on the board's serial HTTP server; it still parses JSON.
				headers: { 'content-type': 'text/plain' },
				body,
				signal: deadline(timeoutMs, signal)
			});
			return await json(res);
		} catch {
			return null;
		}
	}
};

/**
 * Runs `work` over `items` with at most `limit` in flight, never rejecting: one failed probe
 * must not abandon a sweep with its other runners still knocking. Order of results is not
 * preserved.
 */
export async function pooled<T>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<void>,
	signal?: AbortSignal
): Promise<void> {
	let next = 0;
	const runners = Array.from({ length: Math.max(0, Math.min(limit, items.length)) }, async () => {
		while (next < items.length && !signal?.aborted) {
			await work(items[next++] as T).catch(() => {});
		}
	});
	await Promise.all(runners);
}
