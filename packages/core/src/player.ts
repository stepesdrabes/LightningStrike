import type { BarRow, OnsetStream, TrackAnalysis, TempoGrid } from './contracts/analysis.ts';
import type { Cue, Hit, Show } from './contracts/show.ts';
import { LAYER_ROLES } from './contracts/effect.ts';
import type { Palette, ShowPalette } from './contracts/palette.ts';
import type { SectionKind, ShowFrame } from './contracts/frame.ts';
import { NUM_BANDS, createShowFrame, sectionBase } from './contracts/frame.ts';
import { decodeBase64 } from './base64.ts';
import { blendPalettes, makePalette, swapped } from './color/palette.ts';
import { FlashEnvelope } from './dsl/env.ts';
import { clamp, frac } from './dsl/math.ts';
import { barAtTime, barDurationAt, barTimeAt } from './grid.ts';
import type { Mixer } from './mixer.ts';
import type { EffectRegistry } from './effects/index.ts';

interface CompiledCue {
	start: number;
	end: number;
	bar: number;
	section: SectionKind;
	layers: Cue['layers'];
	palette: Palette;
	intensity: number;
	motion: number;
	fadeBeats: number;
}

interface CompiledHit {
	start: number;
	end: number;
	kind: Hit['kind'];
	effect: string | null;
	params: Hit['params'];
}

/** Build-progress span: reaches exactly 1.0 at the drop it points at. */
interface BuildSpan {
	start: number;
	end: number;
}

/** Minimum hit strength: uncertainty must not erase ghost notes. */
const MIN_HIT_LEVEL = 0.35;

/**
 * Section floors support sparse quiet layers; voids stay black and drops retain headroom.
 * These are authoring values tuned for delivered light. When gamma changes, preserve that
 * light with newFloor = oldFloor ^ (oldGamma / newGamma).
 */
const SECTION_FLOOR: Record<SectionKind, number> = {
	void: 0,
	intro: 0.34,
	outro: 0.42,
	breakdown: 0.38,
	build: 0.42,
	groove: 0.36,
	verse: 0.36,
	drop: 0.115,
	// A chorus is bright like a drop but arrives by lift, so it keeps a touch more floor:
	// the room blooms rather than detonating out of black.
	chorus: 0.17
};

/**
 * Drum anticipation as a beat fraction, clamped in seconds to offset frame/transport delay.
 * A 40 ms floor keeps fast tracks from lagging; raising it makes the room earlier.
 */
const HIT_LEAD_BEATS = 0.06;
const HIT_LEAD_FLOOR = 0.04;
const HIT_LEAD_CAP = 0.045;

function floorFor(section: SectionKind): number {
	return Math.min(1, SECTION_FLOOR[section] ?? 0);
}

/** Separate punctuation vocabulary from the effect IDs that perform it. */
const HIT_EFFECT: Record<Hit['kind'], string | null> = {
	blackout: null,
	slam: 'slam',
	strobe: 'strobe',
	bump: 'colorBump'
};

/**
 * Overlapping hits are intentional. Blackout wins because adding light cannot express a cut;
 * slams outrank bumps.
 */
const HIT_PRIORITY: Record<Hit['kind'], number> = {
	blackout: 3,
	slam: 2,
	bump: 1,
	strobe: 0
};

function resolvePalette(base: ShowPalette, cue: Cue): Palette {
	const p = cue.palette;
	if (!p || p === 'inherit') return makePalette(base);
	if (p === 'swap') return makePalette(swapped(base));
	return makePalette(p);
}

export class ShowPlayer {
	readonly frame: ShowFrame = createShowFrame();

	private analysis: TrackAnalysis | null = null;
	private show: Show | null = null;

	private cues: CompiledCue[] = [];
	private hits: CompiledHit[] = [];
	private buildSpans: BuildSpan[] = [];
	private dropTimes: number[] = [];

	private panCurve = new Float32Array(0);
	private widthCurve = new Float32Array(0);
	private stereoFps = 25;

	/** frames * spectrumBands, as shipped: bytes, decoded once on load. */
	private spectrumData: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
	private spectrumBands = 0;
	private spectrumFps = 50;

