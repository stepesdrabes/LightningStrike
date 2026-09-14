import type { TrackAnalysis } from './contracts/analysis.ts';
import type { ShowFrame } from './contracts/frame.ts';
import type { Geometry } from './contracts/room.ts';
import type { Show } from './contracts/show.ts';
import { SLOT } from './contracts/palette.ts';
import { sample } from './color/palette.ts';
import { clamp, smoothstep } from './dsl/math.ts';
import { BounceLamp } from './bounce.ts';
import { EffectRegistry } from './effects/index.ts';
import { Mixer } from './mixer.ts';
import { BrightnessSlew, GAMMA, MASTER, MeanLevel, compressHighlights, quantize } from './output.ts';
import { ShowPlayer } from './player.ts';
import { AmbientPlayer, type AmbientSettings } from './ambient/player.ts';
import { IdleClock } from './ambient/idle.ts';
import type { RoomSync } from './sync.ts';

/** Seconds to hold the last look across ordinary fetch/decode gaps between tracks. */
const REST_GRACE = 3.5;

/** Seconds to dissolve into rest, and to come back out of it. */
const REST_DISSOLVE = 5;
/** Return faster because the music is already playing. */
const WAKE_DISSOLVE = 1.5;

/**
 * Why the show restarts, and how long the held picture takes to dissolve into it. A new
 * track arrives unhurried; a seek or a resume follows the music at once.
 */
type Restart = 'track' | 'resume' | 'seek' | 'reload';
const DISSOLVE: Record<Restart, number> = { track: 1.5, resume: 0.6, seek: 0.45, reload: 0.6 };

/** Position jumps beyond these are seeks; anything smaller is transport jitter or a stall. */
const SEEK_JUMP = 0.5;
const SEEK_SLACK = 0.05;

/** Seconds over which a synced crossfade position is absorbed rather than stepped. */
const FOLLOW_TAU = 0.5;

/** The shortest ease between the room's exposure and an authored show's unity; a dissolve stretches it. */
const FIXED_EXPOSURE_TAU = 0.1;

export interface DirectorState {
	/** Whether the audio is actually sounding. */
	playing: boolean;
	/** Whether there is a show loaded to play. */
	hasShow: boolean;
	/** Calm scenes instead of the authored show, even while a track is playing. */
	lounge: boolean;
	/** Whether the room rests when nothing plays, rather than holding the last look. */
	rest: boolean;
}

/**
 * Crossfade separate show and ambient mixers; their persistent layer buffers cannot be shared.
 * Run the output chain once on the blend so exposure follows the combined picture.
 *
 * The show side is a deterministic function of the track position: every start, seek and
 * resume restarts it from a fixed pre-roll, and the picture the room was holding dissolves
 * into the restart. That is what lets a hardware renderer fed only positions match the
 * preview.
 */
export class RoomDirector {
	readonly showMix: Mixer;
	readonly ambientMix: Mixer;
	readonly player: ShowPlayer;
	readonly ambient: AmbientPlayer;

	/** The blend, in the authoring domain. */
	readonly frame: Float32Array;
	/** What the preview and the wire read. */
	readonly bytes: Uint8Array;
	/** The Bounce Lamp's one pixel, gamma-encoded like `bytes`. A second fixture, not a tail. */
	readonly bounce = new Uint8Array(3);

	private readonly idle = new IdleClock();
	private readonly slew: BrightnessSlew;
	private readonly meanLevel = new MeanLevel();
	private readonly lamp = new BounceLamp();
	private readonly tint = new Float32Array(3);

	/** The show side of the room: the live show, or what it last showed while it is not live. */
	private readonly show: Float32Array;
	private readonly held: Float32Array;
	private readonly showAccent: [number, number, number] = [0, 0, 0];
	private readonly heldAccent: [number, number, number] = [0, 0, 0];
	private readonly liveAccent: [number, number, number] = [0, 0, 0];
	private readonly ambientAccent: [number, number, number] = [0, 0, 0];
	/** 0 the held picture, 1 the live show. Linear; the blend weight is this eased. */
	private handover = 1;
	private handoverSpeed = 1;
	/** Whether the show side has ever been composed, so a first start is not a fade from black. */
	private lit = false;

