import type {
	BarRow,
	LevelTrack,
	OnsetStream,
	SectionSpan,
	SpectrumTrack,
	StereoImage,
	TrackAnalysis
} from '../contracts/analysis.ts';
import { ANALYSIS_VERSION } from '../contracts/analysis.ts';
import type {
	ClockSpec,
	LookSpec,
	NarrationPlan,
	Position,
	SilentPlan,
	SongPlan,
	StepSpec
} from '../contracts/evening.ts';
import type { SectionKind } from '../contracts/frame.ts';
import { sectionBase } from '../contracts/frame.ts';
import type { ShowPalette } from '../contracts/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import type { Cue, Hit, Show } from '../contracts/show.ts';
import { SHOW_VERSION, strobePerBeat } from '../contracts/show.ts';
import { hsv2rgb } from '../color/hsv.ts';
import { GLOW_SATURATION, makePalette, sample, swapped } from '../color/palette.ts';
import { GAMMA } from '../output.ts';
import { BARS_PER_PHRASE } from '../grid.ts';

/** Grid length for a hold, which has no end of its own. */
export const OPEN_LENGTH = 6 * 3600;

/** The grid runs past a silent row so the player's end-of-audio ease never shows inside it. */
const END_MARGIN = 2;

/** Passage energy a silent timeline reads by section, 0..1. Builds ramp between the ends. */
const SECTION_ENERGY: Record<SectionKind, number> = {
	void: 0.02,
	intro: 0.3,
	breakdown: 0.3,
	outro: 0.28,
	groove: 0.62,
	verse: 0.58,
	build: 0.45,
	drop: 0.95,
	chorus: 0.9
};
const BUILD_TOP = 0.9;

/** Measured against the resting scenes: this level and motion deliver the same light. */
export const CALM_INTENSITY = 0.85;
export const CALM_MOTION = 0.35;
const CALM_SECTION: SectionKind = 'outro';

/** Where the lite narration analysis's measured tracks come from. */
export interface MeasuredAudio {
	duration: number;
	level?: LevelTrack;
	spectrum?: SpectrumTrack;
	stereo?: StereoImage;
	integratedLufs?: number;
}