	private beatEnergy = new Float32Array(0);
	private beatBands = new Float32Array(0);
	private beatOffset = 0;
	/** Envelope entries per bar: the meter on the beat grid, 1 on the bar-table fallback. */
	private entriesPerBar = 1;
	private barSection: SectionKind[] = [];
	private sectionBounds: { start: number; end: number }[] = [];
	/** Per bar: the start bar of its section, and which section that is. The phrase origin. */
	private barSectionStart = new Int32Array(0);
	private barSectionOrdinal = new Int32Array(0);

	private readonly kickEnv = new FlashEnvelope();
	private readonly snareEnv = new FlashEnvelope();
	private readonly hatEnv = new FlashEnvelope(0.03, 0.07);
	private kickCursor = 0;
	private snareCursor = 0;
	private hatCursor = 0;
	/** When each stream last fired, so a cue switch can re-assert a hit it just consumed. */
	private lastKickAt = -Infinity;
	private lastSnareAt = -Infinity;
	private lastHatAt = -Infinity;

	private lastBeatIndex = Number.NaN;
	private lastBarIndex = Number.NaN;
	private lastPhraseIndex = Number.NaN;
	private lastT = -1;

	private cueCursor = 0;
	private appliedCue = -1;
	private readonly paletteScratch: Palette = makePalette({ base: 0, accent: 180 });
	private activeHitMaster: string | null = null;

	private readonly mixer: Mixer;
	private readonly registry: EffectRegistry;

	constructor(mixer: Mixer, registry: EffectRegistry) {
		this.mixer = mixer;
		this.registry = registry;
	}

	get currentCue(): CompiledCue | null {
		return this.cues[this.cueCursor] ?? null;
	}

	get loaded(): { analysis: TrackAnalysis; show: Show } | null {
		return this.analysis && this.show ? { analysis: this.analysis, show: this.show } : null;
	}

	/** Unload the show; reset only rewinds it. */
	clear(): void {
		this.analysis = null;
		this.show = null;
		this.cues = [];
		this.hits = [];
		this.reset();
	}

