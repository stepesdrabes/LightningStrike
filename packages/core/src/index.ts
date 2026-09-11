export type { Geometry, RoomRegion, RoomSpec, StripSpec } from './contracts/room.ts';
export type { SectionKind, ShowFrame } from './contracts/frame.ts';
export {
	BAND_EDGES_HZ,
	NUM_BANDS,
	SECTION_KINDS,
	SPECTRUM_BANDS,
	sectionBase
} from './contracts/frame.ts';
export type { EffectDef, LayerRole } from './contracts/effect.ts';
export { LAYER_ROLES } from './contracts/effect.ts';
export type { ShowPalette } from './contracts/palette.ts';
export { SLOT } from './contracts/palette.ts';
export type {
	BarRow,
	EventTag,
	Moment,
	MovementSpan,
	OnsetStream,
	SectionSpan,
	SpectrumTrack,
	TrackAnalysis
} from './contracts/analysis.ts';
export { ANALYSIS_VERSION } from './contracts/analysis.ts';
export type { GenreFamily, LyricLine, TrackContext } from './contracts/context.ts';
export { CONTEXT_VERSION, emptyContext } from './contracts/context.ts';
export { decodeBase64, encodeBase64 } from './base64.ts';
export type { Cue, CuePalette, GeneratedEffect, Hit, LayerSpec, Show } from './contracts/show.ts';
export { HIT_RULES, SHOW_VERSION, STROBE_MAX_HZ, strobePerBeat } from './contracts/show.ts';
export { gridTrust } from './trust.ts';
export type { LedFrame, LedSink, LedSinkStats } from './contracts/sink.ts';
export { DEFAULT_ROOM, buildGeometry, roomRegions } from './geometry.ts';
export { hsv2rgb, rampHueFor } from './color/hsv.ts';
export { lerpHue, makePalette, sample, swapped, wrapHue } from './color/palette.ts';
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
	onPhraseGrid,
	phraseOffset
} from './grid.ts';
export { Rng, hash01 } from './dsl/rng.ts';
export { DEFAULT_OPACITY, Mixer } from './mixer.ts';
export { ShowPlayer } from './player.ts';
export { RoomDirector } from './director.ts';
export { DEFAULT_AMBIENT, DWELL_MAX, DWELL_MIN, type AmbientSettings } from './ambient/player.ts';
export type { ColourSource } from './ambient/colour.ts';
export { BUILT_IN_EFFECTS, EffectRegistry } from './effects/index.ts';
export { quietFrames, scriptFrames } from './effects/gate.ts';
export { measureEffect, type EffectCharacter } from './effects/probe.ts';
export { compileGenerated } from './effects/sandbox.ts';
export { GAMMA, MASTER } from './output.ts';
