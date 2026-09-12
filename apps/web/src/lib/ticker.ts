/**
 * A repeating timer that keeps its rate in a hidden tab. The page's own timers are throttled
 * to once a second there, and to once a minute after five minutes, which is enough to let the
 * hardware think the browser has gone; a worker's timers are not. Returns the stop function.
 */
export function every(ms: number, fn: () => void): () => void {
	const period = Math.max(10, Math.round(ms));
	if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
		const id = setInterval(fn, period);
		return () => clearInterval(id);
	}
	const url = URL.createObjectURL(
		new Blob([`setInterval(() => postMessage(0), ${period});`], { type: 'text/javascript' })
	);
	let worker: Worker;
	try {
		worker = new Worker(url);
	} catch {
		URL.revokeObjectURL(url);
		const id = setInterval(fn, period);
		return () => clearInterval(id);
	}
	worker.onmessage = () => fn();
	return () => {
		worker.terminate();
		URL.revokeObjectURL(url);
	};
}
