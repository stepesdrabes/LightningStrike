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
	type RoomSync,
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

type Ending = { at: number; seconds: number };

/** Equal-power crossfade curves, so the sum of two uncorrelated songs holds its loudness. */
const FADE_POINTS = 64;
const FADE_IN = Float32Array.from({ length: FADE_POINTS }, (_, i) => Math.sin(((i / (FADE_POINTS - 1)) * Math.PI) / 2));
const FADE_OUT = Float32Array.from({ length: FADE_POINTS }, (_, i) => Math.cos(((i / (FADE_POINTS - 1)) * Math.PI) / 2));

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
	/** A crossfade began: the next row's audio is now what plays. */
	onHandover: (() => void) | null = null;

	private ctx: AudioContext | null = null;
	private buffer: AudioBuffer | null = null;
	private source: AudioBufferSourceNode | null = null;
	private gain: GainNode | null = null;
	/** Between a source and the volume, so a row's own fade never fights the volume slider. */
	private rowGain: GainNode | null = null;
	/** Seconds of silence a silent evening row plays on the audio clock, or null for music. */
	private silence: number | null = null;
	private quiet: AudioBuffer | null = null;
	/** Where a row ends before its audio does, fading out over `fadeFor` seconds. */
	private stopAt: number | null = null;
	private fadeFor = 0;
	/** The row's own level under the volume, 0..1: a narration can sit below the music. */
	private level = 1;
	/** The next row, to fade in over the last seconds of this one. */
	private crossfade: { buffer: AudioBuffer; seconds: number; ending?: Ending } | null = null;
	/** Its source, started on the audio clock where the handover falls. */
	private incoming: { src: AudioBufferSourceNode; gain: GainNode; startsAt: number } | null = null;
	private incomingTimer: ReturnType<typeof setTimeout> | null = null;
	/** The row fading out under the one that replaced it. */
	private outgoing: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
	private startedAt = 0;
	private startOffset = 0;
	private playing = false;
	/**
	 * Output latency, smoothed: the browser's estimate jitters by more than a frame, and a
	 * heard position that stepped back would rewind the show.
	 */
	private latency = Number.NaN;

	private raf = 0;
	private last = 0;
	/** When the director last rendered; a hidden tab stops rendering and its decisions go stale. */
	private lastFrameAt = Number.NaN;
	private fpsAcc = 0;
	private fpsFrames = 0;
	private fps = 0;
	private readoutAcc = 0;
	private readonly rgb: [number, number, number] = [0, 0, 0];

	get duration(): number {
		if (this.silence !== null) return this.silence;
		const full = this.buffer?.duration ?? this.analysis?.duration ?? 0;
		return this.stopAt !== null ? Math.min(full, this.stopAt) : full;
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

	/** This room's decisions, for the hardware renderer to follow. */
	roomSync(): RoomSync {
		return this.director.sync();
	}

	/** Seconds since this room last decided anything; infinite before the first frame. */
	get roomAge(): number {
		if (!Number.isFinite(this.lastFrameAt)) return Infinity;
		return (performance.now() - this.lastFrameAt) / 1000;
	}

	/** Adopt the hardware room's decisions, so a tab that starts leading does not drag it back. */
	follow(room: RoomSync): void {
		this.director.follow(room);
	}

	/** One slot of the room's live palette, as CSS. Allocation-free apart from the string. */
	private swatch(slot: number): string {
		const [r, g, b] = sample(this.director.ambient.colour.palette, slot, 1, this.rgb);
		const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
		return `rgb(${byte(r)} ${byte(g)} ${byte(b)})`;
	}

	private context(): AudioContext {
		this.ctx ??= new AudioContext();
		this.gain ??= (() => {
			const g = this.ctx!.createGain();
			g.connect(this.ctx!.destination);
			return g;
		})();
		return this.ctx;
	}

	/** Decode without touching what plays, so the next row can be ready before it is needed. */
	async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
		return this.context().decodeAudioData(bytes);
	}

	/** `ending` stops the row early, fading out into that moment. */
	useBuffer(buffer: AudioBuffer, ending?: Ending, level = 1): void {
		this.pause();
		this.crossfade = null;
		this.level = Math.max(0, Math.min(1, level));
		this.buffer = buffer;
		this.silence = null;
		this.stopAt = ending ? ending.at : null;
		this.fadeFor = ending ? ending.seconds : 0;
		this.startOffset = 0;
	}

	/** A silent row: the audio clock runs for `seconds` with nothing to hear. */
	loadSilence(seconds: number): void {
		this.pause();
		this.crossfade = null;
		this.level = 1;
		this.context();
		this.buffer = null;
		this.silence = seconds;
		this.stopAt = null;
		this.fadeFor = 0;
		this.startOffset = 0;
	}

	loadShow(analysis: TrackAnalysis, show: Show, dissolve?: number): void {
		this.analysis = analysis;
		this.show = show;
		this.registry.clearGenerated();
		for (const gen of show.generatedEffects) {
			const compiled = compileGenerated(gen, this.geometry);
			// Rejected generated effects leave only their own layers dark.
			if (compiled.def) this.registry.add(compiled.def);
			else console.warn(`generated effect "${gen.id}" rejected`, compiled.failures);
		}
		this.director.load(analysis, show, dissolve);
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
		if (!this.ctx || (!this.buffer && this.silence === null) || this.playing) return;
		await this.ctx.resume();
		const src = this.ctx.createBufferSource();
		const rowGain = this.ctx.createGain();
		rowGain.gain.value = this.level;
		rowGain.connect(this.gain!);
		if (this.silence !== null) {
			// A looping second of silence runs the audio clock, which keeps time in a hidden tab.
			this.quiet ??= this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
			src.buffer = this.quiet;
			src.loop = true;
		} else {
			src.buffer = this.buffer;
		}
		src.connect(rowGain);
		src.onended = () => this.ended(src);
		// Playing again from the end starts over.
		const length = this.duration;
		if (this.startOffset >= length - 0.05) this.startOffset = 0;
		const offset = Math.min(this.startOffset, length - 0.01);
		// Say how much is left: started into a long buffer with only an offset, Chromium never
		// reports the end, and the queue would wait forever after a seek.
		if (this.silence !== null) src.start(0, 0, length - offset);
		else src.start(0, offset, length - offset);
		if (this.stopAt !== null && this.fadeFor > 0) {
			const now = this.ctx.currentTime;
			const end = this.stopAt - offset;
			const from = Math.max(0, Math.min(1, end / this.fadeFor));
			rowGain.gain.setValueAtTime(from * this.level, now);
			if (end > this.fadeFor) rowGain.gain.setValueAtTime(this.level, now + end - this.fadeFor);
			rowGain.gain.linearRampToValueAtTime(0, now + Math.max(0, end));
		}
		this.source = src;
		this.rowGain = rowGain;
		this.startedAt = this.ctx.currentTime;
		this.playing = true;
		this.scheduleIncoming();
	}

	private ended(src: AudioBufferSourceNode): void {
		if (this.source !== src) return;
		// The next row is already sounding; this one only ran out before its handover ran.
		if (this.incoming) {
			this.handover(true);
			return;
		}
		// A seek stops the node too, so reaching the end is what distinguishes the two.
		// The position stays at the end, so the room holds the last look rather than
		// rewinding to the opening while the next track loads.
		const finished = this.position >= this.duration - 0.25;
		this.pause();
		if (finished) this.onEnded?.();
	}

	/** Fade `buffer` in over the last `seconds` of what plays now, as the next row. */
	planCrossfade(buffer: AudioBuffer, seconds: number, ending?: Ending): void {
		this.cancelIncoming();
		this.crossfade = { buffer, seconds, ending };
		this.scheduleIncoming();
	}

	clearCrossfade(): void {
		this.cancelIncoming();
		this.crossfade = null;
	}

	/** Start the planned row on the audio clock, so the handover is exact even in a hidden tab. */
	private scheduleIncoming(): void {
		const plan = this.crossfade;
		const ctx = this.ctx;
		if (!plan || !ctx || !this.playing || !this.rowGain || this.incoming) return;
		// A row with its own fade-out or level, or silence, has no music to hand over.
		if (this.silence !== null || this.stopAt !== null || this.level !== 1) return;
		// Scheduled a moment ahead at least, so the curves never overlap anything set for now.
		const left = this.duration - this.position - 0.02;
		const seconds = Math.min(plan.seconds, left, plan.buffer.duration / 2);
		if (seconds < 0.1) return;
		const now = ctx.currentTime;
		const startsAt = now + 0.02 + left - seconds;
		const src = ctx.createBufferSource();
		src.buffer = plan.buffer;
		const gain = ctx.createGain();
		gain.gain.value = 0;
		gain.gain.setValueCurveAtTime(FADE_IN, startsAt, seconds);
		src.connect(gain);
		gain.connect(this.gain!);
		src.start(startsAt, 0, plan.buffer.duration);
		this.rowGain.gain.setValueCurveAtTime(FADE_OUT, startsAt, seconds);
		this.incoming = { src, gain, startsAt };
		this.incomingTimer = setTimeout(() => this.handover(), Math.max(0, (startsAt - now) * 1000));
	}

	private cancelIncoming(): void {
		if (this.incomingTimer) clearTimeout(this.incomingTimer);
		this.incomingTimer = null;
		const incoming = this.incoming;
		if (!incoming) return;
		this.incoming = null;
		incoming.src.onended = null;
		incoming.src.stop();
		incoming.src.disconnect();
		incoming.gain.disconnect();
		if (this.rowGain && this.ctx) {
			this.rowGain.gain.cancelScheduledValues(0);
			this.rowGain.gain.setValueAtTime(1, this.ctx.currentTime);
		}
	}

	/** The crossfade has begun: the incoming row is what plays, the outgoing one fades on. */
	private handover(outgoingEnded = false): void {
		const incoming = this.incoming;
		const plan = this.crossfade;
		if (!incoming || !plan) return;
		if (this.incomingTimer) clearTimeout(this.incomingTimer);
		this.incomingTimer = null;
		this.incoming = null;
		this.crossfade = null;
		this.retireOutgoing();
		const out = this.source;
		const outGain = this.rowGain;
		if (out && outGain && outgoingEnded) {
			out.disconnect();
			outGain.disconnect();
		} else if (out && outGain) {
			const outgoing = { src: out, gain: outGain };
			this.outgoing = outgoing;
			out.onended = () => {
				out.disconnect();
				outGain.disconnect();
				if (this.outgoing === outgoing) this.outgoing = null;
			};
		}
		this.buffer = plan.buffer;
		this.silence = null;
		this.level = 1;
		this.stopAt = plan.ending ? plan.ending.at : null;
		this.fadeFor = plan.ending ? plan.ending.seconds : 0;
		this.source = incoming.src;
		this.rowGain = incoming.gain;
		this.startedAt = incoming.startsAt;
		this.startOffset = 0;
		this.playing = true;
		incoming.src.onended = () => this.ended(incoming.src);
		this.onHandover?.();
	}

	private retireOutgoing(): void {
		const outgoing = this.outgoing;
		if (!outgoing) return;
		this.outgoing = null;
		outgoing.src.onended = null;
		outgoing.src.stop();
		outgoing.src.disconnect();
		outgoing.gain.disconnect();
	}

	pause(): void {
		this.cancelIncoming();
		this.retireOutgoing();
		if (!this.playing) return;
		this.startOffset = this.position;
		this.playing = false;
		this.source?.stop();
		this.source?.disconnect();
		this.source = null;
		this.rowGain?.disconnect();
		this.rowGain = null;
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
		// The director restarts the show there and dissolves into it, as the hardware will.
		this.director.seek();
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
		this.lastFrameAt = performance.now();
		this.followLatency(dt);
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
		return this.position - (Number.isFinite(this.latency) ? this.latency : 0.02);
	}

	private followLatency(dt: number): void {
		const reported =
			(this.ctx as (AudioContext & { outputLatency?: number }) | null)?.outputLatency ??
			this.ctx?.baseLatency;
		const measured = typeof reported === 'number' && Number.isFinite(reported) ? reported : 0.02;
		if (!Number.isFinite(this.latency)) this.latency = measured;
		else this.latency += (measured - this.latency) * Math.min(1, dt);
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
