import { encodeBase64 } from '@mv/core';
import type { Striker2Glimpse } from '@mv/analysis';

/** A glimpse as the model view receives it, its byte arrays in base64. */
export type WireGlimpse =
	| Extract<Striker2Glimpse, { kind: 'begin' }>
	| (Omit<Extract<Striker2Glimpse, { kind: 'input' }>, 'features' | 'wave'> & { features: string; wave: string })
	| (Omit<Extract<Striker2Glimpse, { kind: 'output' }>, 'heads' | 'activity' | 'inner'>
		& { heads: string; activity: string; inner: string });

/** One song through Striker 2.0: every glimpse so far, and how it ended. */
export interface StrikerPass {
	id: number;
	title: string;
	glimpses: WireGlimpse[];
	end: { ok: boolean; ms: number } | null;
}

export type StrikerEvent =
	| { type: 'pass'; pass: StrikerPass }
	| { type: 'glimpse'; id: number; glimpse: WireGlimpse }
	| { type: 'end'; id: number; ok: boolean; ms: number };

function wire(g: Striker2Glimpse): WireGlimpse {
	if (g.kind === 'input') return { ...g, features: encodeBase64(g.features), wave: encodeBase64(g.wave) };
	if (g.kind === 'output') {
		return { ...g, heads: encodeBase64(g.heads), activity: encodeBase64(g.activity), inner: encodeBase64(g.inner) };
	}
	return g;
}

class StrikerLive {
	private latest: StrikerPass | null = null;
	private readonly listeners = new Set<(e: StrikerEvent) => void>();
	private next = 1;

	/** The latest pass first, so a view opened mid-song catches up, then everything after it. */
	subscribe(listener: (e: StrikerEvent) => void): () => void {
		if (this.latest) listener({ type: 'pass', pass: this.latest });
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: StrikerEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	/** One preparation; it is announced only once Striker 2.0 begins, which a cached song never does. */
	open(title: string): { glimpse(g: Striker2Glimpse): void; close(ok: boolean): void } {
		const id = this.next++;
		let pass: StrikerPass | null = null;
		let began = 0;
		return {
			glimpse: (g) => {
				const w = wire(g);
				if (g.kind === 'begin') {
					// A provider that fails mid-song starts the song again on the CPU: a fresh pass.
					pass = { id, title, glimpses: [w], end: null };
					began = performance.now();
					this.latest = pass;
					this.emit({ type: 'pass', pass });
				} else if (pass) {
					pass.glimpses.push(w);
					this.emit({ type: 'glimpse', id, glimpse: w });
				}
			},
			close: (ok) => {
				if (!pass || pass.end) return;
				pass.end = { ok, ms: Math.round(performance.now() - began) };
				this.emit({ type: 'end', id, ...pass.end });
			}
		};
	}
}

export const strikerLive = new StrikerLive();
