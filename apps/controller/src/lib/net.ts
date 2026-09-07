/**
 * The one place `fetch` is called.
 *
 * Behind an interface so discovery and the send queue can be tested without a network or a
 * board: everything above this file takes a `Net` and never reaches for the global.
 */

export interface Net {
	/** Resolves to the parsed JSON body, or null for any failure at all. */
	get(url: string, timeoutMs: number): Promise<unknown>;
	/** Resolves to the parsed JSON body on 2xx, or null. */
	post(url: string, body: string, timeoutMs: number): Promise<unknown>;
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

export const browserNet: Net = {
	async get(url, timeoutMs) {
		try {
			return await json(await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }));
		} catch {
			return null;
		}
	},

	async post(url, body, timeoutMs) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				// text/plain keeps this a simple request. The API reads the body as JSON whatever
				// the type says, and application/json would add a preflight round trip to a board
				// that serves one connection at a time.
				headers: { 'content-type': 'text/plain' },
				body,
				signal: AbortSignal.timeout(timeoutMs)
			});
			return await json(res);
		} catch {
			return null;
		}
	}
};

/** Runs `work` over `items` with at most `limit` in flight. Order of results is not preserved. */
export async function pooled<T>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const i = next++;
			const item = items[i];
			if (item === undefined) return;
			await work(item);
		}
	});
	await Promise.all(runners);
}