	/** 0 the show, 1 ambient. Linear; the blend weight is this eased. */
	private u = 0;
	private pendingU = 0;
	private stopped = 0;
	/**
	 * Remember whether any show has loaded: temporary unloads between tracks must retain the
	 * grace.
	 */
	private everLoaded = false;
	private wasLive = false;
	private lastT = 0;
	private fresh = false;
	private reload = false;
	private seekPending = false;
	/** The next track's own dissolve, seconds, when its loader named one. */
	private arrival: number | null = null;
	/** Whether the loaded show plays its authored levels without auto-exposure. */
	private fixedExposure = false;
	private exposureTau = FIXED_EXPOSURE_TAU;
	/** 0 renders at the room's exposure, 1 at unity; the exposure itself is kept for the next song. */
	private unity = 0;
	private pendingExposure = 0;

	constructor(geometry: Geometry, registry = new EffectRegistry()) {
		this.showMix = new Mixer(geometry);
		this.ambientMix = new Mixer(geometry);
		this.player = new ShowPlayer(this.showMix, registry);
		this.ambient = new AmbientPlayer(this.ambientMix, registry);
		this.frame = new Float32Array(geometry.count * 3);
		this.show = new Float32Array(geometry.count * 3);
		this.held = new Float32Array(geometry.count * 3);
		this.bytes = new Uint8Array(geometry.count * 3);
		this.slew = new BrightnessSlew(geometry.count * 3);
	}

	/** 0 while the show has the room, 1 while ambient does. Eased, so it reads as the picture. */
	get ambience(): number {
		return smoothstep(0, 1, this.u);
	}

	get resting(): boolean {
		return this.ambience > 0.5;
	}

	get sceneName(): string {
		return this.ambient.sceneName;
	}

	/**
	 * Server-only fixture controls; the browser keeps unity for a readable preview.
	 * Brightness scales after gamma; contrast changes the exponent. Lamp brightness is
	 * independent.
	 */
	brightness = MASTER;
	contrast = GAMMA;
	lampBrightness = MASTER;

	set ambientSettings(s: AmbientSettings) {
		this.ambient.settings = s;
	}

	/** `dissolve` sets how long the held picture takes to give way to this show; 0 cuts. */
	load(analysis: TrackAnalysis, show: Show, dissolve?: number): void {
		this.arrival = dissolve ?? null;
		this.fixedExposure = show.exposure === 'fixed';
		this.player.load(analysis, show);
		this.ambient.trackPalette = show.palette;
		this.everLoaded = true;
		// A show replaced under a playing track restarts into it; a new one waits for play.
		if (this.wasLive) this.reload = true;
		else this.fresh = true;
	}

	clearShow(): void {
		this.player.clear();
		this.ambient.trackPalette = null;
		this.fixedExposure = false;
	}

	/** The position is about to jump: restart the show there on the next update. */
	seek(): void {
		this.seekPending = true;
	}

	/** What this room decided, for another room to follow. */
	sync(): RoomSync {
		const scene = this.ambient.sync();
		return {
			ambience: this.u,
			stopped: this.stopped,
			scene: scene.scene,
			sceneCounter: scene.counter,
			sceneHeld: scene.held,
			idleT: this.idle.t,
			exposure: this.meanLevel.gain
		};
	}

	/** Follow another room's decisions. The crossfade position is absorbed, never stepped. */
	follow(s: RoomSync): void {
		this.pendingU = clamp(s.ambience) - this.u;
		if (s.exposure !== undefined && Number.isFinite(s.exposure)) this.pendingExposure = s.exposure - this.meanLevel.gain;
		this.stopped = Math.max(0, s.stopped);
		this.ambient.follow({ scene: s.scene, counter: s.sceneCounter, held: s.sceneHeld });
		this.idle.follow(s.idleT);
	}

