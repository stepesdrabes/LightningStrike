import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventStream } from './eventStream.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const decode = (value?: Uint8Array) => new TextDecoder().decode(value);

describe('event streams', () => {
	it('preserves SSE frames, ordering, headers and idle heartbeat', async () => {
		vi.useFakeTimers();
		const abort = new AbortController();
		let publish!: (value: { count: number }) => void;
		const unsubscribe = vi.fn();
		const response = eventStream<{ count: number }>(new Request('http://localhost', { signal: abort.signal }), 'queue', (send, onClose) => {
			publish = send;
			onClose(unsubscribe);
			send({ count: 1 });
		});
		expect(Object.fromEntries(response.headers)).toEqual({
			'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive'
		});
		const reader = response.body!.getReader();
		expect(decode((await reader.read()).value)).toBe('event: queue\ndata: {"count":1}\n\n');
		publish({ count: 2 });
		expect(decode((await reader.read()).value)).toBe('event: queue\ndata: {"count":2}\n\n');
		await vi.advanceTimersByTimeAsync(20_000);
		expect(decode((await reader.read()).value)).toBe(': keep-alive\n\n');
		abort.abort();
		expect(await reader.read()).toEqual({ value: undefined, done: true });
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['abort', 'cancel'] as const)('releases subscription and hardware watch exactly once on %s', async (reason) => {
		vi.useFakeTimers();
		const abort = new AbortController();
		const unsubscribe = vi.fn();
		const unwatch = vi.fn();
		const response = eventStream(new Request('http://localhost', { signal: abort.signal }), 'hardware', (_, onClose) => {
			onClose(unsubscribe); onClose(unwatch);
		});
		if (reason === 'abort') abort.abort();
		await response.body!.cancel();
		abort.abort();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(unwatch).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not subscribe when the request is already aborted', async () => {
		const abort = new AbortController();
		abort.abort();
		const connect = vi.fn();
		const response = eventStream(new Request('http://localhost', { signal: abort.signal }), 'queue', connect);
		expect(connect).not.toHaveBeenCalled();
		expect(await response.body!.getReader().read()).toEqual({ value: undefined, done: true });
	});

	it('propagates setup failures after releasing acquired resources', async () => {
		vi.useFakeTimers();
		const cleanup = vi.fn();
		const failure = new Error('queue initialization failed');
		const response = eventStream(new Request('http://localhost'), 'queue', async (_, onClose) => {
			onClose(cleanup);
			throw failure;
		});
		await expect(response.body!.getReader().read()).rejects.toBe(failure);
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cleans up resources acquired after an asynchronous setup was cancelled', async () => {
		vi.useFakeTimers();
		let resolve!: () => void;
		const ready = new Promise<void>((done) => { resolve = done; });
		const early = vi.fn();
		const late = vi.fn();
		const response = eventStream(new Request('http://localhost'), 'queue', async (send, onClose) => {
			onClose(early);
			await ready;
			onClose(late);
			send({ ready: true });
		});
		await response.body!.cancel();
		resolve();
		await ready;
		expect(early).toHaveBeenCalledTimes(1);
		expect(late).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(['event', 'heartbeat'] as const)('releases resources if the controller rejects an %s frame', async (frame) => {
		vi.useFakeTimers();
		const NativeStream: new (source: UnderlyingDefaultSource<Uint8Array>) => ReadableStream<Uint8Array> = ReadableStream;
		vi.stubGlobal('ReadableStream', class extends NativeStream {
			constructor(source: UnderlyingDefaultSource<Uint8Array>) {
				super({ ...source, start(controller) {
					return source.start?.({
						desiredSize: controller.desiredSize,
						enqueue() { throw new TypeError('disconnected'); },
						close: () => controller.close(),
						error: (error) => controller.error(error)
					});
				} });
			}
		});
		const cleanup = vi.fn();
		let publish!: (value: number) => void;
		const response = eventStream<number>(new Request('http://localhost'), 'hardware', (send, onClose) => {
			publish = send;
			onClose(cleanup);
		});
		if (frame === 'event') publish(1);
		else await vi.advanceTimersByTimeAsync(20_000);
		await response.body!.cancel();
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});
