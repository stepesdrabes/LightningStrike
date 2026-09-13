import { reviewPosition, type DrumKind, type DrumReview } from './drumReview.ts';

export class DrumReviewPlayer {
	private context = new AudioContext();
	private buffers: AudioBuffer[] = [];
	private sources: AudioBufferSourceNode[] = [];
	private gains = [this.context.createGain(), this.context.createGain(), this.context.createGain()];
	private anchor = 0;
	private offset = 0;
	private start = 0;
	private end = 0;
	private looping = false;
	playing = false;
	constructor() {
		// Resume in the initiating click before fetch/decode awaits, including Safari/WKWebView.
		void this.context.resume();
		for (const gain of this.gains) gain.connect(this.context.destination);
		this.gains[0].gain.value = 0.65;
		this.gains[1].gain.value = 0;
		this.gains[2].gain.value = 0.18;
	}
	async load(review: DrumReview, signal: AbortSignal): Promise<void> {
		const response = await fetch(`/api/track/${encodeURIComponent(review.trackId)}/audio?v=${review.audioHash}`,
			{ signal, cache: 'no-store' });
		if (!response.ok) throw new Error('Could not load this song.');
		const bytes = await response.arrayBuffer();
		const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
			.map((b) => b.toString(16).padStart(2, '0')).join('');
		if (hash !== review.audioHash) throw new Error('The song changed. Reload before listening.');
		const audio = await this.context.decodeAudioData(bytes);
		if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
		this.buffers = [audio];
		// All three buffers share the same sample clock and loop boundaries, including silence.
		for (const kind of ['kick', 'snare'] as const) {
			const clicks = this.context.createBuffer(1, audio.length, audio.sampleRate);
			const pcm = clicks.getChannelData(0);
			const length = Math.round(audio.sampleRate * 0.023);
			for (const time of review.markers[kind].times) {
				const index = Math.round(time * audio.sampleRate);
				for (let i = 0; i < length && index + i < pcm.length; i++) {
					const t = i / audio.sampleRate;
					pcm[index + i] += Math.sin(2 * Math.PI * (kind === 'kick' ? 620 : 1900) * t)
						* Math.exp(-t * 190) * Math.min(1, i / 12);
				}
			}
			this.buffers.push(clicks);
		}
	}
	get ready(): boolean { return this.buffers.length === 3; }
	get duration(): number { return this.buffers[0]?.duration ?? 0; }
	get position(): number {
		if (!this.playing) return this.offset;
		return reviewPosition(this.context.currentTime - this.anchor, this.offset,
			this.start, this.end, this.looping);
	}
	setClicks(kind: DrumKind, enabled: boolean): void {
		this.gains[kind === 'kick' ? 1 : 2].gain.setValueAtTime(enabled ? 0.18 : 0, this.context.currentTime);
	}
	setMusic(volume: number): void { this.gains[0].gain.value = Math.max(0, Math.min(0.8, volume)); }
	async play(offset: number, range: DrumReview['range'], looping: boolean): Promise<void> {
		if (!this.ready) return;
		await this.context.resume();
		this.pause();
		this.looping = looping;
		this.start = looping ? range.start : 0;
		this.end = Math.min(looping ? range.end : this.duration, this.duration);
		this.offset = Math.max(this.start, Math.min(this.end - 0.001, offset));
		this.anchor = this.context.currentTime + 0.03;
		this.sources = this.buffers.map((buffer, i) => {
			const source = this.context.createBufferSource();
			source.buffer = buffer;
			source.loop = looping;
			source.loopStart = this.start;
			source.loopEnd = this.end;
			source.connect(this.gains[i]);
			source.start(this.anchor, this.offset);
			if (!looping) source.stop(this.anchor + this.end - this.offset);
			return source;
		});
		this.playing = true;
	}
	pause(): void {
		this.offset = this.position;
		this.playing = false;
		for (const source of this.sources) { source.stop(); source.disconnect(); }
		this.sources = [];
	}
	async close(): Promise<void> {
		this.pause(); this.buffers = [];
		if (this.context.state !== 'closed') await this.context.close();
	}
}
