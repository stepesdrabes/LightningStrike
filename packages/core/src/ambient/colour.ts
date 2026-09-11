import type { Palette, ShowPalette } from '../contracts/palette.ts';
import { PALETTE_ANCHORS } from '../contracts/palette.ts';
import { rampHueFor } from '../color/hsv.ts';
import { blendPalettes, lerpHue, writePalette, wrapHue } from '../color/palette.ts';
import { alphaFor, clamp } from '../dsl/math.ts';

/** Where the room's colour comes from while it is resting or in lounge. */
export type ColourSource = 'fixed' | 'drift' | 'track';

/** Ramp degrees: accent 150-180 from base, third close enough to read as a shade. */
const ACCENT_ARC = 152;
const THIRD_ARC = 34;

/** Calm effects spend much of their field in deep..base, so this shade must remain visible. */
const AMBIENT_SHADE = 0.12;

/** How long a colour takes to arrive when the record it belongs to starts playing. */
const TRACK_TAU = 14;

/** Section colours arrive faster than record colours, with enough easing to soften inversions. */
const CUE_TAU = 3.5;

/** A quarter degree is finer than the ramp's own step, and finer than the eye. */
const HUE_EPSILON = 0.25;

export interface ColourSettings {
	source: ColourSource;
	/** Textbook HSV degrees, as picked in the interface. */
	hue: number;
	/** 0.15 washes out toward white, 1 is a fully saturated wall. */
	sat: number;
	/** Degrees per minute, in `drift`. */
	drift: number;
}

/** Carry saturation, shade and highlight with the hues to preserve the show's complete palette. */
interface Look {
	base: number;
	accent: number;
	third: number;
	sat: number;
	shade: number;
	white: number;
}

/** Use makePalette defaults for omitted fields so the declared look stays identical. */
const PALETTE_DEFAULTS = { sat: 0.94, shade: 0.08, white: 0.06 };

/**
 * Track mode carries the full show palette in ramp degrees.
 * Picked and artwork hues use textbook HSV and must pass through rampHueFor.
 */
export class AmbientColour {
	readonly palette: Palette = new Float32Array(PALETTE_ANCHORS * 3);

	settings: ColourSettings = { source: 'fixed', hue: 28, sat: 0.8, drift: 6 };

	/** The cover's dominant hue in textbook degrees, for `track` before a show exists. */
	artHue: number | null = null;

	/**
	 * Follow the player's already-crossfaded cue palette so lounge retains the show's colour
	 * script.
	 */
	cuePalette: Palette | null = null;

	private track: ShowPalette | null = null;

	/** Ignore temporary null palettes between tracks and hold the last colour through loading. */
	set trackPalette(p: ShowPalette | null) {
		if (p) this.track = p;
	}

	/** Accumulated drift, in textbook degrees. */
	private drifted = 0;
	private readonly now: Look = { base: 0, accent: 0, third: 0, ...PALETTE_DEFAULTS };
	private readonly want: Look = { base: 0, accent: 0, third: 0, ...PALETTE_DEFAULTS };
	private readonly built: Look = {
		base: Number.NaN,
		accent: Number.NaN,
		third: Number.NaN,
		sat: Number.NaN,
		shade: Number.NaN,
		white: Number.NaN
	};
	// Cache the last hue conversion; drift walks slowly and rampHueFor searches 1440 entries.
	private rampIn = Number.NaN;
	private rampOut = 0;

	constructor() {
		this.snap();
	}

	/** What the room is showing right now, as a show would declare it. */
	get shown(): ShowPalette {
		return { ...this.now };
	}

	update(dt: number): Palette {
		if (this.settings.source === 'drift') {
			// Accumulate in textbook degrees so uneven ramp spacing cannot distort the drift
			// speed.
			this.drifted = wrapHue(this.drifted + (this.settings.drift / 60) * dt);
		} else {
			this.drifted = 0;
		}

		// Blend baked cue palettes with a slower fade to preserve their colours and soften cue
		// cuts.
		const cue = this.settings.source === 'track' ? this.cuePalette : null;
		if (cue) {
			blendPalettes(this.palette, this.palette, cue, alphaFor(dt, CUE_TAU));
			// Invalidate built state so the next hue-built palette starts from the current
			// colour.
			this.built.base = Number.NaN;
			return this.palette;
		}

		this.resolve();
		// User picks arrive immediately; track changes ease.
		if (this.settings.source === 'track') {
			const a = alphaFor(dt, TRACK_TAU);
			// Interpolate hues around the wheel and scalar settings directly.
			this.now.base = lerpHue(this.now.base, this.want.base, a);
			this.now.accent = lerpHue(this.now.accent, this.want.accent, a);
			this.now.third = lerpHue(this.now.third, this.want.third, a);
			this.now.sat += (this.want.sat - this.now.sat) * a;
			this.now.shade += (this.want.shade - this.now.shade) * a;
			this.now.white += (this.want.white - this.now.white) * a;
		} else {
			this.arrive();
		}

		this.rebuildIfMoved();
		return this.palette;
	}

	/** Arrive without easing: a reset, or a source the user has just changed. */
	snap(): void {
		this.resolve();
		this.arrive();
		this.rebuildIfMoved();
	}

	private arrive(): void {
		this.now.base = this.want.base;
		this.now.accent = this.want.accent;
		this.now.third = this.want.third;
		this.now.sat = this.want.sat;
		this.now.shade = this.want.shade;
		this.now.white = this.want.white;
	}

	private resolve(): void {
		const s = this.settings;
		const track = s.source === 'track' ? this.track : null;
		if (track) {
			this.want.base = wrapHue(track.base);
			this.want.accent = wrapHue(track.accent);
			// Match makePalette's accent fallback.
			this.want.third = wrapHue(track.third ?? track.accent);
			this.want.sat = track.sat ?? PALETTE_DEFAULTS.sat;
			this.want.shade = track.shade ?? PALETTE_DEFAULTS.shade;
			this.want.white = track.white ?? PALETTE_DEFAULTS.white;
			return;
		}
		// Use artwork until a show exists, then fall back to the picked hue when neither
		// exists.
		const degrees =
			s.source === 'track' && this.artHue !== null ? this.artHue : s.hue + this.drifted;
		this.want.base = this.toRamp(degrees);
		this.want.accent = wrapHue(this.want.base + ACCENT_ARC);
		this.want.third = wrapHue(this.want.base + THIRD_ARC);
		this.want.sat = clamp(s.sat, 0.15, 1);
		this.want.shade = AMBIENT_SHADE;
		this.want.white = PALETTE_DEFAULTS.white;
	}

	private toRamp(degrees: number): number {
		const deg = wrapHue(degrees);
		if (Math.abs(deg - this.rampIn) < HUE_EPSILON) return this.rampOut;
		this.rampIn = deg;
		this.rampOut = rampHueFor(deg) * 360;
		return this.rampOut;
	}

	private rebuildIfMoved(): void {
		const was = this.built;
		if (
			Math.abs(this.now.base - was.base) < HUE_EPSILON &&
			Math.abs(this.now.accent - was.accent) < HUE_EPSILON &&
			Math.abs(this.now.third - was.third) < HUE_EPSILON &&
			Math.abs(this.now.sat - was.sat) < 0.004 &&
			Math.abs(this.now.shade - was.shade) < 0.004 &&
			Math.abs(this.now.white - was.white) < 0.004
		) {
			return;
		}
		writePalette(this.palette, this.now);
		Object.assign(was, this.now);
	}
}