	/**
	 * Returns the track frame for readouts and cue highlighting, even while ambient owns the
	 * room.
	 */
	update(t: number, dt: number, state: DirectorState): ShowFrame {
		t = Math.max(0, t);
		const live = state.playing && state.hasShow;
		const restart = this.restartFor(t, live);
		if (restart) this.restart(t, restart);
		const f = this.player.update(t, dt);
		this.lastT = t;

		// Lounge and a never-loaded room skip the grace. Keep it spent when lounge ends during
		// a pause.
		if (state.lounge || !this.everLoaded) this.stopped = REST_GRACE;
		else if (live) this.stopped = 0;
		else this.stopped += dt;

		const wantAmbient = state.lounge || (state.rest && this.stopped >= REST_GRACE);
		const target = wantAmbient ? 1 : 0;
		const speed = dt / (target > this.u ? REST_DISSOLVE : WAKE_DISSOLVE);
		this.u = target > this.u ? Math.min(target, this.u + speed) : Math.max(target, this.u - speed);
		if (this.pendingU !== 0) {
			const step = this.pendingU * Math.min(1, dt / FOLLOW_TAU);
			this.u = clamp(this.u + step);
			this.pendingU -= step;
			if (Math.abs(this.pendingU) < 1e-4) this.pendingU = 0;
		}

		// Compose only contributing stages. The idle grid always runs so an outgoing resting
		// scene keeps its rhythm while it fades, and so another room can follow it.
		const w = this.ambience;
		const idleF = this.idle.update(dt);
		if (live && w < 1) this.composeShow(f, dt);
		// Follow the show's palette while audio sounds, whether or not the scenes are showing,
		// so a dissolve into them never crosses hues; rest holds the last colour.
		this.ambient.cuePalette = live ? this.showMix.palette : null;
		if (w > 0) {
			// Lounge uses the track frame; rest uses an unmeasured synthetic grid.
			const loungeLive = state.lounge && live;
			this.ambient.update(loungeLive ? f : idleF, loungeLive, loungeLive ? idleF : f);
			this.ambientMix.compose(loungeLive ? f : idleF);
		} else {
			this.ambient.tick(dt);
		}
		this.wasLive = live;

		this.blend(w);

		if (this.pendingExposure !== 0) {
			const step = this.pendingExposure * Math.min(1, dt / FOLLOW_TAU);
			this.meanLevel.gain += step;
			this.pendingExposure -= step;
			if (Math.abs(this.pendingExposure) < 1e-4) this.pendingExposure = 0;
		}
		// An authored show plays at unity while the songs' exposure waits, unchanged, for the next song.
		if (live && w < 1) this.unity += ((this.fixedExposure ? 1 : 0) - this.unity) * Math.min(1, dt / this.exposureTau);
		// Rest has a chosen level, so auto-exposure must not pull it toward the music target.
		const exposed = w < 1 && live && f.energy > 0.02 && !this.fixedExposure;
		this.finish(f, w, dt, exposed);
		return f;
	}

	private restartFor(t: number, live: boolean): Restart | null {
		if (!live) return null;
		if (!this.wasLive) return this.fresh ? 'track' : 'resume';
		if (this.reload) return 'reload';
		if (this.seekPending || t > this.lastT + SEEK_JUMP || t < this.lastT - SEEK_SLACK) {
			return 'seek';
		}
		return null;
	}

