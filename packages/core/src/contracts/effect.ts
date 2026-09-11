import type { Geometry } from './room.ts';
import type { SectionKind, ShowFrame } from './frame.ts';
import type { Palette } from './palette.ts';

export type LayerRole = 'bed' | 'rhythm' | 'transient' | 'accent' | 'master';

export const LAYER_ROLES: readonly LayerRole[] = [
	'bed',
	'rhythm',
	'transient',
	'accent',
	'master'
];

export type BlendMode = 'over' | 'add' | 'screen' | 'max' | 'multiply';

export interface ParamSpec {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
	default: number;
}

export type Params = Record<string, number>;

export interface RenderCtx {
	g: Geometry;
	f: ShowFrame;
	/** This layer's parameter values. */
	p: Params;
	/** Already cross-faded by the player. */
	palette: Palette;
	hueShift: number;
	/** Cue-level speed scale. Effects multiply their own speeds by this. */
	motion: number;
}

/**
 * out persists across frames and is never cleared by the mixer; stateless effects must
 * write every pixel. Allocate outside render and use only deterministic inputs from ctx.
 */
export interface Effect {
	reset(): void;
	render(out: Float32Array, ctx: RenderCtx): void;
}

/** Restraint metadata enforced by the picker and linter. */
interface EffectTaste {
	/** 1 = ambient, 5 = peak-of-the-track. */
	energy: 1 | 2 | 3 | 4 | 5;
	sections: readonly SectionKind[];
	minBars: number;
	maxBars: number;
	/** Usable at most once per show. */
	peakReserved: boolean;
	/**
	 * False if the effect cannot sustain a room alone; absent means true.
	 * Events with darkness between must set false regardless of measured quiet movement.
	 */
	carries?: boolean;
	/**
	 * Master stays black until a hit arms trigger. Excluded from untriggered peak-layer
	 * selection.
	 */
	hitOnly?: boolean;
	/**
	 * flash: interrupted light; impact: slams, blinders or bursts.
	 * Genres with no flash allowance forbid both. Other effects leave this absent.
	 */
	character?: 'flash' | 'impact';
	/** Peak-master treatment; absent accepts either. Ordinary layer selection ignores it. */
	peakStyle?: 'slam' | 'bloom';
	/**
	 * Required drum stream for the whole gesture; any means kick or snare.
	 * Effects that only season a continuing look with drums leave this absent.
	 */
	kit?: 'kick' | 'snare' | 'hat' | 'any';
	/**
	 * Quiet-passage movement in output bytes, measured against a 0.5 s low-pass on real
	 * cached tracks by bench/quietprobe.ts. Absent means unmeasured.
	 * Rerun the probe after changing a quiet-pool effect, the spectrum or the house floor.
	 */
	quiet?: number;
	/**
	 * Hand-rated share of light moving at frame scale, 0..1; absent means 0.
	 * 1: whole-room strikes; 0.6-0.7: partial strikes; 0.4-0.5: twinkle/hard patterns;
	 * 0.2-0.3: smooth motion; 0: held/breathing fields. The picker budgets this per cue
	 * to avoid overlapping strikers. Pixel movement alone cannot distinguish chase from
	 * flicker.
	 */
	activity?: number;
}

export interface EffectDef {
	readonly id: string;
	readonly name: string;
	readonly role: LayerRole;
	readonly blurb: string;
	readonly taste: EffectTaste;
	readonly params: readonly ParamSpec[];
	create(g: Geometry): Effect;
}
