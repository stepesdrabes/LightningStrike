import {
	DEFAULT_ROOM,
	RoomDirector,
	SLOT,
	compileGenerated,
	EffectRegistry,
	buildGeometry,
	sample,
	type AmbientSettings,
	type Geometry,
	type Show,
	type ShowFrame,
	type TrackAnalysis
} from '@mv/core';
import type { RoomRenderer } from '@mv/preview3d';

export interface Readout {
	fps: number;
	position: number;
	duration: number;
	playing: boolean;
	bar: number;
	section: string;
	/** True once the room has handed over to the ambient scenes. */
	resting: boolean;
	scene: string;
	/** CSS colours sampled from the live palette; lounge cue palettes may have no source hues. */
	roomBase: string;
	roomAccent: string;
}

/** Keep the render hot path unproxied; publish only the small Readout at 20 Hz. */
export class Viz {
	readonly geometry: Geometry = buildGeometry(DEFAULT_ROOM);
	readonly registry = new EffectRegistry();
	readonly director = new RoomDirector(this.geometry, this.registry);
	readonly spec = DEFAULT_ROOM;

	roomRenderer: RoomRenderer | null = null;
	analysis: TrackAnalysis | null = null;
	show: Show | null = null;

	lounge = false;
	rest = true;

	onReadout: ((r: Readout) => void) | null = null;
	/** Fires only on natural completion; seeking and pausing also stop source nodes. */
	onEnded: (() => void) | null = null;

	private ctx: AudioContext | null = null;
	private buffer: AudioBuffer | null = null;
	private source: AudioBufferSourceNode | null = null;
	private gain: GainNode | null = null;
	private startedAt = 0;
	private startOffset = 0;
	private playing = false;

	private raf = 0;
	private last = 0;
	private fpsAcc = 0;
	private fpsFrames = 0;
	private fps = 0;
	private readoutAcc = 0;
	private readonly rgb: [number, number, number] = [0, 0, 0];

	get duration(): number {
		return this.buffer?.duration ?? this.analysis?.duration ?? 0;
	}

	get position(): number {
		if (!this.ctx) return this.startOffset;
		if (!this.playing) return this.startOffset;
		return Math.min(this.ctx.currentTime - this.startedAt + this.startOffset, this.duration);
	}

	get isPlaying(): boolean {
		return this.playing;
	}

	/** The show's own player, for the cue readout. The room may or may not be showing it. */
	get player() {
		return this.director.player;
	}

	set ambient(s: AmbientSettings) {
		this.director.ambientSettings = s;
	}

	/** The cover's dominant hue, for a room following a track that has no show yet. */
	set artHue(h: number | null) {
		this.director.ambient.artHue = h;
	}

	/** Skip to the next ambient scene. */
	nextScene(): void {
		this.director.ambient.next();
	}

	/** One slot of the room's live palette, as CSS. Allocation-free apart from the string. */
	private swatch(slot: number): string {
		const [r, g, b] = sample(this.director.ambient.colour.palette, slot, 1, this.rgb);
		const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
		return `rgb(${byte(r)} ${byte(g)} ${byte(b)})`;
	}

	async loadAudio(bytes: ArrayBuffer): Promise<void> {
		// Stop the previous source before replacing its audio buffer.
		this.pause();
		this.ctx ??= new AudioContext();
		this.gain ??= (() => {
			const g = this.ctx!.createGain();
			g.connect(this.ctx!.destination);
			return g;
		})();
		this.buffer = await this.ctx.decodeAudioData(bytes);
		this.startOffset = 0;
	}

	loadShow(analysis: TrackAnalysis, show: Show): void {
		this.analysis = analysis;
		this.show = show;
		this.registry.clearGenerated();
		for (const gen of show.generatedEffects) {
			const compiled = compileGenerated(gen, this.geometry);
			// Rejected generated effects leave only their own layers dark.
			if (compiled.def) this.registry.add(compiled.def);
			else console.warn(`generated effect "${gen.id}" rejected`, compiled.failures);
		}
		this.director.load(analysis, show);
	}