	/**
	 * Warm the show at its new position and dissolve what the room was holding into it. When
	 * ambient has the whole room, the wake dissolve already covers the restart.
	 */
	private restart(t: number, kind: Restart): void {
		this.fresh = false;
		this.reload = false;
		this.seekPending = false;
		this.player.warm(t);
		// A loader's own dissolve applies to the restart its show arrives with, however it arrives:
		// loaded onto a live room it is a reload or a resume, not a track.
		const seconds = this.arrival !== null && kind !== 'seek' ? this.arrival : DISSOLVE[kind];
		if (kind !== 'seek') this.arrival = null;
		this.exposureTau = Math.max(FIXED_EXPOSURE_TAU, seconds / 3);
		if (this.ambience < 1 && this.lit && seconds > 0) {
			this.held.set(this.show);
			this.heldAccent[0] = this.showAccent[0];
			this.heldAccent[1] = this.showAccent[1];
			this.heldAccent[2] = this.showAccent[2];
			this.handover = 0;
			this.handoverSpeed = 1 / seconds;
		} else {
			this.handover = 1;
		}
	}

	private composeShow(f: ShowFrame, dt: number): void {
		this.showMix.compose(f);
		sample(this.showMix.palette, SLOT.accent, 1, this.liveAccent);
		this.lit = true;
		if (this.handover >= 1) {
			this.show.set(this.showMix.frame);
			this.showAccent[0] = this.liveAccent[0];
			this.showAccent[1] = this.liveAccent[1];
			this.showAccent[2] = this.liveAccent[2];
			return;
		}
		this.handover = Math.min(1, this.handover + dt * this.handoverSpeed);
		const k = smoothstep(0, 1, this.handover);
		mixLight(this.show, this.held, this.showMix.frame, k, this.contrast);
		mixLight(this.showAccent, this.heldAccent, this.liveAccent, k, this.contrast);
	}

	private blend(w: number): void {
		if (w <= 0) this.frame.set(this.show);
		else if (w >= 1) this.frame.set(this.ambientMix.frame);
		else mixLight(this.frame, this.show, this.ambientMix.frame, w, this.contrast);
	}

	/** Use the same light-domain blend for the accent so the lamp does not dim midway. */
	private accent(w: number): Float32Array {
		const out = this.tint;
		if (w > 0) sample(this.ambientMix.palette, SLOT.accent, 1, this.ambientAccent);
		if (w <= 0) out.set(this.showAccent);
		else if (w >= 1) out.set(this.ambientAccent);
		else mixLight(out, this.showAccent, this.ambientAccent, w, this.contrast);
		return out;
	}

	private finish(f: ShowFrame, w: number, dt: number, exposed: boolean): void {
		this.slew.apply(this.frame, dt);
		this.meanLevel.apply(this.frame, dt, exposed);
		const gain = this.meanLevel.gain;
		if (this.unity > 0 && gain !== 1) {
			const scale = (gain + (1 - gain) * this.unity) / gain;
			for (let i = 0; i < this.frame.length; i++) this.frame[i] *= scale;
		}
		compressHighlights(this.frame);
		quantize(this.frame, this.bytes, this.contrast, this.brightness);
		// Reduce the delivered level after the output chain.
		this.lamp.render(this.frame, f, this.accent(w), dt, this.bounce, this.lampBrightness);
	}
}

/**
 * Mix in delivered light, through the same exponent the wire is encoded with, so the bytes
 * of a dissolve are the linear mix of its two ends and disjoint looks cannot dip between.
 * Only dissolves pay for the pow calls.
 */
function mixLight(
	out: { [i: number]: number; length: number },
	a: ArrayLike<number>,
	b: ArrayLike<number>,
	w: number,
	gamma: number
): void {
	const keep = 1 - w;
	const inv = 1 / gamma;
	for (let i = 0; i < out.length; i++) {
		const s = a[i];
		const v = b[i];
		const light = keep * (s > 0 ? Math.pow(s, gamma) : 0) + w * (v > 0 ? Math.pow(v, gamma) : 0);
		out[i] = light > 0 ? Math.pow(light, inv) : 0;
	}
}
