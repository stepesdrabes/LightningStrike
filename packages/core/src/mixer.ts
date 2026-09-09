import type { Geometry } from './contracts/room.ts';
import type { ShowFrame } from './contracts/frame.ts';
import type {
	BlendMode,
	Effect,
	EffectDef,
	LayerRole,
	Params,
	RenderCtx
} from './contracts/effect.ts';
import { LAYER_ROLES } from './contracts/effect.ts';
import type { Palette } from './contracts/palette.ts';
import { SLOT } from './contracts/palette.ts';
import { makePalette, sample } from './color/palette.ts';
import {
	BrightnessSlew,
	MeanLevel,
	blend,
	compressHighlights,
	quantize
} from './output.ts';

const DEFAULT_BLEND: Record<LayerRole, BlendMode> = {
	bed: 'over',
	rhythm: 'add',
	transient: 'add',
	accent: 'add',
	master: 'add'
};

/**
 * The least cue intensity a hit is rendered at.
 *
 * A strobe or a slam is punctuation on the timeline, not part of the look it lands over, and
 * the planner puts the strobe that announces a drop inside the "breath" bar it has just
 * dimmed to six tenths of the passage: rendered at the breath's 0.31 to 0.47, Rock That
 * Body's first strobe reached byte 22 and the owner heard the strobes as "sometimes kinda
 * dim". The floor is a build cue's level (0.62 plus energy), where the same flashes were
 * judged right in the room, so a hit fired out of a hollow or a dimming build arrives at
 * the level a build would have given it and a hit fired out of anything louder is exactly
 * what it was. Measured over the corpus: 28 of 108 strobes sat under it, all in a breath.
 */
export const HIT_INTENSITY_FLOOR = 0.68;

// Opacity budget per role. Without it the four additive layers reliably sum past white
// and the palette stops being readable at exactly the loudest moment.
export const DEFAULT_OPACITY: Record<LayerRole, number> = {
	bed: 0.45,
	rhythm: 0.8,
	transient: 0.95,
	accent: 0.55,
	master: 1
};

export class Layer {
	def: EffectDef | null = null;
	effect: Effect | null = null;
	params: Params = {};
	opacity: number;
	blendMode: BlendMode;
	enabled = true;
	readonly buf: Float32Array;
	readonly role: LayerRole;

	/**
	 * The effect being faded out, and what it was rendering with.
	 *
	 * A cue change is a hard cut and always has been: the desk fades the palette and the level, the
	 * look itself arrives on the downbeat. That is right for a show and wrong for a room at rest,
	 * where nothing is arriving and a cut is the only thing anyone would notice. So the outgoing
	 * effect is kept alive for `fade` seconds when a caller asks for one, and both are rendered and
	 * lerped. `setEffect` with no fade is the old behaviour exactly, down to the byte.
	 */
	private prevEffect: Effect | null = null;
	private prevParams: Params = {};
	private readonly prevBuf: Float32Array;
	private fade = 0;
	private fadeLength = 0;

	constructor(role: LayerRole, count: number) {
		this.role = role;
		this.buf = new Float32Array(count * 3);
		this.prevBuf = new Float32Array(count * 3);
		this.opacity = DEFAULT_OPACITY[role];
		this.blendMode = DEFAULT_BLEND[role];
	}

	setEffect(def: EffectDef | null, g: Geometry, fadeSeconds = 0): void {
		if (def === this.def) return;
		if (fadeSeconds > 0 && this.effect) {
			this.prevEffect = this.effect;
			this.prevParams = this.params;
			this.prevBuf.set(this.buf);
			this.fade = fadeSeconds;
			this.fadeLength = fadeSeconds;
		} else {
			this.dropOutgoing();
		}
		this.def = def;
		this.effect = def ? def.create(g) : null;
		this.buf.fill(0);
		this.params = {};
		if (def) for (const p of def.params) this.params[p.key] = p.default;
	}

