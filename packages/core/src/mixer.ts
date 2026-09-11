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
 * Minimum hit intensity, measured at a build cue's level so dim pre-drop cues retain
 * punctuation.
 */
const HIT_INTENSITY_FLOOR = 0.68;

// Role budgets preserve colour when additive layers overlap.
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

	/** Retain outgoing state for optional ambient crossfades; show cues default to hard cuts. */
	private prevEffect: Effect | null = null;
	private prevParams: Params = {};
	private readonly prevBuf: Float32Array;
	private fade = 0;
	private fadeLength = 0;

	constructor(role: LayerRole, count: number) {
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
	 * Mix into scratch before the layer blend mode; only add distributes over a crossfade.
	 * Squared-light blending avoids midpoint dimming. Keep separate buffers so outgoing trails
	 * decay against their own history. Without a fade, return the original buffer unchanged.
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
	/** Blackout cut, 0..1, separate from the cue intensity so the hit floor cannot defeat it. */
	dim = 1;
	/** User master fader, 0..1. */
	brightness = 1;
	/**
	 * House floor after cue intensity, preserving light when quiet layers cannot carry the
	 * room.
	 * Void cues set it to zero.
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

	/** Compose in the authoring domain; callers may blend stages before running finish once. */
	compose(f: ShowFrame): void {
		const ctx = this.ctx;
		ctx.f = f;
		ctx.hueShift = this.hueShift;
		ctx.motion = this.motion;

		this.frame.fill(0);

		const master = this.layers.master;
		// Additive punctuation joins after cue dimming; other master modes take the cue level.
		const hitLast = master.blendMode === 'add';
		for (const role of LAYER_ROLES) {
			const layer = this.layers[role];
			if (!layer.enabled || !layer.busy) continue;
			if (role === 'master' && hitLast) continue;
			ctx.palette = this.palette;
			const out = layer.render(ctx, this.layerScratch);
			blend(this.frame, out, layer.blendMode, layer.opacity);
		}

		// Retain HDR headroom for the preview's bright cores and coloured fringes.
		const scale = this.intensity * this.dim * this.brightness * 1.4;
		if (scale !== 1) for (let i = 0; i < this.frame.length; i++) this.frame[i] *= scale;

		if (hitLast && master.enabled && master.busy) {
			ctx.palette = this.palette;
			const out = master.render(ctx, this.layerScratch);
			const level = Math.max(this.intensity, HIT_INTENSITY_FLOOR) * this.dim * this.brightness * 1.4;
			blend(this.frame, out, 'add', master.opacity * level);
		}

		if (this.floor > 0) {
			// Use the show's home colour for the floor.
			sample(this.palette, SLOT.base, this.brightness, this.floorRgb);
			// Lift the black level instead of clamping, preserving layer movement below the
			// floor.
			for (let i = 0; i < this.frame.length; i += 3) {
				for (let c = 0; c < 3; c++) {
					const lift = this.floorRgb[c] * this.floor;
					this.frame[i + c] = lift + this.frame[i + c] * (1 - lift);
				}
			}
		}
	}

	/** Apply the output chain once. Set alive false to freeze exposure during silence or rest. */
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
