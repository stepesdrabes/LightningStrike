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

/**
 * The dimmest a hit may fire at. A ghost note is quiet, not absent, and an envelope that can
 * reach zero turns "the detector was unsure" into "nothing happened".
 */
const MIN_HIT_LEVEL = 0.35;

/**
 * How much house floor each section gets, before the cue's own layers.
 *
 * A void is zero because darkness is its whole instruction, and the quiet sections get the most
 * because they are the ones whose layers do not carry the room: a bed is written to sit under
 * something and a breakdown has almost nothing on top of it. A drop needs none - it is already
 * four bright layers - and giving it one would only eat the headroom the highlight compressor
 * needs.
 *
 * The quiet three have come down by more than half from where they were, in three steps, as the
 * catalog gained layers that carry a room on their own. The floor was compensating for cues whose
 * second layer emitted nothing, and a compensation left in place after its cause is fixed is just
 * contrast spent for nothing: the room reads the difference between a verse and a drop, not the
 * absolute level of either. Every quiet section still lights 99-100% of the LEDs.
 *
 * The third step came with the planner preferring layers that actually show the music in a quiet
 * cue. Those are brighter as well as livelier, so leaving the floor where it was pushed the
 * drop-to-quiet ratio from 3.43 down to 2.79, under its 3.2 floor: the same contrast, spent twice.
 * The outro comes down least because its bed pool barely changed.
 *
 * **These are authoring values chosen for the light they make**, so they moved when `GAMMA` did:
 * each is the old number raised to `2.2 / 2.45`, which makes `floor ^ 2.45` exactly what
 * `floor ^ 2.2` used to be. Every floor emits what it always did and every ratio between them is
 * untouched, which is the point - the contrast above was measured, and a curve change is not a
 * licence to spend it. Re-derive them the same way if the exponent moves again.
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
 * How far ahead of the playhead a drum hit is read, as a fraction of the beat, and its ceiling.
 *
 * The one number to turn if the room feels early or late against the real strips: DDP and WLED add
 * their own transport delay, which this cannot know and which pushes in the opposite direction.
 * Raising it makes the room anticipate; zero restores the old behaviour exactly.
 */
const HIT_LEAD_BEATS = 0.06;
const HIT_LEAD_CAP = 0.045;


function floorFor(section: SectionKind): number {
	return Math.min(1, SECTION_FLOOR[section] ?? 0);
}

/**
 * Which effect each punctuation kind installs in the master layer.
 *
 * A table rather than using the kind as the id directly, so the show's vocabulary is a small
 * closed set of gestures and the catalog is free to rename what performs one.
 */
const HIT_EFFECT: Record<Hit['kind'], string | null> = {
	blackout: null,
	slam: 'slam',
	strobe: 'strobe',
	bump: 'colorBump'
};