	/**
	 * Render, and hand back whichever buffer holds the result.
	 *
	 * With nothing handing over that is the effect's own buffer, untouched, which is what keeps the
	 * no-fade path byte-identical. Mid-handover it is `scratch`, because the two effects have to be
	 * mixed before the blend mode rather than after it: only `add` distributes over a crossfade, and
	 * a bed blends `over`.
	 *
	 * The mix is in light rather than in the authoring domain, which is not linear in it: a plain
	 * lerp halves both effects at the midpoint, and half an authoring value is a fifth of the light,
	 * so two looks that light different walls hand over through a visible dip. Squaring, mixing and
	 * taking the root back preserves the light where they are disjoint and changes nothing where
	 * they agree.
	 *
	 * The outgoing effect keeps its own buffer, so a trail on its way out decays against its own
	 * history rather than against its replacement's.
	 */
	render(ctx: RenderCtx, scratch: Float32Array): Float32Array {
		ctx.p = this.params;
		this.effect?.render(this.buf, ctx);
		if (this.fade <= 0) return this.buf;

		this.fade = Math.max(0, this.fade - ctx.f.dt);
		const out = this.fadeLength > 0 ? this.fade / this.fadeLength : 0;
		if (out <= 0) {
			this.dropOutgoing();
			return this.buf;
		}

		ctx.p = this.prevParams;
		this.prevEffect?.render(this.prevBuf, ctx);
		const incoming = 1 - out;
		for (let i = 0; i < scratch.length; i++) {
			const a = this.buf[i];
			const b = this.prevBuf[i];
			scratch[i] = Math.sqrt(incoming * a * a + out * b * b);
		}
		return scratch;
	}

	/** Whether this contributes anything: an outgoing effect counts even with nothing incoming. */
	get busy(): boolean {
		return this.effect !== null || this.prevEffect !== null;
	}

	reset(): void {
		this.effect?.reset();
		this.buf.fill(0);
		this.dropOutgoing();
	}

	private dropOutgoing(): void {
		this.prevEffect = null;
		this.prevParams = {};
		this.prevBuf.fill(0);
		this.fade = 0;
		this.fadeLength = 0;
	}
}

export class Mixer {
	readonly layers: Record<LayerRole, Layer>;
	readonly frame: Float32Array;
	readonly bytes: Uint8Array;

	palette: Palette = makePalette({ base: 320, accent: 185 });
	hueShift = 0;
	motion = 1;
	/** Cue-level ceiling, 0..1. */
	intensity = 1;
	/**
	 * A cut over everything, 0..1: the blackout hit. Kept apart from `intensity` because the
	 * master layer is floored against the cue's level below, and a cut is the one thing a hit
	 * may never be floored out of.
	 */
	dim = 1;
	/** User master fader, 0..1. */
	brightness = 1;
	/**
	 * House floor: the level the room sits at when the cue's own layers are not carrying it.
	 *
	 * Every venue has one and this room did not, which is why its quiet passages measured byte 3
	 * with 5% of the LEDs lit. The cause is structural rather than a bad number somewhere: a bed
	 * is written to sit UNDER something, so an intro carrying a bed and one texture emits about
	 * 0.2 before the output chain, and gamma 2.2 turns that into nothing at any intensity the
	 * cue is allowed to ask for. No dimmer can lift a room that is not being lit.
	 *
	 * Added after the cue's intensity rather than before it, because it is a floor and not a
	 * layer: a breakdown asking for 40% is asking for 40% of its LOOK, not for the room to go
	 * out. A void sets this to zero, which is what makes a void still mean darkness.
	 */
	floor = 0;

	private readonly meanLevel = new MeanLevel();
	private readonly slew: BrightnessSlew;
	private readonly floorRgb: [number, number, number] = [0, 0, 0];
	private readonly layerScratch: Float32Array;
	private readonly ctx: RenderCtx;
	readonly geometry: Geometry;

	constructor(geometry: Geometry) {
		this.geometry = geometry;
		const n = geometry.count;
		this.frame = new Float32Array(n * 3);
		this.bytes = new Uint8Array(n * 3);
		this.layerScratch = new Float32Array(n * 3);
		this.slew = new BrightnessSlew(n * 3);

		this.layers = Object.fromEntries(
			LAYER_ROLES.map((role) => [role, new Layer(role, n)])
		) as Record<LayerRole, Layer>;

		this.ctx = {
			g: geometry,
			f: null as unknown as ShowFrame,
			p: {},
			palette: this.palette,
			hueShift: 0,
			motion: 1
		};
	}