	load(analysis: TrackAnalysis, show: Show): void {
		this.analysis = analysis;
		this.show = show;

		const tempo = analysis.tempo;
		const nBars = analysis.bars.length;

		this.barSection = new Array<SectionKind>(nBars);
		for (let i = 0; i < nBars; i++) this.barSection[i] = analysis.bars[i].section;

		// Count phrases from section starts so phase changes follow the arrangement.
		this.barSectionStart = new Int32Array(nBars);
		this.barSectionOrdinal = new Int32Array(nBars);
		for (const s of analysis.sections) {
			for (let b = Math.max(0, s.startBar); b < Math.min(nBars, s.endBar); b++) {
				this.barSectionStart[b] = s.startBar;
				this.barSectionOrdinal[b] = s.index;
			}
		}

		// Beat-resolution envelopes start at downbeatPhase; legacy blobs fall back to bar
		// resolution.
		const env = analysis.envelopes;
		if (env && env.energy.length > 0) {
			this.beatEnergy = Float32Array.from(env.energy, (v) => v / 100);
			this.beatBands = Float32Array.from(env.bands, (v) => v / 100);
			this.beatOffset = tempo.downbeatPhase;
			this.entriesPerBar = Math.max(1, tempo.beatsPerBar);
		} else {
			this.beatEnergy = new Float32Array(nBars);
			this.beatBands = new Float32Array(nBars * NUM_BANDS);
			this.beatOffset = 0;
			this.entriesPerBar = 1;
			for (let i = 0; i < nBars; i++) {
				const row: BarRow = analysis.bars[i];
				this.beatEnergy[i] = row.energy / 100;
				const o = i * NUM_BANDS;
				this.beatBands[o] = row.sub / 100;
				this.beatBands[o + 1] = row.low / 100;
				this.beatBands[o + 2] = row.mid / 100;
				this.beatBands[o + 3] = row.air / 100;
			}
		}

		// Decode spectrum once on load; legacy blobs without one read as zero.
		const spectrum = analysis.spectrum;
		this.spectrumData = spectrum?.data ? decodeBase64(spectrum.data) : new Uint8Array(0);
		this.spectrumBands = spectrum?.bands ?? 0;
		this.spectrumFps = spectrum?.fps || 50;

		this.panCurve = Float32Array.from(analysis.stereo?.pan ?? []);
		this.widthCurve = Float32Array.from(analysis.stereo?.width ?? []);
		this.stereoFps = analysis.stereo?.fps || 25;

		this.sectionBounds = analysis.sections.map((s) => ({ start: s.startTime, end: s.endTime }));
		// Build progress targets the whole drop class, including choruses.
		this.dropTimes = analysis.sections
			.filter((s) => sectionBase(s.kind) === 'drop')
			.map((s) => s.startTime)
			.sort((a, b) => a - b);

		this.buildSpans = [];
		for (let i = 0; i < analysis.sections.length; i++) {
			const s = analysis.sections[i];
			if (s.kind !== 'build' && s.kind !== 'void') continue;
			const drop = analysis.sections.slice(i + 1).find((x) => sectionBase(x.kind) === 'drop');
			if (!drop) continue;
			// Continue progress through a void immediately after a build.
			const existing = this.buildSpans.at(-1);
			if (existing && Math.abs(existing.end - drop.startTime) < 1e-6) continue;
			this.buildSpans.push({ start: s.startTime, end: drop.startTime });
		}

		// The caller owns generated-effect registration; clearing here would black out those
		// cues.
		const defaults = show.defaults;
		const sorted = [...show.cues].sort((a, b) => a.bar - b.bar);
		this.cues = sorted.map((cue, i) => {
			const start = i === 0 ? 0 : barTimeAt(tempo, cue.bar);
			const next = sorted[i + 1];
			return {
				start,
				end: next ? barTimeAt(tempo, next.bar) : analysis.duration + 1,
				bar: cue.bar,
				section: cue.section,
				layers: cue.layers,
				palette: resolvePalette(show.palette, cue),
				intensity: cue.intensity ?? defaults.intensity,
				motion: cue.motion ?? defaults.motion,
				fadeBeats: cue.fadeBeats ?? defaults.fadeBeats
			};
		});

		this.hits = show.hits
			.map((h) => {
				// Use the hit bar's beat length on variable-tempo tracks.
				const beat = barDurationAt(tempo, h.bar) / Math.max(1, tempo.beatsPerBar);
				const t = barTimeAt(tempo, h.bar) + (h.beat ?? 0) * beat;
				return {
					start: t,
					end: t + h.beats * beat,
					kind: h.kind,
					effect: HIT_EFFECT[h.kind] ?? null,
					params: h.params
				};
			})
			.sort((a, b) => a.start - b.start);

		this.reset();
	}

	reset(): void {
		this.kickEnv.reset();
		this.snareEnv.reset();
		this.hatEnv.reset();
		this.kickCursor = 0;
		this.snareCursor = 0;
		this.hatCursor = 0;
		this.lastBeatIndex = Number.NaN;
		this.lastBarIndex = Number.NaN;
		this.lastPhraseIndex = Number.NaN;
		this.lastT = -1;
		this.cueCursor = 0;
		this.appliedCue = -1;
		this.activeHitMaster = null;
		this.mixer.reset();
	}

	update(t: number, dt: number): ShowFrame {
		const f = this.frame;
		const a = this.analysis;

		f.t = t;
		f.dt = dt;

		if (!a) return f;

		// Any backward jump invalidates every cursor and every decaying envelope.
		if (t < this.lastT - 1e-6) this.rewind(t);
		this.lastT = t;

		this.updateGrid(t, a.tempo);
		this.updateEnergy();
		this.updateSpectrum(t);
		this.updateStereo(t);
		this.updateDrums(t, dt, a);
		this.updateStructure(t);
		this.applyCues(t, f);
		this.applyHits(t);

		return f;
	}

	private rewind(t: number): void {
		this.kickEnv.reset();
		this.snareEnv.reset();
		this.hatEnv.reset();
		this.lastKickAt = -Infinity;
		this.lastSnareAt = -Infinity;
		this.lastHatAt = -Infinity;
		const a = this.analysis;
		if (a) {
			this.kickCursor = seekCursor(a.onsets.kick.times, t);
			this.snareCursor = seekCursor(a.onsets.snare.times, t);
			this.hatCursor = seekCursor(a.onsets.hat.times, t);
		}
		this.cueCursor = 0;
		this.appliedCue = -1;
		this.lastBeatIndex = Number.NaN;
		this.lastBarIndex = Number.NaN;
		this.lastPhraseIndex = Number.NaN;
	}