	/** Drop the current show without dropping the audio, for a track that has none yet. */
	clearShow(): void {
		this.analysis = null;
		this.show = null;
		this.registry.clearGenerated();
		this.director.clearShow();
	}

	setVolume(v: number): void {
		if (this.gain) this.gain.gain.value = v;
	}

	async play(): Promise<void> {
		if (!this.ctx || !this.buffer || this.playing) return;
		await this.ctx.resume();
		const src = this.ctx.createBufferSource();
		src.buffer = this.buffer;
		src.connect(this.gain!);
		src.onended = () => {
			if (this.source !== src) return;
			// A seek stops the node too, so reaching the end is what distinguishes the two.
			const finished = this.position >= this.duration - 0.25;
			this.pause();
			if (finished) {
				this.startOffset = 0;
				this.onEnded?.();
			}
		};
		src.start(0, Math.min(this.startOffset, this.buffer.duration - 0.01));
		this.source = src;
		this.startedAt = this.ctx.currentTime;
		this.playing = true;
	}

	pause(): void {
		if (!this.playing) return;
		this.startOffset = this.position;
		this.playing = false;
		this.source?.stop();
		this.source?.disconnect();
		this.source = null;
	}

	async toggle(): Promise<void> {
		if (this.playing) this.pause();
		else await this.play();
	}

	seek(t: number): void {
		const target = Math.max(0, Math.min(t, this.duration));
		const wasPlaying = this.playing;
		this.pause();
		this.startOffset = target;
		this.player.reset();
		if (wasPlaying) void this.play();
	}

	start(): void {
		if (this.raf) return;
		this.last = performance.now();
		const tick = (now: number) => {
			this.raf = requestAnimationFrame(tick);
			// Clamped so a backgrounded tab does not teleport every envelope on return.
			const dt = Math.min((now - this.last) / 1000, 0.05);
			this.last = now;
			this.frame(dt);
		};
		this.raf = requestAnimationFrame(tick);
	}

	stop(): void {
		if (!this.raf) return;
		cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	dispose(): void {
		this.stop();
		this.pause();
		this.roomRenderer?.dispose();
		void this.ctx?.close();
	}

	private frame(dt: number): void {
		const frame: ShowFrame = this.director.update(this.heardPosition, dt, {
			playing: this.playing,
			hasShow: this.show !== null,
			lounge: this.lounge,
			rest: this.rest
		});
		this.roomRenderer?.render(this.director.bytes, dt, this.director.bounce);
		this.publishReadout(dt, frame);
	}

	/**
	 * Audio position minus output latency. Rendering and hardware sync follow
	 * this heard instant.
	 */
	get heardPosition(): number {
		const latency =
			(this.ctx as (AudioContext & { outputLatency?: number }) | null)?.outputLatency ??
			this.ctx?.baseLatency ??
			0.02;
		return this.position - latency;
	}

	private publishReadout(dt: number, frame: ShowFrame): void {
		this.fpsAcc += dt;
		this.fpsFrames++;
		if (this.fpsAcc >= 0.5) {
			this.fps = this.fpsFrames / this.fpsAcc;
			this.fpsAcc = 0;
			this.fpsFrames = 0;
		}

		this.readoutAcc += dt;
		if (this.readoutAcc < 0.05) return;
		this.readoutAcc = 0;
		const f = frame;
		this.onReadout?.({
			fps: Math.round(this.fps),
			// Playing indicators follow heard audio; paused audio has no output latency.
			position: this.playing ? this.heardPosition : this.position,
			duration: this.duration,
			playing: this.playing,
			bar: f.barIndex,
			section: f.section,
			resting: this.director.resting,
			scene: this.director.sceneName,
			roomBase: this.swatch(SLOT.base),
			roomAccent: this.swatch(SLOT.accent)
		});
	}
}
