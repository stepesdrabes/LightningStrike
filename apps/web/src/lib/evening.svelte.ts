import { IDLE_VIEW, type EveningView, type RowLightingView } from './evening/view.ts';

/** The host's view of the evening; the server owns it and every change returns over SSE. */
export class EveningClient {
	view = $state<EveningView>(IDLE_VIEW);
	/** The last action's failure, for the rail to show until the next action. */
	failure = $state('');

	private source: EventSource | null = null;

	get live(): boolean {
		return this.view.status === 'running' || this.view.status === 'rehearsal';
	}

	connect(): void {
		if (this.source) return;
		const es = new EventSource('/api/evening/stream');
		es.addEventListener('evening', (ev) => {
			this.view = JSON.parse((ev as MessageEvent).data) as EveningView;
		});
		this.source = es;
	}

	dispose(): void {
		this.source?.close();
		this.source = null;
	}

	private async post(body: Record<string, unknown>): Promise<boolean> {
		this.failure = '';
		try {
			const res = await fetch('/api/evening', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) return true;
			this.failure = await reason(res);
		} catch (e) {
			this.failure = (e as Error).message;
		}
		return false;
	}

	open(file: string) {
		return this.post({ action: 'open', file });
	}
	close() {
		return this.post({ action: 'close' });
	}
	reload() {
		return this.post({ action: 'reload' });
	}
	start() {
		return this.post({ action: 'start' });
	}
	rehearse() {
		return this.post({ action: 'rehearse' });
	}
	go() {
		return this.post({ action: 'go' });
	}
	holdAfter() {
		return this.post({ action: 'holdAfter' });
	}
	skip(direction: 1 | -1) {
		return this.post({ action: 'skip', direction });
	}
	jump(key: string) {
		return this.post({ action: 'jump', key });
	}
	seek(time: number) {
		return this.post({ action: 'seek', time });
	}
	bail() {
		return this.post({ action: 'bail' });
	}
	end() {
		return this.post({ action: 'end' });
	}
	restore() {
		return this.post({ action: 'restore' });
	}
	prepare() {
		return this.post({ action: 'prepare' });
	}

	/** Fire and forget: a lost report is replaced a few seconds later. */
	progress(key: string, position: number, playing: boolean): void {
		void fetch('/api/evening', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'progress', key, position, playing })
		}).catch(() => {});
	}

	async lighting(key: string): Promise<RowLightingView> {
		const res = await fetch(`/api/evening/row/${encodeURIComponent(key)}`);
		if (!res.ok) throw new Error(await reason(res));
		return (await res.json()) as RowLightingView;
	}
}

/** SvelteKit sends errors as JSON with a message; anything else is shown as text. */
async function reason(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const parsed = JSON.parse(text) as { message?: string };
		if (parsed.message) return parsed.message;
	} catch {
		// Plain text.
	}
	return text.slice(0, 240);
}
