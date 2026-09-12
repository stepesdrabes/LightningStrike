import type { LayerRole } from '../contracts/effect.ts';
import { LAYER_ROLES } from '../contracts/effect.ts';
import type { SectionKind, ShowFrame } from '../contracts/frame.ts';
import { sectionBase } from '../contracts/frame.ts';
import type { Palette, ShowPalette } from '../contracts/palette.ts';
import { clamp, envelope } from '../dsl/math.ts';
import { hash01 } from '../dsl/rng.ts';
import type { EffectRegistry } from '../effects/index.ts';
import type { Mixer } from '../mixer.ts';
import { DEFAULT_OPACITY } from '../mixer.ts';
import { AmbientColour, type ColourSettings } from './colour.ts';
import { AMBIENT_SCENES, type AmbientScene } from './scenes.ts';

/** Long dwell and handover times keep scene changes unobtrusive at rest. */
export const DWELL_MIN = 45;
export const DWELL_MAX = 600;
const SCENE_FADE = 7;

/** Minimum lounge dwell prevents short sections from rapidly cycling looks. */
const LOUNGE_MIN_HOLD = 34;

/** Keep the lounge ceiling below rest so even chorusBloom stays subdued. */
const LOUNGE_CEIL = 0.86;
const LOUNGE_LIFT = 0.28;

/** Section-class openness before measured energy; chorus maps to the drop-class ceiling. */
const LOUNGE_SEAT: Partial<Record<SectionKind, number>> = {
	drop: 1,
	build: 0.72,
	groove: 0.6,
	void: 0.12
};
/** Intros, breakdowns and outros, which are quiet without being empty. */
const LOUNGE_SEAT_DEFAULT = 0.38;

/** Lower the lounge floor to leave contrast for the playing track. */
const LOUNGE_FLOOR = 0.34;

/**
 * Rest needs a higher floor: only two layers contribute and auto-exposure is frozen.
 * Keep dark gaps visibly lit; the mixer's black-level lift preserves movement above them.
 */
const REST_FLOOR = 0.52;

/** Unity avoids dimming an already-budgeted scene again. */
const REST_INTENSITY = 1;

/** Resting scene level calibrated at 0.85; the installation dimmer lives in the hardware panel. */
const REST_LEVEL = 0.85;

/** Cue-level speed. The `ambient` genre profile settled on about this for the same reason. */
const REST_MOTION = 0.35;
/** Enough motion to follow the track while staying below show intensity. */
const LOUNGE_MOTION = 0.72;

/** Seconds the floor and the motion take to move between rest and lounge, so neither steps. */
const MODE_TAU = 2;

export interface AmbientSettings extends ColourSettings {
	/** Seconds a scene holds when nothing is playing. */
	dwell: number;
}

export const DEFAULT_AMBIENT: AmbientSettings = {
	// Follow the track palette, falling back to artwork and then the picked hue.
	source: 'track',
	// A low amber, for when there is nothing to borrow from. The colour a room is lit in when
	// nobody has decided to light it in a colour.
	hue: 28,
	// Match makePalette's saturation default so the room retains colour.
	sat: 0.94,
	drift: 6,
	dwell: 150
};

/** The choices another room has to make the same way. */
export interface SceneSync {
	scene: string;
	counter: number;
	held: number;
}

/**
 * Ambient scene player shared by rest and lounge. Rest uses the idle grid and unmeasured
 * scenes; lounge uses the track frame and full pool. Crossfade layers on dwell or section
 * changes.
 */
export class AmbientPlayer {
	readonly colour = new AmbientColour();

	private stored: AmbientSettings = { ...DEFAULT_AMBIENT };
	private readonly mixer: Mixer;
	private readonly registry: EffectRegistry;

	private scene: AmbientScene = AMBIENT_SCENES[0];
	private installed: AmbientScene | null = null;
	private counter = 0;
	private held = 0;
	private lastSection: SectionKind | null = null;
	private wasLive = false;
	private level = 0;
	private floor = 0;
	private motion = 0;
	private settled = false;

	constructor(mixer: Mixer, registry: EffectRegistry) {
		this.mixer = mixer;
		this.registry = registry;
		this.colour.settings = this.stored;
	}

	get settings(): AmbientSettings {
		return this.stored;
	}

	/** Share one settings object with the colour engine so the controls cannot drift apart. */
	set settings(s: AmbientSettings) {
		const moved = s.source !== this.stored.source;
		this.stored = s;
		this.colour.settings = s;
		// Snap user source changes; ease changes within track mode.
		if (moved) this.colour.snap();
	}

	get sceneName(): string {
		return this.scene.name;
	}

	get sceneId(): string {
		return this.scene.id;
	}

	set trackPalette(p: ShowPalette | null) {
		this.colour.trackPalette = p;
	}

	set artHue(h: number | null) {
		this.colour.artHue = h;
	}

	/** The palette of the cue the show is on, so lounge can follow its colour script. */
	set cuePalette(p: Palette | null) {
		this.colour.cuePalette = p;
	}