/**
 * Which punctuation wins when two overlap.
 *
 * They overlap by design: the strobe runs out of the build and the held-breath blackout is cut
 * from its last bar, so the two are live at the same instant on purpose. Resolving that by
 * taking whichever started first handed it to the strobe every time, and 9 of 117 planned hits
 * across the corpus never fired - every one of them the blackout before a drop, which is the
 * single strongest move in the vocabulary.
 *
 * A cut beats a flash because a cut is the absence of light and cannot be expressed by adding
 * any; a slam beats a bump because it is the bigger card.
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

	/**
	 * Forget the loaded show entirely.
	 *
	 * `reset()` rewinds a show to its start; this is for when there is no longer a show at all,
	 * which is what a queue moving to a track that has not been composed yet leaves behind.
	 */
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

		// Phrases count from the section start, not from a global anchor: the audience counts
		// from the drop, and a track whose phase shifts mid-song has no single grid to count on.
		this.barSectionStart = new Int32Array(nBars);
		this.barSectionOrdinal = new Int32Array(nBars);
		for (const s of analysis.sections) {
			for (let b = Math.max(0, s.startBar); b < Math.min(nBars, s.endBar); b++) {
				this.barSectionStart[b] = s.startBar;
				this.barSectionOrdinal[b] = s.index;
			}
		}

		// Beat resolution where the analysis has it, falling back to the bar table for a blob
		// written before it did. Bar 0 begins at beat `downbeatPhase`, so that is what turns a
		// bar position into an index into the beat-aligned arrays.
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

		// Decoded once here rather than per frame: it is the largest thing in the analysis and a
		// blob written before the spectrum existed simply has none, which reads as a flat zero.
		const spectrum = analysis.spectrum;
		this.spectrumData = spectrum?.data ? decodeBase64(spectrum.data) : new Uint8Array(0);
		this.spectrumBands = spectrum?.bands ?? 0;
		this.spectrumFps = spectrum?.fps || 50;

		this.panCurve = Float32Array.from(analysis.stereo?.pan ?? []);
		this.widthCurve = Float32Array.from(analysis.stereo?.width ?? []);
		this.stereoFps = analysis.stereo?.fps || 25;


		this.sectionBounds = analysis.sections.map((s) => ({ start: s.startTime, end: s.endTime }));
		// Drop-CLASS arrivals, not the literal kind: a chorus is the song vocabulary's drop, and
		// build progress that never reaches 1.0 on a pop track starves every effect that climbs.
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
			// Merge a build immediately followed by a void so the progress bar keeps climbing
			// through the silence instead of restarting.
			const existing = this.buildSpans.at(-1);
			if (existing && Math.abs(existing.end - drop.startTime) < 1e-6) continue;
			this.buildSpans.push({ start: s.startTime, end: drop.startTime });
		}

		// The registry belongs to the caller, which has already registered this show's
		// generated effects by now. Clearing it here would render every cue naming one black.
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
				// A hit's length is in beats of the bar it lands in, not of the track average,
				// so a two-beat slam is two beats long wherever the tempo happens to be.
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
		// Every index comes off the bar table, so the frame cannot disagree with the cue list
		// about where it is. Deriving the beat from the bar rather than the other way round is
		// what keeps them consistent when the bar is not exactly beatsPerBar * beatPeriod long.
		const barsF = barAtTime(tempo, t);
		const barIndex = Math.floor(barsF);
		const barPhase = barsF - barIndex;

		// Section-relative phrase: origin at the section start, ordinal folded into the index
		// so a phrase edge fires at every section change even when both sides read zero.
		const nBars = this.barSectionStart.length;
		const clamped = Math.min(Math.max(barIndex, 0), Math.max(0, nBars - 1));
		const origin = nBars > 0 ? this.barSectionStart[clamped] : tempo.phraseAnchorBar;
		const ordinal = nBars > 0 ? this.barSectionOrdinal[clamped] : 0;
		const phrasesF = (barsF - origin) / tempo.barsPerPhrase;

		const beatsF = (barIndex + barPhase) * tempo.beatsPerBar;
		const beatIndex = Math.floor(beatsF);
		const phraseIndex = ordinal * 4096 + Math.floor(phrasesF);

		// Local, not the track median: an effect that derives its time constants from this on a
		// track that speeds up should speed up with it.
		const barDuration = barDurationAt(tempo, barIndex);
		const beatPeriod = barDuration / Math.max(1, tempo.beatsPerBar);

		f.beatIndex = beatIndex;
		f.barIndex = barIndex;
		f.beatPhase = beatsF - beatIndex;
		f.barPhase = barPhase;
		f.phrasePhase = frac(phrasesF);
		f.beatPeriod = beatPeriod;
		f.bpm = beatPeriod > 1e-6 ? 60 / beatPeriod : tempo.bpm;

		// Edge detection by index change, never by phase threshold, so a beat cannot
		// double-fire on a slow frame or be skipped on a fast one.
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
			// Minus half an entry, because an entry is the MEAN over its span and therefore
			// describes its centre. Reading it at the span's start is what put the whole envelope
			// half a bar ahead of the audio.
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

	/**
	 * The spectrum at `t`, resampled onto however many bands the frame carries.
	 *
	 * Minus half an entry for the same reason the envelopes take it: an entry is the mean over
	 * its span and so describes the span's centre. The band count is read off the blob rather
	 * than assumed, so a show authored against a different one still plays.
	 */
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
		// Read slightly AHEAD of the playhead, so the light is already at full when the hit
		// arrives rather than starting then. Two reasons, and they point the same way.
		//
		// Mechanical: an onset is consumed on the first frame at or after it, which at 60 fps is
		// up to 16.7 ms late on its own, before anything downstream adds more.
		//
		// Perceptual: the tolerance is strongly asymmetric. ITU-R BT.1359-1 puts detectability at
		// 45 ms when the picture leads and 125 ms when it lags, so early is roughly three times
		// cheaper than late; a sound within about 100 ms pulls a flash onto itself and tightens
		// its apparent timing (temporal ventriloquism); and a listener's own sense of "on the
		// beat" already runs 20-80 ms early. Spend the uncertainty on the early side.
		//
		// Derived from the beat period so it stays a musical fraction, and capped well inside a
		// sixteenth at every tempo: 30 ms at 120 bpm, 21 ms at 174 bpm.
		const lead = Math.min(HIT_LEAD_CAP, HIT_LEAD_BEATS * f.beatPeriod);
		const at = t + lead;
		// Fired at the hit's own strength, floored so the quietest ghost note still registers as
		// an event. Firing every hit at 1.0 made `kickEnv` exactly 1.0 on every kick frame in the
		// corpus, which gave `kickTunnel` one ring size for every track ever played.
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
			// A hit landing ON the boundary was consumed a frame or two ago by the anticipation
			// lead - up to ~30 ms early, on purpose - so its one-frame edge fired into the
			// OUTGOING effect and the incoming one heard silence. Exactly the hits an incoming
			// drop effect exists for. Re-assert any edge younger than the lead plus a frame, so
			// the fresh instance sees the kick it was installed to answer; the envelopes carry
			// across on their own, this is only the boolean.
			const recent = HIT_LEAD_CAP + 0.02;
			if (t - this.lastKickAt <= recent) f.kick = true;
			if (t - this.lastSnareAt <= recent) f.snare = true;
			if (t - this.lastHatAt <= recent) f.hat = true;
		}

		// The fade begins fadeBeats early and completes exactly ON the boundary downbeat,
		// which is how a lighting desk runs a cue: the change arrives with the music.
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
			this.mixer.intensity *= 0.02;
			// The floor goes with it, or the room would sit at its resting level through the one
			// move whose whole point is that the room does not.
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

/** The floor across a cue fade, so the room does not step as one look hands over to the next. */
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
 * How hard the loudest hit crossed since the last frame was struck, 0 when none did.
 *
 * The loudest rather than the last: at 30 fps a frame can span two sixteenths, and letting a
 * ghost note that happened to be second overwrite the accent that opened the frame is exactly
 * the wrong way round.
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
