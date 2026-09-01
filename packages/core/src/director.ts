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

/**
 * How long the room stays on the show after the music stops before it starts letting go.
 *
 * A track handing over to the next one is a gap of a second or two - fetch, decode, play - and a
 * room that dips through every one of those is worse than one that never rests at all. This is
 * longer than any ordinary gap and shorter than anyone's patience.
 */
const REST_GRACE = 2.5;

/** Seconds to dissolve into rest, and to come back out of it. */
const REST_DISSOLVE = 5;
/**
 * Coming back is faster than going, and deliberately asymmetric: the music is already playing by
 * the time this runs, so the room owes you the show rather than a considered arrival.
 */
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
 * The room, as one picture.
 *
 * Two complete looks are composed side by side and crossfaded before the output chain: the authored
 * show on one mixer, the ambient scenes on the other. A crossfade is the only honest way to do this
 * - there is one buffer per layer role and `Layer.setEffect` zeroes it, so a show and a scene cannot
 * share a stack - and it is cheap, because only one of the two is composed unless a handover is
 * actually in flight.
 *
 * The output chain runs once, here, on the blend. Running it per stage would slew, limit and expose
 * two rooms independently and then average the results, and auto-exposure in particular would spend
 * the whole dissolve chasing a picture that is half of something else.
 */
export class RoomDirector {
	readonly geometry: Geometry;
	readonly registry: EffectRegistry;

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
	 * Whether a show has ever been loaded, which is not the same as one being loaded now.
	 *
	 * `hasShow` goes false for a second in the middle of every track change, while the next track's
	 * bundle is being fetched, and the grace exists precisely to cover that. This is the other
	 * question - has this room ever had anything to hold - and only it may skip the grace.
	 */
	private everLoaded = false;