	private updateGrid(t: number, tempo: TempoGrid): void {
		const f = this.frame;
		// Derive all indices from barTimes so frame timing and cue timing agree.
		const barsF = barAtTime(tempo, t);
		const barIndex = Math.floor(barsF);
		const barPhase = barsF - barIndex;

		// Fold the section ordinal into the phrase index so every section change fires an edge.
		const nBars = this.barSectionStart.length;
		const clamped = Math.min(Math.max(barIndex, 0), Math.max(0, nBars - 1));
		const origin = nBars > 0 ? this.barSectionStart[clamped] : tempo.phraseAnchorBar;
		const ordinal = nBars > 0 ? this.barSectionOrdinal[clamped] : 0;
		const phrasesF = (barsF - origin) / tempo.barsPerPhrase;

		const beatsF = (barIndex + barPhase) * tempo.beatsPerBar;
		const beatIndex = Math.floor(beatsF);
		const phraseIndex = ordinal * 4096 + Math.floor(phrasesF);

		// Use local tempo for effect time constants.
		const barDuration = barDurationAt(tempo, barIndex);
		const beatPeriod = barDuration / Math.max(1, tempo.beatsPerBar);

		f.beatIndex = beatIndex;
		f.barIndex = barIndex;
		f.beatPhase = beatsF - beatIndex;
		f.barPhase = barPhase;
		f.phrasePhase = frac(phrasesF);
		f.beatPeriod = beatPeriod;
		f.bpm = beatPeriod > 1e-6 ? 60 / beatPeriod : tempo.bpm;

		// Detect index changes so slow frames cannot skip edges or fast frames repeat them.
		f.beat = beatIndex !== this.lastBeatIndex;
		f.downbeat = barIndex !== this.lastBarIndex;
		f.phraseStart = phraseIndex !== this.lastPhraseIndex;
		this.lastBeatIndex = beatIndex;
		this.lastBarIndex = barIndex;
		this.lastPhraseIndex = phraseIndex;
	}

	private updateEnergy(): void {
		const f = this.frame;
		const n = this.beatEnergy.length;
		const bars = this.barSection.length;
		if (n > 0) {
			// Entries are span means, so sample from their centres using a half-entry offset.
			const at = clamp(
				this.beatOffset + (f.barIndex + f.barPhase) * this.entriesPerBar - 0.5,
				0,
				n - 1
			);
			const i0 = Math.floor(at);
			const i1 = Math.min(i0 + 1, n - 1);
			const w = at - i0;

			f.energy = this.beatEnergy[i0] + (this.beatEnergy[i1] - this.beatEnergy[i0]) * w;
			for (let b = 0; b < NUM_BANDS; b++) {
				const v0 = this.beatBands[i0 * NUM_BANDS + b];
				const v1 = this.beatBands[i1 * NUM_BANDS + b];
				f.bands[b] = v0 + (v1 - v0) * w;
			}
		}
		if (bars > 0) {
			f.section = this.barSection[Math.min(Math.max(f.barIndex, 0), bars - 1)] ?? 'intro';
		}
	}

	/** Resample spectrum at t using each span's centre and the blob's stored band count. */
	private updateSpectrum(t: number): void {
		const f = this.frame;
		const bands = this.spectrumBands;
		if (bands === 0 || this.spectrumData.length === 0) {
			f.spectrum.fill(0);
			return;
		}
		const frames = Math.floor(this.spectrumData.length / bands);
		const x = clamp(t * this.spectrumFps - 0.5, 0, frames - 1);
		const i0 = Math.floor(x);
		const i1 = Math.min(i0 + 1, frames - 1);
		const w = x - i0;
		const out = f.spectrum;
		const last = bands - 1;

		for (let k = 0; k < out.length; k++) {
			const pos = out.length > 1 ? (k / (out.length - 1)) * last : 0;
			const b0 = Math.floor(pos);
			const b1 = Math.min(b0 + 1, last);
			const u = pos - b0;
			const lo =
				this.spectrumData[i0 * bands + b0] +
				(this.spectrumData[i0 * bands + b1] - this.spectrumData[i0 * bands + b0]) * u;
			const hi =
				this.spectrumData[i1 * bands + b0] +
				(this.spectrumData[i1 * bands + b1] - this.spectrumData[i1 * bands + b0]) * u;
			out[k] = (lo + (hi - lo) * w) / 255;
		}
	}

