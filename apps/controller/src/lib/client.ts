/**
 * Serialize requests for the board's two sockets; coalesce slider edits and retry dropped
 * requests once. POST replies are authoritative.
 */

import type { Net } from './net.ts';
import { parseInfo, parseState, type DeviceInfo, type LightState, type Patch } from './protocol.ts';

const TIMEOUT_MS = 3000;
/** One retry, after long enough for the board to have finished closing the last socket. */
const RETRY_DELAY_MS = 250;

export type Link = 'idle' | 'sending' | 'ok' | 'lost';

interface ClientEvents {
	/** The board's own answer. Always preferred over anything predicted locally. */
	onState: (state: LightState) => void;
	onLink: (link: Link) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class DeviceClient {
	private queued: Patch | null = null;
	private inFlight = false;

	constructor(
		readonly host: string,
		private readonly net: Net,
		private readonly events: ClientEvents
	) {}

	/** True while a patch is in the air, including the sleep before its retry. */
	get busy(): boolean {
		return this.inFlight;
	}

	private url(path: string): string {
		return `http://${this.host}${path}`;
	}

	async info(): Promise<DeviceInfo | null> {
		return parseInfo(await this.net.get(this.url('/api/info'), TIMEOUT_MS));
	}

	/** A poll. Deliberately does not touch the link status: a missed poll is not a failed edit. */
	async readState(): Promise<LightState | null> {
		const state = parseState(await this.net.get(this.url('/api/state'), TIMEOUT_MS));
		if (state) this.events.onState(state);
		return state;
	}

	async identify(): Promise<boolean> {
		this.events.onLink('sending');
		const ok = (await this.net.post(this.url('/api/identify'), '', TIMEOUT_MS)) !== null;
		this.events.onLink(ok ? 'ok' : 'lost');
		return ok;
	}

	/** Fire and forget: the reply comes back through `onState`. */
	send(patch: Patch): void {
		this.queued = { ...this.queued, ...patch };
		void this.flush();
	}

	private async flush(): Promise<void> {
		if (this.inFlight || !this.queued) return;
		this.inFlight = true;
		this.events.onLink('sending');

		try {
			while (this.queued) {
				const patch = this.queued;
				this.queued = null;

				let reply = await this.net.post(
					this.url('/api/state'),
					JSON.stringify(patch),
					TIMEOUT_MS
				);
				if (reply === null) {
					await sleep(RETRY_DELAY_MS);
					// Anything the user did while that was in the air wins over the retry.
					const merged: Patch = { ...patch, ...(this.queued ?? {}) };
					this.queued = null;
					reply = await this.net.post(
						this.url('/api/state'),
						JSON.stringify(merged),
						TIMEOUT_MS
					);
				}

				if (reply === null) {
					// Drop a failed patch to avoid retrying an offline board forever; polling reconciles state.
					this.events.onLink('lost');
					return;
				}
				const state = parseState(reply);
				if (state) this.events.onState(state);
				this.events.onLink('ok');
			}
		} finally {
			this.inFlight = false;
		}
	}
}
