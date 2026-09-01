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

/**
 * Seconds a scene holds, and how long the handover takes.
 *
 * Long, on both counts. A room at rest that changes its look every half minute is a screensaver;
 * the dwell is set so a scene outlasts a conversation, and the handover so that nobody in the room
 * can point at the moment it happened.
 */
export const DWELL_MIN = 45;
export const DWELL_MAX = 600;
const SCENE_FADE = 7;

/**
 * The shortest a lounge scene may hold, whatever the arrangement does.
 *
 * Lounge changes on section boundaries, and a track with a four-bar void in it has boundaries eight
 * seconds apart. Without this the room would flick through three looks inside a breakdown.
 */
const LOUNGE_MIN_HOLD = 34;

/**
 * The brightest a lounge passage may be, and how far below it the quietest sits.
 *
 * The ceiling is under the resting room's, not level with it. Lounge is a mode where the loudest
 * thing the track does is still furniture: with the ceiling at the resting level, a chorus under
 * `chorusBloom` measured over twice the mean brightness of a room at rest, which is a room
 * answering a drop by another name.
 */
const LOUNGE_CEIL = 0.86;
const LOUNGE_LIFT = 0.28;

/**
 * How far open the room sits for each class of passage, before its actual level is read.
 *
 * By `sectionBase`, so a chorus is seated as the drop-class arrival it is and a verse as a groove.
 * A drop-class passage is the top of the range and nothing goes above it, which is what keeps
 * lounge lounge: the biggest arrival in the track is a bloom rather than an event.
 */
const LOUNGE_SEAT: Partial<Record<SectionKind, number>> = {
	drop: 1,
	build: 0.72,
	groove: 0.6,
	void: 0.12
};
/** Intros, breakdowns and outros, which are quiet without being empty. */
const LOUNGE_SEAT_DEFAULT = 0.38;

/**
 * The floor while a track is playing, below the resting one.
 *
 * The resting floor is high because nothing else is happening. Something is happening here, and a
 * floor that high spends the contrast the passage was going to use.
 */
const LOUNGE_FLOOR = 0.34;

/**
 * The house floor while resting.
 *
 * Here for the same reason a cue has one, and higher than any section's for two that a cue does not
 * have. A cue's floor sits under four more layers and this sits under two, and auto-exposure is
 * frozen while the room rests - a resting level is chosen rather than measured, so nothing is
 * quietly lifting it toward a target the way it does for a track. Below about 0.48 the floor alone
 * lands under byte 24, and every scene with genuine darkness in its field went out in the gaps:
 * `nightfield` lit a third of the room and `curtains` two fifths.
 *
 * It reads as the room's own colour rather than as a wash, because the mixer samples it at
 * `SLOT.base`, and it is a black-level lift rather than a clamp, so the scene still has five sixths
 * of the range to move in on top of it.
 */
const REST_FLOOR = 0.52;

/**
 * The cue-level ceiling, which for a resting room is no ceiling.
 *
 * Everything on this path is already a number under one - the effect's own gain, the layer's
 * opacity budget, the user's brightness - and the room reached byte 20 the first time this was one
 * more of them. The dimmer belongs to the person in the room; it does not belong here as well.
 */
const REST_INTENSITY = 1;

/**
 * How bright a resting scene is against the show's own full scale.
 *
 * A tuned level rather than a dimmer. It was a slider in the lounge panel, which made it the
 * second brightness control in the app and the one nobody could tell apart from the room's: the
 * fixture's dimmer is in the hardware panel, where it belongs to the installation. This stays
 * because 0.85 is what the scenes were judged at, not because anyone should be moving it.
 */
const REST_LEVEL = 0.85;

/** Cue-level speed. The `ambient` genre profile settled on about this for the same reason. */
const REST_MOTION = 0.35;
/** Nudged up from 0.62. Enough that the scenes read as moving with the track, short of a show. */
const LOUNGE_MOTION = 0.72;

export interface AmbientSettings extends ColourSettings {
	/** Seconds a scene holds when nothing is playing. */
	dwell: number;
}

export const DEFAULT_AMBIENT: AmbientSettings = {
	// The record's own colour, because that is what the rest of this program is for. A fixed hue
	// as the default made lounge deaf to the song in the one dimension that most obviously carries
	// it, and the fallbacks mean this is never worse: no show yet falls back to the cover, and
	// neither of those falls back to the hue below.
	source: 'track',
	// A low amber, for when there is nothing to borrow from. The colour a room is lit in when
	// nobody has decided to light it in a colour.
	hue: 28,
	// The house sweet spot, the same one `makePalette` defaults to. Below it the room reads as a
	// tinted white rather than as a colour, which is what the slider is for rather than a default.
	sat: 0.94,
	drift: 6,
	dwell: 150
};

