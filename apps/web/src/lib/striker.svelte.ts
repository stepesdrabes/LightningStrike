import { decodeBase64, readHearing, type Hearing, type HearingInner } from '@mv/core';
import type { StrikerEvent, StrikerGlimpse, StrikerGraph } from '$lib/types.ts';

/** One chunk of a live pass; times are this page's clock, for the animation. */
export interface LiveChunk {
	index: number;
	start: number;
	frames: number;
	cols: number;
	features: Uint8Array | null;
	/** Each column's minimum then maximum of the chunk's audio, -1..1 as 0..255. */
	wave: Uint8Array | null;
	heads: Uint8Array | null;
	activity: Uint8Array | null;
	/** Real activations, [cols][layers][k] signed bytes; empty when the session did not expose them. */
	inner: Uint8Array | null;
	ms: number | null;
	inAt: number | null;
	outAt: number | null;
}

/** A song going through Striker 2.0 now, or the one that last did. */
export interface LivePass {
	id: number;
	title: string;
	frames: number;
	/** How many chunks the song makes. */
	total: number;
	chunks: LiveChunk[];
	fps: number;
	/** The kept neurons and their link weights, once the first chunk has come back. */
	structure: HearingInner | null;
	beganAt: number;
	end: { ok: boolean; ms: number; at: number } | null;
}

/**
 * What the model view draws from: the installed graph's stages, the live pass from the server's
 * stream, and the playing song's recording. The canvas reads these every frame, so they are raw.
 */
class StrikerView {
	graph = $state.raw<StrikerGraph | null>(null);
	pass = $state.raw<LivePass | null>(null);
	hearing = $state.raw<{ trackId: string; hearing: Hearing } | null>(null);
	/** Bumped on every change, for the parts of the view that are markup. */
	version = $state(0);
	private stream: EventSource | null = null;
	private users = 0;
	private wanted: string | null = null;

	/** The first view opens the stream and reads the graph; the last one closes it. */
	attach(): () => void {
		if (this.users++ === 0) {
			this.stream = new EventSource('/api/striker/stream');
			this.stream.addEventListener('striker', (e) => this.receive(JSON.parse((e as MessageEvent).data) as StrikerEvent));
			if (!this.graph) void this.readGraph();
		}
		return () => {
			if (--this.users > 0) return;
			this.stream?.close();
			this.stream = null;
		};
	}

	private async readGraph(): Promise<void> {
		const res = await fetch('/api/striker/graph').catch(() => null);
		if (res?.ok) this.graph = (await res.json()) as StrikerGraph;
		this.version++;
	}

	private receive(event: StrikerEvent): void {
		const now = performance.now();
		if (event.type === 'pass') {
			const pass: LivePass = {
				id: event.pass.id, title: event.pass.title, frames: 0, total: 0, chunks: [], fps: 100, structure: null, beganAt: now,
				end: event.pass.end ? { ...event.pass.end, at: now } : null
			};
			for (const g of event.pass.glimpses) apply(pass, g, now);
			this.pass = pass;
		} else if (this.pass && this.pass.id === event.id) {
			if (event.type === 'glimpse') apply(this.pass, event.glimpse, now);
			else this.pass.end = { ok: event.ok, ms: event.ms, at: now };
		}
		this.version++;
	}

	/** The playing song's recording, if it was prepared after the model view began keeping them. */
	async follow(trackId: string | null): Promise<void> {
		if (trackId === this.wanted) return;
		this.wanted = trackId;
		if (!trackId) {
			this.hearing = null;
			this.version++;
			return;
		}
		const res = await fetch(`/api/track/${encodeURIComponent(trackId)}/hearing`).catch(() => null);
		if (this.wanted !== trackId) return;
		let hearing: Hearing | null = null;
		if (res?.ok) {
			try {
				hearing = readHearing(new Uint8Array(await res.arrayBuffer()));
			} catch {
				// A recording this page cannot read is the same as none.
			}
		}
		this.hearing = hearing ? { trackId, hearing } : null;
		this.version++;
	}

	/** The song that just prepared may be the one playing: read its recording again. */
	refresh(): void {
		const trackId = this.wanted;
		this.wanted = null;
		void this.follow(trackId);
	}
}

function apply(pass: LivePass, g: StrikerGlimpse, now: number): void {
	if (g.kind === 'begin') {
		pass.frames = g.frames;
		pass.total = g.chunks;
		pass.fps = g.fps;
		pass.chunks = [];
		pass.beganAt = now;
		return;
	}
	let chunk = pass.chunks.find((c) => c.index === g.index);
	if (!chunk) {
		chunk = {
			index: g.index, start: g.start, frames: g.frames, cols: g.cols, features: null, wave: null, heads: null,
			activity: null, inner: null, ms: null, inAt: null, outAt: null
		};
		pass.chunks.push(chunk);
		pass.chunks.sort((a, b) => a.index - b.index);
	}
	if (g.kind === 'input') {
		chunk.features = decodeBase64(g.features);
		chunk.wave = g.wave ? decodeBase64(g.wave) : null;
		chunk.inAt = now;
	} else {
		chunk.heads = decodeBase64(g.heads);
		chunk.activity = decodeBase64(g.activity);
		chunk.inner = g.inner ? decodeBase64(g.inner) : null;
		if (g.structure) pass.structure = g.structure;
		chunk.ms = g.ms;
		chunk.outAt = now;
	}
}

export const strikerView = new StrikerView();