function fnv1a(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

interface Resolved {
	at: number;
	section: SectionKind;
	energy: number | null;
}

/** Sections and explicit energies over time, carried forward step to step. */
function resolveSteps(timeline: readonly StepSpec[], calm: boolean): Resolved[] {
	const out: Resolved[] = [];
	let section: SectionKind = calm ? CALM_SECTION : 'intro';
	let energy: number | null = null;
	const steps = [...timeline].sort((a, b) => a.at - b.at);
	if (steps.length === 0 || steps[0].at > 0) out.push({ at: 0, section, energy });
	for (const step of steps) {
		// A look, a hit or a kick alone leaves a build's ramp running.
		if (step.section === undefined && step.energy === undefined && out.length > 0) continue;
		if (step.section) {
			section = step.section;
			// A new section reads its own energy unless the step sets one.
			energy = null;
		}
		if (step.energy !== undefined) energy = step.energy;
		out.push({ at: step.at, section, energy });
	}
	return out;
}

function energyAt(spans: readonly { start: number; end: number; section: SectionKind; energy: number | null }[], t: number): number {
	for (const span of spans) {
		if (t < span.start || t >= span.end) continue;
		if (span.energy !== null) return span.energy;
		if (span.section === 'build') {
			const u = span.end > span.start ? (t - span.start) / (span.end - span.start) : 1;
			return SECTION_ENERGY.build + (BUILD_TOP - SECTION_ENERGY.build) * Math.min(1, Math.max(0, u));
		}
		return SECTION_ENERGY[span.section];
	}
	const last = spans[spans.length - 1];
	return last ? (last.energy ?? SECTION_ENERGY[last.section]) : SECTION_ENERGY.intro;
}

function pulseStreams(clock: ClockSpec, total: number, silentAt: (t: number) => boolean) {
	const kick: OnsetStream = { times: [], levels: [] };
	const snare: OnsetStream = { times: [], levels: [] };
	const hat: OnsetStream = { times: [], levels: [] };
	if (clock.pulse === 'none') return { kick, snare, hat };
	const beat = 60 / clock.bpm;
	for (let i = 0; i * beat < total; i++) {
		const t = i * beat;
		if (silentAt(t)) continue;
		const inBar = i % clock.beatsPerBar;
		const on = clock.pulse === 'four-on-the-floor' || inBar % 2 === 0;
		if (on) {
			kick.times.push(t);
			kick.levels.push(inBar === 0 ? 1 : 0.85);
		}
		if (clock.pulse !== 'kick' && inBar % 2 === 1) {
			snare.times.push(t);
			snare.levels.push(0.9);
		}
		if (clock.pulse === 'four-on-the-floor') {
			hat.times.push(t + beat / 2);
			hat.levels.push(0.6);
		}
	}
	return { kick, snare, hat };
}

/**
 * A bar grid on the segment's own clock with sections from its timeline, so effects get
 * beats, build progress and drops without audio. Measured level and spectrum come from a
 * narration's own audio when there is one.
 */
export function silentAnalysis(
	key: string,
	plan: Pick<SilentPlan, 'title' | 'length' | 'clock' | 'timeline' | 'calm'>,
	measured?: MeasuredAudio
): TrackAnalysis {
	const clock = plan.clock;
	const length = plan.length ?? OPEN_LENGTH;
	const total = length + END_MARGIN;
	const beatPeriod = 60 / clock.bpm;
	const barLength = beatPeriod * clock.beatsPerBar;
	const barCount = Math.max(1, Math.ceil(total / barLength));
	const barTimes = Array.from({ length: barCount + 1 }, (_, i) => i * barLength);

	const steps = resolveSteps(plan.timeline, plan.calm);
	const spans = steps.map((s, i) => ({
		start: s.at,
		end: i + 1 < steps.length ? steps[i + 1].at : barCount * barLength,
		section: s.section,
		energy: s.energy
	}));
	const sectionAt = (t: number): SectionKind => {
		let kind = spans[0]?.section ?? 'intro';
		for (const span of spans) if (t >= span.start) kind = span.section;
		return kind;
	};

	const beatCount = barCount * clock.beatsPerBar;
	const energy: number[] = new Array(beatCount);
	const bands: number[] = new Array(beatCount * 4);
	for (let b = 0; b < beatCount; b++) {
		const t = (b + 0.5) * beatPeriod;
		const e = energyAt(spans, t);
		energy[b] = Math.round(e * 100);
		bands[b * 4] = Math.round(e * 90);
		bands[b * 4 + 1] = Math.round(e * 80);
		bands[b * 4 + 2] = Math.round(e * 55);
		bands[b * 4 + 3] = Math.round((sectionAt(t) === 'build' ? Math.min(1, e / BUILD_TOP) : e * 0.45) * 100);
	}

	const onsets = pulseStreams(clock, total, (t) => sectionAt(t) === 'void');
	const placed = plan.timeline.filter((s) => s.kick !== undefined && s.at < total);
	if (placed.length > 0) {
		const kicks = [
			...onsets.kick.times.map((t, i) => ({ t, level: onsets.kick.levels[i] })),
			...placed.map((s) => ({ t: s.at, level: s.kick! }))
		].sort((a, b) => a.t - b.t);
		onsets.kick = { times: kicks.map((k) => k.t), levels: kicks.map((k) => k.level) };
	}
	const countIn = (times: number[], from: number, to: number) => times.filter((t) => t >= from && t < to).length;

	const bars: BarRow[] = [];
	for (let i = 0; i < barCount; i++) {
		const from = barTimes[i];
		const to = barTimes[i + 1];
		let sum = 0;
		for (let k = 0; k < clock.beatsPerBar; k++) sum += energy[i * clock.beatsPerBar + k];
		const mean = Math.round(sum / clock.beatsPerBar);
		bars.push({
			bar: i,
			t: from,
			section: sectionAt(from),
			energy: mean,
			sub: Math.round(mean * 0.9),
			low: Math.round(mean * 0.8),
			mid: Math.round(mean * 0.55),
			air: Math.round(mean * 0.45),
			kicks: countIn(onsets.kick.times, from, to),
			snares: countIn(onsets.snare.times, from, to),
			hats: countIn(onsets.hat.times, from, to),
			vocal: 0,
			events: []
		});
	}

	// Merge consecutive spans of one kind; each section keeps exact times, bars are indicative.
	const merged: { kind: SectionKind; start: number; end: number }[] = [];
	for (const span of spans) {
		if (span.end <= span.start) continue;
		const prev = merged[merged.length - 1];
		if (prev && prev.kind === span.section && Math.abs(prev.end - span.start) < 1e-9) prev.end = span.end;
		else merged.push({ kind: span.section, start: span.start, end: span.end });
	}
	const means = merged.map((m) => energyAt(spans, (m.start + m.end) / 2));
	const ranked = [...means].sort((a, b) => b - a);
	const sections: SectionSpan[] = merged.map((m, index) => {
		const startBar = Math.min(barCount - 1, Math.floor(m.start / barLength + 1e-9));
		const endBar = Math.max(startBar + 1, Math.min(barCount, Math.ceil(m.end / barLength - 1e-9)));
		const mean = Math.round(means[index] * 100);
		return {
			index,
			kind: m.kind,
			startBar,
			endBar,
			startTime: m.start,
			endTime: m.end,
			lengthBars: endBar - startBar,
			meanEnergy: mean,
			peakEnergy: mean,
			energyRank: ranked.indexOf(means[index]) + 1,
			group: index,
			repeatOf: null
		};
	});

	return {
		version: ANALYSIS_VERSION,
		hash: `evening-${fnv1a(`${key}|${JSON.stringify(plan)}`)}`,
		trackId: key,
		title: plan.title,
		// Narration audio ends like a song's: the player eases out where its level track goes quiet.
		duration: measured ? Math.max(measured.duration, length) : total,
		sampleRate: 22050,
		tempo: {
			bpm: clock.bpm,
			confidence: 1,
			firstBeat: 0,
			beatPeriod,
			beatsPerBar: clock.beatsPerBar,
			downbeatPhase: 0,
			phraseAnchorBar: 0,
			barsPerPhrase: BARS_PER_PHRASE,
			constant: true,
			meterConfidence: 1,
			ambiguous: false,
			alternativeBpm: [],
			barTimes
		},
		key: { tonic: 0, name: 'C major', mode: 'major', confidence: 0 },
		bars,
		sections,
		moments: [],
		beats: [],
		envelopes: { energy, bands },
		spectrum: measured?.spectrum ?? { fps: 50, bands: 0, centreHz: [], data: '' },
		...(measured?.level ? { level: measured.level } : {}),
		stereo: measured?.stereo ?? { fps: 25, pan: [], width: [] },
		onsets,
		integratedLufs: measured?.integratedLufs ?? -70,
		loudnessRange: 0,
		peakToLoudness: 0
	};
}

/** The show a silent row or a narration plays: one cue per step, hits where steps ask. */
export function silentShow(analysis: TrackAnalysis, plan: SilentPlan | NarrationPlan): Show {
	const calm = plan.kind === 'silent' && plan.calm;
	const barLength = analysis.tempo.beatPeriod * analysis.tempo.beatsPerBar;
	const steps = [...plan.timeline].sort((a, b) => a.at - b.at);

	const cues: Cue[] = [];
	const hits: Hit[] = [];
	let look: LookSpec = { layers: {} };
	let palette: ShowPalette = plan.palette;
	let section: SectionKind = calm ? CALM_SECTION : 'intro';
	let intensity = calm ? CALM_INTENSITY : 1;
	let motion = calm ? CALM_MOTION : 1;
	let floor: number | undefined;

	for (const step of steps) {
		const changed =
			step.look !== undefined ||
			step.palette !== undefined ||
			step.section !== undefined ||
			step.intensity !== undefined ||
			step.motion !== undefined ||
			cues.length === 0;
		if (step.look) {
			look = step.look;
			if (look.intensity !== undefined) intensity = look.intensity;
			if (look.motion !== undefined) motion = look.motion;
			floor = look.floor;
		}
		if (step.palette) palette = step.palette;
		else if (step.look?.palette) palette = step.look.palette;
		if (step.section) section = step.section;
		if (step.intensity !== undefined) intensity = step.intensity;
		if (step.motion !== undefined) motion = step.motion;

		const bar = cues.length === 0 ? 0 : step.at / barLength;
		if (changed) {
			const cue: Cue = {
				bar,
				section,
				layers: look.layers,
				palette,
				intensity,
				motion,
				fadeBeats: step.fade ?? 0,
				...(floor !== undefined ? { floor } : {}),
				note: ''
			};
			if (cues.length > 0 && Math.abs(cues[cues.length - 1].bar - bar) < 1e-9) cues[cues.length - 1] = cue;
			else cues.push(cue);
		}
		if (step.hit) {
			const whole = Math.floor(step.at / barLength + 1e-9);
			const beat = (step.at / barLength - whole) * analysis.tempo.beatsPerBar;
			hits.push({
				bar: whole,
				...(beat > 1e-6 ? { beat } : {}),
				kind: step.hit,
				beats: step.beats ?? 1,
				...(step.hit === 'strobe' ? { params: { perBeat: strobePerBeat(analysis.tempo) } } : {})
			});
		}
	}
	if (cues.length === 0) {
		cues.push({ bar: 0, section, layers: {}, palette, intensity, motion, fadeBeats: 0, note: '' });
	}

	return {
		version: SHOW_VERSION,
		trackId: analysis.trackId,
		title: analysis.title,
		analysisHash: analysis.hash,
		brief: '',
		authoredBy: 'engine',
		exposure: 'fixed',
		...(plan.kind === 'narration' && plan.end === 'hold' ? { ending: 'hold' as const } : {}),
		palette: plan.palette,
		defaults: { intensity: calm ? CALM_INTENSITY : 1, motion: calm ? CALM_MOTION : 1, fadeBeats: 0 },
		generatedEffects: plan.effects,
		cues,
		hits
	};
}

function wrap(h: number): number {
	return ((h % 360) + 360) % 360;
}

/** How far a chapter tint may change the light a song's colour delivers, as a fraction. */
const TINT_TOLERANCE = 0.15;
/** The furthest a chapter tint turns any of a song's hues, degrees. */
const TINT_TURN = 60;
/** The most a cue's intensity moves to take back light a tint still changed. */
const TINT_LEVEL_MIN = 0.85;
const TINT_LEVEL_MAX = 1.18;
/** Where effects draw from a palette's ramp, weighted by how often the built-in effects do. */
const DRAWN: readonly (readonly [number, number])[] = [
	[SLOT.deep, 0.08],
	[SLOT.base, 0.3],
	[(SLOT.base + SLOT.glow) / 2, 0.1],
	[SLOT.glow, 0.2],
	[SLOT.white, 0.15],
	[SLOT.third, 0.09],
	[SLOT.accent, 0.08]
];

/** Linear light of an encoded colour, through the output gamma. */
function luma(r: number, g: number, b: number): number {
	return 0.2126 * r ** GAMMA + 0.7152 * g ** GAMMA + 0.0722 * b ** GAMMA;
}

/** The light a palette hue delivers at full value, 0..1, on the room's ramp. */
function lightness(hue: number, sat: number): number {
	const [r, g, b] = hsv2rgb(hue / 360, sat, 1);
	return luma(r, g, b);
}

/** The light a palette delivers where effects draw from it. */
function delivered(p: ShowPalette): number {
	const ramp = makePalette(p);
	let sum = 0;
	for (const [u, weight] of DRAWN) {
		const [r, g, b] = sample(ramp, u);
		sum += weight * luma(r, g, b);
	}
	return sum;
}

/**
 * Turn a hue toward another, at most a sixth of the wheel, and only as far as the light it
 * delivers stays near where it was: on the room's ramp yellow reads bright and blue dim, and a
 * song's intensity is its own.
 */
function toward(from: number, to: number, sat: number): number {
	const arc = Math.max(-TINT_TURN, Math.min(TINT_TURN, ((((to - from) % 360) + 540) % 360) - 180));
	// Saturated and faded to glow, a hue's light can move apart; both have to hold.
	const full = lightness(from, sat);
	const glow = lightness(from, sat * GLOW_SATURATION);
	let reached = from;
	for (let step = 1; step <= 24; step++) {
		const hue = wrap(from + (arc * step) / 24);
		if (Math.abs(lightness(hue, sat) - full) > TINT_TOLERANCE * Math.max(full, 0.02)) break;
		if (Math.abs(lightness(hue, sat * GLOW_SATURATION) - glow) > TINT_TOLERANCE * Math.max(glow, 0.02)) break;
		reached = hue;
	}
	return reached;
}

/**
 * A chapter's colours on one of a song's palettes: each of the song's hues turns toward the
 * nearest of the chapter's, so the chapter tints the song while its saturation, shade, white
 * and intensity stay its own.
 */
function tinted(own: ShowPalette, chapter: ShowPalette): ShowPalette {
	const sat = own.sat ?? 0.94;
	const hues = [chapter.base, chapter.accent, chapter.third ?? chapter.accent];
	const nearest = (hue: number) =>
		hues.reduce((best, h) => (Math.abs(((((h - hue) % 360) + 540) % 360) - 180) < Math.abs(((((best - hue) % 360) + 540) % 360) - 180) ? h : best));
	const base = toward(own.base, nearest(own.base), sat);
	const accent = toward(own.accent, nearest(own.accent), sat);
	// A monochrome song folds its third onto the base; it stays folded.
	const third =
		own.third === undefined ? undefined : own.third === own.base ? base : toward(own.third, nearest(own.third), sat);
	return { ...own, ...(chapter.name ? { name: chapter.name } : {}), base, accent, ...(third !== undefined ? { third } : {}) };
}

/** The bar a position names in this analysis, or null when the song has no such place. */
export function barAt(analysis: TrackAnalysis, position: Position): number | null {
	const count = analysis.bars.length;
	if (position === 'start') return 0;
	if (position === 'end') return count;
	const drops = analysis.sections.filter((s) => sectionBase(s.kind) === 'drop');
	if (position === 'first-drop') return drops[0]?.startBar ?? null;
	if (position === 'last-drop') return drops[drops.length - 1]?.startBar ?? null;
	if (position === 'peak') return analysis.sections.find((s) => s.energyRank === 1)?.startBar ?? null;
	if ('bar' in position) return Math.min(count, Math.max(0, Math.round(position.bar)));
	const matching = analysis.sections.filter((s) => s.kind === position.section);
	return matching[(position.nth ?? 1) - 1]?.startBar ?? null;
}

/** An evening song's show: its look, overlays and entry hit laid over the engine's show. */
export function songShow(analysis: TrackAnalysis, show: Show, plan: SongPlan): Show {
	let cues = [...show.cues].sort((a, b) => a.bar - b.bar);
	let palette = show.palette;
	if (plan.palette) {
		const chapter = plan.palette;
		const own = show.palette;
		const tint = tinted(own, chapter);
		palette = tint;
		const ownLight = delivered(own);
		cues = cues.map((c) => {
			const from = typeof c.palette === 'object' ? c.palette : c.palette === 'swap' ? swapped(own) : own;
			const to = typeof c.palette === 'object' ? tinted(c.palette, chapter) : c.palette === 'swap' ? swapped(tint) : tint;
			// The cue's level takes back what light the new hues still change; a look's palette replaces them.
			const light = from === own ? ownLight : delivered(from);
			const level = plan.look?.palette ? 1 : Math.min(TINT_LEVEL_MAX, Math.max(TINT_LEVEL_MIN, light / delivered(to)));
			return {
				...c,
				...(typeof c.palette === 'object' ? { palette: to } : {}),
				intensity: (c.intensity ?? show.defaults.intensity) * level
			};
		});
	}
	const look = plan.look;
	if (look) {
		const typical = show.defaults.intensity || 0.7;
		// A look over a song still rises and falls with the song's sections; pause music sits calmer.
		const levelOf = (c: Cue) => {
			const own = c.intensity ?? show.defaults.intensity;
			return plan.calm ? Math.max(0.5, Math.min(1.05, CALM_INTENSITY * (own / typical))) : own;
		};
		cues = cues.map((c) => ({
			...c,
			layers: look.layers,
			...(look.palette ? { palette: look.palette } : {}),
			intensity: look.intensity ?? levelOf(c),
			...(look.motion !== undefined ? { motion: look.motion } : plan.calm ? { motion: CALM_MOTION } : {}),
			...(look.floor !== undefined ? { floor: look.floor } : {})
		}));
	}

	// Calm music keeps its lighting calm: the engine's punctuation belongs to the show it replaced.
	let hits = plan.calm ? [] : [...show.hits];

	for (const overlay of plan.overlays) {
		const from = barAt(analysis, overlay.from);
		const to = barAt(analysis, overlay.to);
		if (from === null || to === null || to <= from) continue;
		const activeAt = (bar: number) => {
			let active = cues[0];
			for (const c of cues) if (c.bar <= bar) active = c;
			return active;
		};
		const opening = activeAt(from);
		const resume = to < analysis.bars.length && !cues.some((c) => c.bar === to) ? { ...activeAt(to), bar: to } : null;
		const kept = cues.filter((c) => c.bar < from || c.bar >= to);
		const section = analysis.bars[from]?.section ?? opening?.section ?? 'intro';
		const cue: Cue = {
			bar: from,
			section,
			layers: overlay.look.layers,
			palette: overlay.look.palette ?? opening?.palette ?? 'inherit',
			intensity: overlay.look.intensity ?? opening?.intensity,
			motion: overlay.look.motion ?? opening?.motion,
			fadeBeats: 0,
			...(overlay.look.floor !== undefined ? { floor: overlay.look.floor } : {}),
			note: 'evening overlay'
		};
		cues = [...kept, cue, ...(resume ? [resume] : [])].sort((a, b) => a.bar - b.bar);
		// The overlay owns its bars; its own end hit replaces the engine's on the bar it hands back.
		hits = hits.filter((h) => h.bar < from || h.bar > to || (h.bar === to && (!overlay.end || (h.beat ?? 0) > 0)));
	}

	for (const overlay of plan.overlays) {
		const to = barAt(analysis, overlay.to);
		if (!overlay.end || to === null || to >= analysis.bars.length) continue;
		hits.push({
			bar: to,
			kind: overlay.end,
			beats: 1,
			...(overlay.end === 'strobe' ? { params: { perBeat: strobePerBeat(analysis.tempo) } } : {})
		});
	}
	if (plan.hit) {
		hits.push({
			bar: 0,
			kind: plan.hit,
			beats: 1,
			...(plan.hit === 'strobe' ? { params: { perBeat: strobePerBeat(analysis.tempo) } } : {})
		});
	}

	const known = new Set(show.generatedEffects.map((g) => g.id));
	return {
		...show,
		...(look ? { exposure: 'fixed' as const } : {}),
		palette,
		cues,
		hits,
		generatedEffects: [...show.generatedEffects, ...plan.effects.filter((g) => !known.has(g.id))]
	};
}
