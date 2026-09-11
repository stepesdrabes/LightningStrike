type Connect<T> = (
	send: (value: T) => void,
	onClose: (cleanup: () => void) => void
) => void | Promise<void>;

export function eventStream<T>(request: Request, event: string, connect: Connect<T>): Response {
	const encoder = new TextEncoder();
	const cleanups: (() => void)[] = [];
	let closed = false;
	let controller: ReadableStreamDefaultController<Uint8Array>;
	const onClose = (cleanup: () => void) => {
		if (closed) cleanup();
		else cleanups.push(cleanup);
	};
	const release = () => {
		if (closed) return false;
		closed = true;
		for (const cleanup of cleanups.splice(0)) cleanup();
		return true;
	};
	const close = () => {
		if (!release()) return;
		try { controller.close(); } catch { /* The reader may already have cancelled. */ }
	};
	const write = (text: string) => {
		if (closed) return;
		try { controller.enqueue(encoder.encode(text)); } catch { close(); }
	};
	const send = (value: T) => {
		if (closed) return;
		try { write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); } catch { close(); }
	};
	const stream = new ReadableStream<Uint8Array>({
		async start(output) {
			controller = output;
			request.signal.addEventListener('abort', close);
			onClose(() => request.signal.removeEventListener('abort', close));
			if (request.signal.aborted) { close(); return; }
			try {
				const setup = connect(send, onClose);
				if (!closed) {
					const heartbeat = setInterval(() => write(': keep-alive\n\n'), 20_000);
					onClose(() => clearInterval(heartbeat));
				}
				await setup;
			} catch (error) {
				if (release()) controller.error(error);
			}
		},
		cancel: close
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	});
}