/**
 * The room when it is not playing a show.
 *
 * It drives a `Mixer` the way `ShowPlayer` does, and the resemblance stops there: there is no
 * timeline, no cue list and nothing addressed by bar. A scene holds until its dwell runs out or the
 * arrangement moves on, and hands over through the layer crossfade rather than by cutting, because
 * a cut is the one thing a room at rest cannot get away with.
 *
 * The same object serves both jobs. Resting, it is fed a synthetic frame with no spectrum in it and
 * picks from the scenes that do not need one; in lounge it is fed the real frame, picks from all of
 * them, and lets the section decide how far open the room is. Nothing else differs, which is why a
 * track ending in lounge is not a change of engine.
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
	private settled = false;

	constructor(mixer: Mixer, registry: EffectRegistry) {
		this.mixer = mixer;
		this.registry = registry;
		this.colour.settings = this.stored;
	}

	get settings(): AmbientSettings {
		return this.stored;
	}

	/**
	 * Through a setter, because the colour half of these belongs to another object.
	 *
	 * `AmbientSettings` is a `ColourSettings` with two more fields on it, and handing the same
	 * object to both is what keeps them from drifting apart. Assigning the field directly left the
	 * colour engine holding the defaults forever, and every one of the colour controls did nothing.
	 */
	set settings(s: AmbientSettings) {
		const moved = s.source !== this.stored.source;
		this.stored = s;
		this.colour.settings = s;
		// A source the user has just picked arrives at once. Easing from one source to another
		// would walk the room through whatever hues happen to lie between them, which is nobody's
		// choice; easing WITHIN `track` is the room following the record, which is worth seeing.
		if (moved) this.colour.snap();
	}

	get sceneName(): string {
		return this.scene.name;
	}

	get sceneId(): string {
		return this.scene.id;
	}

	/** What the room is showing, so the interface can put the colour on screen. */
	get palette(): ShowPalette {
		return this.colour.shown;
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

	/**
	 * `live` is whether there is music to answer, not whether the room is visible. Resting, it is
	 * false and the frame is the idle clock's; in lounge it is true and the frame is the track's.
	 */
	update(f: ShowFrame, live: boolean): void {
		if (live !== this.wasLive) {
			// The pool changed under it. A scene that needs a spectrum has to go when the music
			// does, and a track starting deserves one that can answer it.
			this.wasLive = live;
			this.counter++;
			this.scene = this.pick(live);
			this.held = 0;
			this.lastSection = null;
		}

		this.held += f.dt;
		if (this.shouldMoveOn(f, live)) {
			this.counter++;
			this.scene = this.pick(live);
			this.held = 0;
		}
		this.lastSection = live ? sectionBase(f.section) : null;

		if (this.installed !== this.scene) {
			this.install(this.scene, this.installed === null ? 0 : SCENE_FADE);
			this.installed = this.scene;
		}

		this.mixer.palette = this.colour.update(f.dt);
		this.mixer.brightness = REST_LEVEL;
		this.mixer.motion = live ? LOUNGE_MOTION : REST_MOTION;

		// How far open the room is. Resting it is a constant, because nothing is happening and a
		// room that breathes its own level is a room with a fault. In lounge it follows the passage,
		// gently and slowly: a chorus is allowed to be brighter than a verse, and that is the whole
		// extent of the arrangement's say over the light.
		const want = live ? LOUNGE_CEIL - LOUNGE_LIFT + LOUNGE_LIFT * this.lounge(f) : REST_INTENSITY;
		// Arrives at the first reading rather than climbing to it, for the same reason `Follower`
		// does: a room fading up from black on its first frame is a fade nobody asked for.
		//
		// Down from 1.6 and 3.2, which took about three seconds to answer a section and made every
		// arrival something the room had already missed. Still asymmetric and still slow enough that
		// nothing here reads as a hit.
		this.level = this.settled ? envelope(this.level, want, f.dt, 0.9, 2.1) : want;
		this.settled = true;
		this.mixer.intensity = this.level;
		this.mixer.floor = live ? LOUNGE_FLOOR : REST_FLOOR;
	}

	reset(): void {
		this.counter = 0;
		this.held = 0;
		this.level = 0;
		this.settled = false;
		this.installed = null;
		this.lastSection = null;
		this.scene = this.pick(this.wasLive);
		this.colour.reset();
	}

	/** How much of the lounge lift this passage has earned, 0..1. */
	private lounge(f: ShowFrame): number {
		const seat = LOUNGE_SEAT[sectionBase(f.section)] ?? LOUNGE_SEAT_DEFAULT;
		// Blended with how loud the passage actually is, so a quiet chorus does not get a loud
		// one's light and a track with no dynamics is not lit as though it had some.
		return clamp(seat * 0.62 + clamp(f.energy) * 0.38);
	}

	private shouldMoveOn(f: ShowFrame, live: boolean): boolean {
		if (live) {
			if (this.held < LOUNGE_MIN_HOLD) return false;
			const base = sectionBase(f.section);
			// On the boundary, so the change is something the track did rather than something the
			// clock did. `phraseStart` would be the tidier edge but fires far too often.
			return this.lastSection !== null && base !== this.lastSection;
		}
		return this.held >= clamp(this.settings.dwell, DWELL_MIN, DWELL_MAX);
	}

	/**
	 * The next scene, deterministically.
	 *
	 * A stride through the eligible list rather than a fresh draw: a draw repeats, and a room that
	 * shows the same look twice in a row has visibly stopped choosing. The stride is coprime-ish
	 * with the pool by construction, and the hash only decides where in the pool the walk lands, so
	 * the same counter always gives the same scene and the room is reproducible like everything else.
	 */
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
			// Back to the role's own budget where the scene is silent about it. A cue may inherit
			// the last one's opacity, which is the show's business; a scene is a whole look and
			// inheriting half of the previous one is how a pairing quietly stops balancing.
			layer.opacity = spec.opacity ?? DEFAULT_OPACITY[role];
			if (spec.params) for (const [k, v] of Object.entries(spec.params)) layer.params[k] = v;
		}
	}
}