	constructor(geometry: Geometry, registry = new EffectRegistry()) {
		this.geometry = geometry;
		this.registry = registry;
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
	 * The output stage, which belongs to the fixtures rather than to the show.
	 *
	 * `brightness` is a dimmer and lands after gamma, so it costs no contrast; `contrast` is the
	 * exponent, which pulls the mids down and leaves full scale alone. Separate controls because
	 * "too bright" and "the hits do not land" are different complaints with different answers, and
	 * turning one down to fix the other is how a room ends up flat. `lampBrightness` is its own
	 * number because the lamp is a different fixture in a different corner at a different distance.
	 *
	 * **Only the server sets these.** The browser leaves them at unity, so the preview keeps
	 * showing the show rather than the room's dimmer: a screen has its own brightness, and dimming
	 * the picture to match a patio only makes the picture harder to read.
	 */
	brightness = MASTER;
	contrast = GAMMA;
	lampBrightness = MASTER;

	set ambientSettings(s: AmbientSettings) {
		this.ambient.settings = s;
	}

	get ambientSettings(): AmbientSettings {
		return this.ambient.settings;
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
	 * One frame. `t` is where the audio is; `state` is what the room is being asked to be.
	 *
	 * Returns the show's frame rather than the ambient one: it is what the readout, the scrubber and
	 * the cue highlight are about, and those keep meaning the track even when the room has stopped
	 * lighting it.
	 */
	update(t: number, dt: number, state: DirectorState): ShowFrame {
		const f = this.player.update(Math.max(0, t), dt);

		const live = state.playing && state.hasShow;
		// Lounge takes the room at once, because it is a decision rather than an absence. So does an
		// app that has never had a show in it: the grace is there to bridge the gap between two
		// tracks, and there is no gap to bridge before the first one. Rest otherwise waits it out.
		//
		// Held AT the grace rather than past it, so switching lounge off during a pause leaves the
		// room resting instead of snapping back to a show nobody is listening to.
		if (state.lounge || !this.everLoaded) this.stopped = REST_GRACE;
		else if (live) this.stopped = 0;
		else this.stopped += dt;

		const wantAmbient = state.lounge || (state.rest && this.stopped >= REST_GRACE);
		const target = wantAmbient ? 1 : 0;
		const speed = dt / (target > this.u ? REST_DISSOLVE : WAKE_DISSOLVE);
		this.u = target > this.u ? Math.min(target, this.u + speed) : Math.max(target, this.u - speed);

		// Only the stage that contributes is composed, so a room that has settled on one of them
		// costs exactly what it did before there were two. The idle clock is part of that: frozen
		// while nothing reads it, and continuing rather than jumping when something does.
		const loungeLive = state.lounge && state.playing && state.hasShow;
		const w = this.ambience;

		if (w < 1) this.composeShow(f, dt, state.playing);
		if (w > 0) {
			// Lounge is fed the track's own frame, so the scenes answer the spectrum and change on
			// the arrangement. Resting is fed a synthetic grid with no measurement in it at all.
			const af = loungeLive ? f : this.idle.update(dt);
			// The show stage's palette is whatever cue it is on, already crossfaded by the player.
			// Only while a track is actually sounding: a paused show's cue is not a colour the room
			// should keep chasing, and a rested room holds the last one it arrived at.
			this.ambient.cuePalette = loungeLive ? this.showMix.palette : null;
			this.ambient.update(af, loungeLive);
			this.ambientMix.compose(af);
		}

		this.blend(w);

		// Auto-exposure follows the music and nothing else. A resting room's level is chosen rather
		// than measured, and an exposure that pulls it back toward the target is undoing a decision
		// it cannot see - which is exactly what it was already forbidden from doing to a silence.
		const exposed = w < 1 && state.playing && f.energy > 0.02;
		this.finish(f, w, dt, exposed);
		return f;
	}

	reset(): void {
		this.player.reset();
		this.ambient.reset();
		this.idle.reset();
		this.showMix.reset();
		this.ambientMix.reset();
		this.frame.fill(0);
		this.bytes.fill(0);
		this.bounce.fill(0);
		this.slew.reset();
		this.meanLevel.reset();
		this.lamp.reset();
		this.u = 0;
		this.stopped = 0;
	}

	/**
	 * The show, held still while the audio is not sounding.
	 *
	 * A paused show is a paused clock and a running one at the same time: `t` stops, so every beat,
	 * band and section freezes, while `dt` keeps arriving, so every phase accumulator and decay in
	 * every effect carries on. Measured over a pause, the show's own mean brightness swung between
	 * 28 and 79 bytes on a four-second cycle - a room lurching about while its music sits still,
	 * and a fade-out that lurches with it.
	 *
	 * A desk that pauses shows a still look, so this passes zero. Every time constant in the DSL is
	 * derived from `dt`, so zero holds all of them exactly rather than approximately: `alphaFor`
	 * returns 0, `fadeToBlack` decays nothing, an integrator adds nothing. The frame is restored
	 * before it goes back to the caller, which reports what actually elapsed.
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
	 * The two stages into one picture, mixed in light rather than in the authoring domain.
	 *
	 * The authoring domain is not linear light - `quantize` raises it by gamma on the way to the
	 * wire, so an LED's output goes as the square-ish of these numbers. A plain lerp there halves
	 * both looks at the midpoint, and half of an authoring value is a fifth of the light: measured
	 * across a handover between two looks that light different walls, the room dropped to 43% of
	 * its own brightness halfway and climbed back out. That is a dip anyone in the room can see.
	 *
	 * Squaring first, mixing, and taking the root back out preserves the light exactly where the two
	 * looks are disjoint and leaves them untouched where they agree. The square is standing in for
	 * gamma 2.2 - the exact exponent would cost three `Math.pow` per channel and lands within 6% of
	 * this at the worst point of the fade, which is a tenth of a stop.
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

	/**
	 * The accent slot of whichever stage the room is showing, mixed the way `blend` mixes light.
	 *
	 * A plain lerp between two full-brightness colours dips through the middle - red to green
	 * passes through a half-lit olive - and the lamp would darken across a dissolve that is meant
	 * to be invisible, for the same reason and by the same arithmetic as the picture itself.
	 */
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
		// After the chain, so the lamp answers the level the frame is actually at rather than the
		// level the show was authored at.
		this.lamp.render(this.frame, f, this.accent(w), dt, this.bounce, this.lampBrightness);
	}
}

/** Refilled per call. Two, because the dissolve needs both at once. */
const SHOW_ACCENT: [number, number, number] = [0, 0, 0];
const AMBIENT_ACCENT: [number, number, number] = [0, 0, 0];
