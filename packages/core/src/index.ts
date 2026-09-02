export type {
	BounceSpec,
	FrameSpec,
	Geometry,
	LedSpan,
	RoomRegion,
	RoomSpec,
	StripSpec,
	Vec3
} from './contracts/room.ts';
export type { SectionKind, ShowFrame, Band as BandType } from './contracts/frame.ts';
export {
	BAND_EDGES_HZ,
	Band,
	NUM_BANDS,
	SECTION_KINDS,
	SPECTRUM_BANDS,
	createShowFrame,
	sectionBase
} from './contracts/frame.ts';
export type {
	BlendMode,
	Effect,
	EffectDef,
	EffectTaste,
	LayerRole,
	ParamSpec,
	Params,
	RenderCtx
} from './contracts/effect.ts';
export { LAYER_ROLES } from './contracts/effect.ts';
export type { Palette, ShowPalette } from './contracts/palette.ts';
export { PALETTE_ANCHORS, SLOT } from './contracts/palette.ts';
export type {
	BarRow,
	Envelopes,
	EventTag,
	KeyEstimate,
	Moment,
	MovementSpan,
	OnsetStream,
	SectionSpan,
	SpectrumTrack,
	StereoImage,
	TempoGrid,
	TrackAnalysis
} from './contracts/analysis.ts';
export { ANALYSIS_VERSION } from './contracts/analysis.ts';
export type { GenreFamily, LyricLine, TrackContext } from './contracts/context.ts';
export { CONTEXT_VERSION, emptyContext } from './contracts/context.ts';
export { decodeBase64, encodeBase64 } from './base64.ts';
export type {
	Cue,
	CuePalette,
	GeneratedEffect,
	Hit,
	HitRule,
	LayerSpec,
	Show
} from './contracts/show.ts';
export { HIT_RULES, SHOW_VERSION, STROBE_MAX_HZ, strobePerBeat } from './contracts/show.ts';
export { gridTrust, type GridTrust } from './trust.ts';
export type { LedFrame, LedSink, LedSinkStats } from './contracts/sink.ts';

export { DEFAULT_ROOM, buildGeometry, roomRegions } from './geometry.ts';
export { hsv2rgb, rampHueFor, trueHue } from './color/hsv.ts';
export {
	addSample,
	blendPalettes,
	lerpHue,
	makePalette,
	sample,
	setSample,
	swapped,
	wrapHue,
	writePalette
} from './color/palette.ts';
export {
	BARS_PER_PHRASE,
	PHRASE_BARS,
	barAtTime,
	barDurationAt,
	barTimeAt,
	beatPeriodAt,
	bpmAt,
	hitSeconds,
	nearestBar,
	nearestBarIn,
	nearestPhraseBar,
	tempoSegments,
	type TempoSegment,
	onPhraseGrid,
	phraseOffset
} from './grid.ts';
export { Rng, hash01 } from './dsl/rng.ts';
export { DEFAULT_OPACITY, Layer, Mixer } from './mixer.ts';
export { ShowPlayer } from './player.ts';
export { RoomDirector, type DirectorState } from './director.ts';
// The scene list, the idle clock and the colour engine are how the director does its job rather
// than something anyone outside asks it for, so they stay inside the package.
export { DEFAULT_AMBIENT, DWELL_MAX, DWELL_MIN, type AmbientSettings } from './ambient/player.ts';
export type { ColourSettings, ColourSource } from './ambient/colour.ts';
export { BUILT_IN_EFFECTS, EffectRegistry } from './effects/index.ts';
export { quietFrames, runGate, scriptFrames, type GateResult } from './effects/gate.ts';
export { measureEffect, type EffectCharacter } from './effects/probe.ts';
export {
	SANDBOX_API,
	compileGenerated,
	type CompileResult,
	type SandboxApi
} from './effects/sandbox.ts';
export {
	BrightnessSlew,
	GAMMA,
	LEVEL_BINS,
	MASTER,
	MeanLevel,
	blend,
	compressHighlights,
	perceivedLevel,
	quantize
} from './output.ts';
export { BounceLamp } from './bounce.ts';