	/** Linear between samples, so a hard pan flick arrives as a ramp rather than a step. */
	private updateStereo(t: number): void {
		const f = this.frame;
		const n = this.panCurve.length;
		if (n === 0) {
			f.pan = 0;
			f.panWidth = 0;
		} else {
			const x = clamp(t * this.stereoFps, 0, n - 1);
			const i0 = Math.floor(x);
			const i1 = Math.min(i0 + 1, n - 1);
			const u = x - i0;
			f.pan = this.panCurve[i0] + (this.panCurve[i1] - this.panCurve[i0]) * u;
			f.panWidth = this.widthCurve[i0] + (this.widthCurve[i1] - this.widthCurve[i0]) * u;
		}
	}

	private updateDrums(t: number, dt: number, a: TrackAnalysis): void {
		const f = this.frame;
		// Anticipate onsets to cover up to one frame of detection delay plus transport latency.
		// The beat-relative lead is clamped in seconds; see the anticipation constants.
		const lead = Math.min(HIT_LEAD_CAP, Math.max(HIT_LEAD_FLOOR, HIT_LEAD_BEATS * f.beatPeriod));
		const at = t + lead;
		// Preserve hit strength, with a floor so ghost notes remain visible.
		const kick = advance(a.onsets.kick, at, this.kickCursor, (c) => (this.kickCursor = c));
		const snare = advance(a.onsets.snare, at, this.snareCursor, (c) => (this.snareCursor = c));
		const hat = advance(a.onsets.hat, at, this.hatCursor, (c) => (this.hatCursor = c));

		f.kick = kick > 0;
		f.snare = snare > 0;
		f.hat = hat > 0;

		if (kick > 0) {
			this.kickEnv.fire(kick);
			this.lastKickAt = t;
		}
		if (snare > 0) {
			this.snareEnv.fire(snare);
			this.lastSnareAt = t;
		}
		if (hat > 0) {
			this.hatEnv.fire(hat);
			this.lastHatAt = t;
		}

		f.kickEnv = this.kickEnv.update(dt);
		f.snareEnv = this.snareEnv.update(dt);
		f.hatEnv = this.hatEnv.update(dt);
	}

	private updateStructure(t: number): void {
		const f = this.frame;

		let progress = 0;
		for (const span of this.buildSpans) {
			if (t >= span.start && t < span.end) {
				progress = clamp((t - span.start) / Math.max(span.end - span.start, 1e-3));
				break;
			}
		}
		f.buildProgress = progress;

		let toDrop = Infinity;
		let sinceDrop = Infinity;
		for (const d of this.dropTimes) {
			if (d >= t) {
				toDrop = d - t;
				break;
			}
			sinceDrop = t - d;
		}
		f.timeToDrop = toDrop;
		f.timeSinceDrop = sinceDrop;

		const bound = this.sectionBounds.find((s) => t >= s.start && t < s.end);
		f.sectionProgress = bound
			? clamp((t - bound.start) / Math.max(bound.end - bound.start, 1e-3))
			: 0;
	}

