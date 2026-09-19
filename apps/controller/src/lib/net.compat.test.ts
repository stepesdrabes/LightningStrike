import { afterEach, expect, it, vi } from 'vitest';
import { browserNet } from './net.ts';

const any = AbortSignal.any;
afterEach(() => {
	Object.defineProperty(AbortSignal, 'any', { value: any, configurable: true, writable: true });
	vi.unstubAllGlobals();
});

/** iOS before 17.4 has no AbortSignal.any, and a thrown name here would fail every request. */
it('still reaches the board on a phone without AbortSignal.any', async () => {
	Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true });
	vi.stubGlobal('fetch', async () => new Response('{"ok":true}', { status: 200 }));

	const controller = new AbortController();
	expect(await browserNet.get('http://board/api/info', 500, controller.signal)).toEqual({ ok: true });
	expect(await browserNet.post('http://board/api/state', '{}', 500, controller.signal)).toEqual({
		ok: true
	});
});
