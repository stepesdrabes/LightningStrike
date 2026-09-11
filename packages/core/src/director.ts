import type { TrackAnalysis } from './contracts/analysis.ts';
import type { ShowFrame } from './contracts/frame.ts';
import type { Geometry } from './contracts/room.ts';
import type { Show } from './contracts/show.ts';
import { SLOT } from './contracts/palette.ts';
import { sample } from './color/palette.ts';
import { smoothstep } from './dsl/math.ts';
import { BounceLamp } from './bounce.ts';
import { EffectRegistry } from './effects/index.ts';
import { Mixer } from './mixer.ts';
import { BrightnessSlew, GAMMA, MASTER, MeanLevel, compressHighlights, quantize } from './output.ts';
import { ShowPlayer } from './player.ts';
import { AmbientPlayer, type AmbientSettings } from './ambient/player.ts';
import { IdleClock } from './ambient/idle.ts';

/** Seconds to hold the show across ordinary fetch/decode gaps between tracks. */
const REST_GRACE = 2.5;

/** Seconds to dissolve into rest, and to come back out of it. */
const REST_DISSOLVE = 5;
/** Return faster because the music is already playing. */
const WAKE_DISSOLVE = 1.5;

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

	/** 0 the show, 1 ambient. Linear; the blend weight is this eased. */
	private u = 0;
	private stopped = 0;
	/**
	 * Remember whether any show has loaded: temporary unloads between tracks must retain the
	 * grace.
	 */
	private everLoaded = false;

	constructor(geometry: Geometry, registry = new EffectRegistry()) {
		this.showMix = new Mixer(geometry);
		this.ambientMix = new Mixer(geometry);
		this.player = new ShowPlayer(this.showMix, registry);
		this.ambient = new AmbientPlayer(this.ambientMix, registry);
		this.frame = new Float32Array(geometry.count * 3);
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

	load(analysis: TrackAnalysis, show: Show): void {
		this.player.load(analysis, show);
		this.ambient.trackPalette = show.palette;
		this.everLoaded = true;
	}

	clearShow(): void {
		this.player.clear();
		this.ambient.trackPalette = null;
	}

	/**
	 * Returns the track frame for readouts and cue highlighting, even while ambient owns the
	 * room.
	 */
	update(t: number, dt: number, state: DirectorState): ShowFrame {
		const f = this.player.update(Math.max(0, t), dt);

		const live = state.playing && state.hasShow;
		// Lounge and a never-loaded room skip the grace. Keep it spent when lounge ends during
		// a pause.
		if (state.lounge || !this.everLoaded) this.stopped = REST_GRACE;
		else if (live) this.stopped = 0;
		else this.stopped += dt;

		const wantAmbient = state.lounge || (state.rest && this.stopped >= REST_GRACE);
		const target = wantAmbient ? 1 : 0;
		const speed = dt / (target > this.u ? REST_DISSOLVE : WAKE_DISSOLVE);
		this.u = target > this.u ? Math.min(target, this.u + speed) : Math.max(target, this.u - speed);

		// Compose only contributing stages; freeze the idle clock while it is unused.
		const loungeLive = state.lounge && state.playing && state.hasShow;
		const w = this.ambience;

		if (w < 1) this.composeShow(f, dt, state.playing);
		if (w > 0) {
			// Lounge uses the track frame; rest uses an unmeasured synthetic grid.
			const af = loungeLive ? f : this.idle.update(dt);
			// Follow the show palette only while audio sounds; rest holds the last colour.
			this.ambient.cuePalette = loungeLive ? this.showMix.palette : null;
			this.ambient.update(af, loungeLive);
			this.ambientMix.compose(af);
		}

		this.blend(w);

		// Rest has a chosen level, so auto-exposure must not pull it toward the music target.
		const exposed = w < 1 && state.playing && f.energy > 0.02;
		this.finish(f, w, dt, exposed);
		return f;
	}

	/**
	 * Pass dt = 0 while paused to freeze effect integrators and decays, then restore the
	 * caller's dt.
	 */
	private composeShow(f: ShowFrame, dt: number, playing: boolean): void {
		if (playing) {
			this.showMix.compose(f);
			return;
		}
		f.dt = 0;
		this.showMix.compose(f);
		f.dt = dt;
	}

	/**
	 * Mix squared values and take the root to avoid a brightness dip between disjoint looks.
	 * The square approximates gamma without three Math.pow calls per channel.
	 */
	private blend(w: number): void {
		const show = this.showMix.frame;
		const amb = this.ambientMix.frame;
		const out = this.frame;
		if (w <= 0) {
			out.set(show);
			return;
		}
		if (w >= 1) {
			out.set(amb);
			return;
		}
		const a = 1 - w;
		for (let i = 0; i < out.length; i++) {
			const s = show[i];
			const b = amb[i];
			out[i] = Math.sqrt(a * s * s + w * b * b);
		}
	}

	/** Use the same light-domain blend for the accent so the lamp does not dim midway. */
	private accent(w: number): Float32Array {
		const out = this.tint;
		if (w < 1) sample(this.showMix.palette, SLOT.accent, 1, SHOW_ACCENT);
		if (w > 0) sample(this.ambientMix.palette, SLOT.accent, 1, AMBIENT_ACCENT);

		if (w <= 0) out.set(SHOW_ACCENT);
		else if (w >= 1) out.set(AMBIENT_ACCENT);
		else {
			const a = 1 - w;
			for (let c = 0; c < 3; c++) {
				const s = SHOW_ACCENT[c];
				const b = AMBIENT_ACCENT[c];
				out[c] = Math.sqrt(a * s * s + w * b * b);
			}
		}
		return out;
	}

	private finish(f: ShowFrame, w: number, dt: number, exposed: boolean): void {
		this.slew.apply(this.frame, dt);
		this.meanLevel.apply(this.frame, dt, exposed);
		compressHighlights(this.frame);
		quantize(this.frame, this.bytes, this.contrast, this.brightness);
		// Reduce the delivered level after the output chain.
		this.lamp.render(this.frame, f, this.accent(w), dt, this.bounce, this.lampBrightness);
	}
}

/** Refilled per call. Two, because the dissolve needs both at once. */
const SHOW_ACCENT: [number, number, number] = [0, 0, 0];
const AMBIENT_ACCENT: [number, number, number] = [0, 0, 0];