	/** The nudge. Takes effect on the next frame, through the same handover as any other change. */
	next(): void {
		this.counter++;
		this.scene = this.pick(this.wasLive);
		this.held = 0;
	}

	sync(): SceneSync {
		return { scene: this.scene.id, counter: this.counter, held: this.held };
	}

	/** Make the choices another room made; a different scene arrives through the usual fade. */
	follow(s: SceneSync): void {
		this.counter = s.counter;
		this.held = s.held;
		if (s.scene === this.scene.id) return;
		const found = AMBIENT_SCENES.find((scene) => scene.id === s.scene);
		if (found) this.scene = found;
	}

	/**
	 * Keep the colour following while the scenes are not composed, so a dissolve into them
	 * starts on the colour the room already has.
	 */
	tick(dt: number): void {
		this.mixer.palette = this.colour.update(dt);
	}

	/**
	 * live means audio is playing: lounge gets the track frame, rest gets the idle frame.
	 * `other` is the other mode's frame, which an outgoing scene keeps while it fades.
	 */
	update(f: ShowFrame, live: boolean, other: ShowFrame | null = null): void {
		let crossed = false;
		if (live !== this.wasLive) {
			// The pool changed under it. A scene that needs a spectrum has to go when the music
			// does, and a track starting deserves one that can answer it.
			this.wasLive = live;
			this.counter++;
			this.scene = this.pick(live);
			this.held = 0;
			this.lastSection = null;
			crossed = true;
		}

		this.held += f.dt;
		if (this.shouldMoveOn(f, live)) {
			this.counter++;
			this.scene = this.pick(live);
			this.held = 0;
		}
		this.lastSection = live ? sectionBase(f.section) : null;

		if (this.installed !== this.scene) {
			this.mixer.outgoingFrame = crossed ? other : null;
			this.install(this.scene, this.installed === null ? 0 : SCENE_FADE);
			this.installed = this.scene;
		}

		this.tick(f.dt);
		this.mixer.brightness = REST_LEVEL;

		// Keep rest level constant; lounge follows passage energy slowly.
		const want = live ? LOUNGE_CEIL - LOUNGE_LIFT + LOUNGE_LIFT * this.lounge(f) : REST_INTENSITY;
		const floor = live ? LOUNGE_FLOOR : REST_FLOOR;
		const motion = live ? LOUNGE_MOTION : REST_MOTION;
		if (this.settled) {
			// Asymmetric smoothing softens section changes; the mode itself moves at one pace.
			this.level = envelope(this.level, want, f.dt, 0.9, 2.1);
			this.floor = envelope(this.floor, floor, f.dt, MODE_TAU, MODE_TAU);
			this.motion = envelope(this.motion, motion, f.dt, MODE_TAU, MODE_TAU);
		} else {
			// Start at the first reading to avoid an extra fade.
			this.level = want;
			this.floor = floor;
			this.motion = motion;
			this.settled = true;
		}
		this.mixer.intensity = this.level;
		this.mixer.floor = this.floor;
		this.mixer.motion = this.motion;
	}

	/** How much of the lounge lift this passage has earned, 0..1. */
	private lounge(f: ShowFrame): number {
		const seat = LOUNGE_SEAT[sectionBase(f.section)] ?? LOUNGE_SEAT_DEFAULT;
		// Measured energy keeps a quiet chorus below a loud one.
		return clamp(seat * 0.62 + clamp(f.energy) * 0.38);
	}

	private shouldMoveOn(f: ShowFrame, live: boolean): boolean {
		if (live) {
			if (this.held < LOUNGE_MIN_HOLD) return false;
			const base = sectionBase(f.section);
			// Change on section boundaries; phrase edges occur too often for lounge.
			return this.lastSection !== null && base !== this.lastSection;
		}
		return this.held >= clamp(this.settings.dwell, DWELL_MIN, DWELL_MAX);
	}

	/** Stride deterministically through the pool to avoid immediate repeats. */
	private pick(live: boolean): AmbientScene {
		const pool = AMBIENT_SCENES.filter((s) => live || !s.needsMusic);
		if (pool.length === 0) return AMBIENT_SCENES[0];
		const stride = 1 + Math.floor(hash01(this.counter * 977 + 13) * (pool.length - 2));
		const from = pool.findIndex((s) => s.id === this.scene.id);
		const at = from < 0 ? Math.floor(hash01(this.counter * 31 + 7) * pool.length) : from + stride;
		return pool[((at % pool.length) + pool.length) % pool.length];
	}

	private install(scene: AmbientScene, fade: number): void {
		for (const role of LAYER_ROLES) {
			const layer = this.mixer.layers[role];
			const spec = scene.layers[role as LayerRole];
			if (!spec) {
				layer.setEffect(null, this.mixer.geometry, fade);
				continue;
			}
			const def = this.registry.get(spec.effect);
			layer.setEffect(def, this.mixer.geometry, fade);
			if (!def) continue;
			// Restore unspecified opacities to role defaults; each scene is a complete look.
			layer.opacity = spec.opacity ?? DEFAULT_OPACITY[role];
			if (spec.params) for (const [k, v] of Object.entries(spec.params)) layer.params[k] = v;
		}
	}
}
