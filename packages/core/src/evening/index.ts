/**
 * The `lightningstrike` module an evening file imports: the evening's vocabulary, plus the
 * names custom effects may use, which are exactly the effect sandbox's.
 */
export * from './api.ts';
export type {
	AccentEffect,
	BedEffect,
	BuiltInEffect,
	MasterEffect,
	PaletteName,
	RhythmEffect,
	Scene,
	TransientEffect
} from './vocabulary.ts';
export type { Clock, Length } from './time.ts';
export type { EntryHit, FillOrder, FillSource, HitKind, Position, Pulse } from '../contracts/evening.ts';

export * from '../dsl/index.ts';
export { SLOT } from '../contracts/palette.ts';
export { addSample, sample, setSample } from '../color/palette.ts';

export type { GenreFamily } from '../contracts/context.ts';
export type { LayerRole, Params, RenderCtx } from '../contracts/effect.ts';
export type { SectionKind, ShowFrame } from '../contracts/frame.ts';
export type { ShowPalette } from '../contracts/palette.ts';
export type { Geometry, StripSpec } from '../contracts/room.ts';
