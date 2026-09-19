/**
 * Serialize requests for the board's few sockets; coalesce edits and keep retrying a refused
 * one until it lands or is superseded. POST replies are authoritative.
 */

import type { Net } from './net.ts';
import { parseInfo, parseState, type DeviceInfo, type LightState, type Patch } from './protocol.ts';

const TIMEOUT_MS = 3000;
/**
 * A busy board refuses the connection outright, and the phone's own stack takes 200 ms to a
 * second to report that. The listener it spent on the last request is back within about a
 * second, so the retries start there and back off from it; the last delay repeats.
 */
const RETRY_MS: readonly number[] = [300, 600, 1200, 2000];
/** Continuous failure before an edit is reported as lost. It keeps trying either way. */
const LOST_AFTER_MS = 6000;
/** Long enough for a board to reboot and rejoin; past it the edit is dropped. */
const GIVE_UP_AFTER_MS = 30000;
const IDENTIFY_RETRY_MS = 300;

export type Link = 'idle' | 'sending' | 'ok' | 'lost';

interface ClientEvents {
	/** The board's own answer. Always preferred over anything predicted locally. */
	onState: (state: LightState) => void;
	onLink: (link: Link) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class DeviceClient {
	private queued: Patch | null = null;
	/** The patch on the wire right now, so a reply to an older one can be told from the truth. */
	private sent: Patch | null = null;
	private inFlight = false;
	private polling: Promise<LightState | null> | null = null;

	constructor(
		readonly host: string,
		private readonly net: Net,
		private readonly events: ClientEvents
	) {}

	/** True while a patch is in the air, including the sleeps between retries. */
	get busy(): boolean {
		return this.inFlight;
	}

	/** Everything asked for that the board has not confirmed yet, newest value winning. */
	get pending(): Patch | null {
		if (!this.sent && !this.queued) return null;
		return { ...this.sent, ...this.queued };
	}

	private url(path: string): string {
		return `http://${this.host}${path}`;
	}

	async info(): Promise<DeviceInfo | null> {
		return parseInfo(await this.net.get(this.url('/api/info'), TIMEOUT_MS));
	}

	/**
	 * A poll. Deliberately does not touch the link status: a missed poll is not a failed edit.
	 * A second caller joins the answer already in the air rather than starting its own, and
	 * rather than being told null, which the caller cannot tell from a board that went quiet.
	 */
	readState(): Promise<LightState | null> {
		this.polling ??= this.read().finally(() => (this.polling = null));
		return this.polling;
	}

	private async read(): Promise<LightState | null> {
		const state = parseState(await this.net.get(this.url('/api/state'), TIMEOUT_MS));
		if (state) this.events.onState(state);
		return state;
	}

	/** One retry and no verdict on the link: a pulse that did not happen proves nothing. */
	async identify(): Promise<boolean> {
		const url = this.url('/api/identify');
		if ((await this.net.post(url, '', TIMEOUT_MS)) !== null) return true;
		await sleep(IDENTIFY_RETRY_MS);
		return (await this.net.post(url, '', TIMEOUT_MS)) !== null;
	}

	/** Fire and forget: the reply comes back through `onState`. */
	send(patch: Patch): void {
		this.queued = { ...this.queued, ...patch };
		void this.flush();
	}

	private async flush(): Promise<void> {
		if (this.inFlight || !this.queued) return;
		this.inFlight = true;

		try {
			this.events.onLink('sending');
			let failedSince: number | null = null;
			let attempt = 0;
			while (this.queued) {
				const patch: Patch = this.queued;
				this.queued = null;
				this.sent = patch;
				const reply = await this.net.post(
					this.url('/api/state'),
					JSON.stringify(patch),
					TIMEOUT_MS
				);
				this.sent = null;

				if (reply === null) {
					// Back in the queue under whatever arrived meanwhile: the newest wish wins.
					this.queued = { ...patch, ...(this.queued ?? {}) };
					const now = Date.now();
					failedSince ??= now;
					if (now - failedSince >= GIVE_UP_AFTER_MS) {
						this.queued = null;
						this.events.onLink('lost');
						return;
					}
					if (now - failedSince >= LOST_AFTER_MS) this.events.onLink('lost');
					await sleep(RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)] as number);
					continue;
				}

				failedSince = null;
				attempt = 0;
				const state = parseState(reply);
				if (state) this.events.onState(state);
				this.events.onLink('ok');
			}
		} finally {
			this.inFlight = false;
			this.sent = null;
		}
	}
}