	private applyCues(t: number, f: ShowFrame): void {
		if (this.cues.length === 0) return;

		while (this.cueCursor + 1 < this.cues.length && t >= this.cues[this.cueCursor + 1].start) {
			this.cueCursor++;
		}
		while (this.cueCursor > 0 && t < this.cues[this.cueCursor].start) this.cueCursor--;

		const active = this.cues[this.cueCursor];
		const next = this.cues[this.cueCursor + 1];

		if (this.appliedCue !== this.cueCursor) {
			this.installLayers(active);
			this.appliedCue = this.cueCursor;
			// Re-assert edges within the lead plus one frame so incoming cue effects receive
			// the
			// boundary hit already consumed by the outgoing effect.
			const recent = HIT_LEAD_CAP + 0.02;
			if (t - this.lastKickAt <= recent) f.kick = true;
			if (t - this.lastSnareAt <= recent) f.snare = true;
			if (t - this.lastHatAt <= recent) f.hat = true;
		}

		// Begin the fade early so it completes on the boundary downbeat.
		let u = 0;
		if (next && next.fadeBeats > 0) {
			const fadeStart = next.start - next.fadeBeats * f.beatPeriod;
			if (t >= fadeStart) u = clamp((t - fadeStart) / (next.start - fadeStart));
		}

		if (u > 0 && next) {
			blendPalettes(this.paletteScratch, active.palette, next.palette, u);
			this.mixer.palette = this.paletteScratch;
			this.mixer.intensity = active.intensity + (next.intensity - active.intensity) * u;
			this.mixer.motion = active.motion + (next.motion - active.motion) * u;
			this.mixer.floor = lerpFloor(active, next, u);
		} else {
			this.mixer.palette = active.palette;
			this.mixer.intensity = active.intensity;
			this.mixer.motion = active.motion;
			this.mixer.floor = floorFor(active.section);
		}
	}

	private installLayers(cue: CompiledCue): void {
		for (const role of LAYER_ROLES) {
			const layer = this.mixer.layers[role];
			const spec = cue.layers[role];
			if (!spec) {
				if (role === 'master' && this.activeHitMaster) continue;
				layer.setEffect(null, this.mixer.geometry);
				continue;
			}
			const def = this.registry.get(spec.effect);
			layer.setEffect(def, this.mixer.geometry);
			if (!def) continue;
			layer.opacity = spec.opacity ?? layer.opacity;
			if (spec.params) for (const [k, v] of Object.entries(spec.params)) layer.params[k] = v;
		}
	}

	private applyHits(t: number): void {
		const master = this.mixer.layers.master;
		this.mixer.dim = 1;

		let live: CompiledHit | null = null;
		for (const h of this.hits) {
			if (h.start > t) break;
			if (t >= h.end) continue;
			// Later wins among equals, so a second slam supersedes the tail of the first.
			if (!live || HIT_PRIORITY[h.kind] >= HIT_PRIORITY[live.kind]) live = h;
		}

		if (!live) {
			if (this.activeHitMaster) {
				master.params.trigger = 0;
				// Effect stays installed so its decay finishes; the next cue reclaims the slot.
				this.activeHitMaster = null;
			}
			return;
		}

		if (live.kind === 'blackout') {
			// Apply blackout through dim so even a floored, overlapping master hit goes dark.
			this.mixer.dim = 0.02;
			// Blackout must also remove the house floor.
			this.mixer.floor = 0;
			return;
		}

		if (this.activeHitMaster !== live.effect) {
			const def = live.effect ? this.registry.get(live.effect) : null;
			master.setEffect(def, this.mixer.geometry);
			if (live.params) for (const [k, v] of Object.entries(live.params)) master.params[k] = v;
			this.activeHitMaster = live.effect;
		}
		master.params.trigger = 1;
	}
}

/** Fade the floor with the cue to avoid a level step. */
function lerpFloor(from: CompiledCue, to: CompiledCue, u: number): number {
	const a = floorFor(from.section);
	const b = floorFor(to.section);
	return a + (b - a) * u;
}

function seekCursor(times: readonly number[], t: number): number {
	let i = 0;
	while (i < times.length && times[i] < t) i++;
	return i;
}

/**
 * Loudest hit crossed since the last frame, or 0. A later ghost note must not replace an
 * accent.
 */
function advance(
	stream: OnsetStream,
	t: number,
	cursor: number,
	store: (c: number) => void
): number {
	const { times, levels } = stream;
	let loudest = 0;
	let i = cursor;
	while (i < times.length && times[i] <= t) {
		const level = levels[i] ?? 1;
		if (level > loudest) loudest = level;
		i++;
	}
	if (i !== cursor) {
		store(i);
		// A hit with no level recorded is still a hit; only an empty span reports nothing.
		if (loudest <= 0) loudest = MIN_HIT_LEVEL;
	}
	return loudest > 0 ? Math.max(MIN_HIT_LEVEL, loudest) : 0;
}