	render(f: ShowFrame): void {
		this.compose(f);
		this.finish(f);
	}

	/**
	 * The layers, the cue's ceiling and the house floor, into `frame`.
	 *
	 * Split from `finish` so two of these can be crossfaded as one picture before the output chain
	 * runs. Everything up to here is in the authoring domain, where light adds linearly and a
	 * crossfade means what it says; everything after it is one-per-room and must happen once.
	 */
	compose(f: ShowFrame): void {
		const ctx = this.ctx;
		ctx.f = f;
		ctx.hueShift = this.hueShift;
		ctx.motion = this.motion;

		this.frame.fill(0);

		const master = this.layers.master;
		// The additive master joins after the cue's dimmer, floored: a hit is not part of the
		// look it lands over. Any other blend mode on the master is a look and takes the cue's
		// level with the rest.
		const hitLast = master.blendMode === 'add';
		for (const role of LAYER_ROLES) {
			const layer = this.layers[role];
			if (!layer.enabled || !layer.busy) continue;
			if (role === 'master' && hitLast) continue;
			ctx.palette = this.palette;
			const out = layer.render(ctx, this.layerScratch);
			blend(this.frame, out, layer.blendMode, layer.opacity);
		}

		// Exposure headroom above 1.0 on purpose: the 3D preview tone-maps HDR values into
		// a blown-out core with coloured fringes, which is what a camera sees looking at an
		// LED. Clipping here instead would make them read as flat stickers.
		const scale = this.intensity * this.dim * this.brightness * 1.4;
		if (scale !== 1) for (let i = 0; i < this.frame.length; i++) this.frame[i] *= scale;

		if (hitLast && master.enabled && master.busy) {
			ctx.palette = this.palette;
			const out = master.render(ctx, this.layerScratch);
			const level = Math.max(this.intensity, HIT_INTENSITY_FLOOR) * this.dim * this.brightness * 1.4;
			blend(this.frame, out, 'add', master.opacity * level);
		}

		if (this.floor > 0) {
			// The room's own home colour, so the floor reads as the show being lit rather than as
			// a grey wash somebody forgot to turn off.
			sample(this.palette, SLOT.base, this.brightness, this.floorRgb);
			// A black-level lift, not a clamp. Clamping to the floor erases everything the cue's
			// own layers are doing below it, and a quiet passage is exactly where they are all
			// below it: the outro came out a dead flat wash whose peak equalled its floor. This
			// way the layers still ride on top, compressed into the headroom that is left.
			for (let i = 0; i < this.frame.length; i += 3) {
				for (let c = 0; c < 3; c++) {
					const lift = this.floorRgb[c] * this.floor;
					this.frame[i + c] = lift + this.frame[i + c] * (1 - lift);
				}
			}
		}
	}

	/**
	 * Slew, auto-expose, compress and quantize `frame` into `bytes`.
	 *
	 * `alive` freezes auto-exposure. It defaults to the same question the mixer has always asked -
	 * is anything playing loudly enough to be worth exposing for - and is a parameter so a caller
	 * that knows better can say so. A room at rest is not a silent passage of a track: its level is
	 * chosen rather than measured, and an exposure that pulls it back toward the target is undoing
	 * that decision.
	 */
	finish(f: ShowFrame, alive = f.energy > 0.02): void {
		this.slew.apply(this.frame, f.dt);
		this.meanLevel.apply(this.frame, f.dt, alive);
		compressHighlights(this.frame);
		quantize(this.frame, this.bytes);
	}

	reset(): void {
		for (const role of LAYER_ROLES) this.layers[role].reset();
		this.frame.fill(0);
		this.bytes.fill(0);
		this.dim = 1;
		this.meanLevel.reset();
		this.slew.reset();
	}
}
