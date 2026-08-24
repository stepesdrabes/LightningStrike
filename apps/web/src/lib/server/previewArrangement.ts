import type { BarRow, Moment, SectionKind, SectionSpan, TrackAnalysis } from '@mv/core';
import { SECTION_KINDS, barAtTime, barTimeAt, nearestBar } from '@mv/core';
import { barStartsAtCuts, deriveGridCuts, handMapGrid, resyncedCuts } from '@mv/analysis';
import type { JudgedSection } from './judge.ts';

/**
 * The analysis re-sectioned along the owner's hand-drawn map, for an ephemeral preview.
 *
 * Three fields have to move together, not two. `sections` is what the planner reads, but the
 * PLAYER builds every frame's `section` from the per-bar `bars[].section` column, and the
 * linter reads that column as well - so replacing only the span table produced cues written
 * for the new arrangement running against effects that still saw the old one. That is what
 * made the preview look inert in the room. `moments` follows for the same reason.
 *
 * Everything else stays shared with the cached blob: tempo, envelopes and onsets are
 * measurements, and nothing here mutates what it is handed.
 */
/**
 * The bar table a map implies, with a bar line AT every boundary the owner placed off one.
 *
 * A section starts on a bar line or not at all, so a boundary drawn between two of them can
 * only be rounded - which is what the room reported as the preview "snapping to something
 * different". A boundary placed off the grid is a statement ABOUT the grid, and the analysis
 * already knows how to answer it: the listener cut, which absorbs the offset as one short bar
 * ending exactly at the mark. This does the same thing to the cached table so the preview
 * shows what the next analysis will produce, rather than a rounded stand-in for it.
 *
 * WHICH cuts is not this side's decision: `handMapGrid` answers it and `resyncedCuts` says
 * where the bar count is handed back, exactly as the next analysis will ask them. Two
 * consumers reading one map through two readings of the same rule is the bug this whole area
 * keeps producing - deriving the cuts here independently lost the ones the cached table
 * already carried, which moved boundaries the owner drew nowhere near the cut.
 *
 * Returns null when the map implies no cuts, which is the common case and needs no work.
 */
function regridForMap(
	analysis: TrackAnalysis,
	hand: readonly JudgedSection[]
): { tempo: TrackAnalysis['tempo']; bars: BarRow[] } | null {
	const tempo = analysis.tempo;
	const beats = analysis.beats;
	if (!beats || beats.length < 8 || !tempo.barTimes?.length) return null;

	const beatAt = (t: number) => {
		let best = 0;
		for (let i = 1; i < beats.length; i++) {
			if (Math.abs(beats[i] - t) < Math.abs(beats[best] - t)) best = i;
		}
		return best;
	};

	// Skipping the first everywhere: its start is where the track begins, not a statement
	// about a bar line, and the analysis reads the map off the same slice.
	const boundaries = hand.slice(1).map((s) => s.startTime);
	const deliberate = hand
		.slice(1)
		.filter((s) => s.offGrid === true && Number.isFinite(s.startTime))
		.map((s) => s.startTime);
	const grid = handMapGrid(
		boundaries,
		{ beats, barTimes: tempo.barTimes, beatsPerBar: tempo.beatsPerBar },
		deliberate
	);
	// The analysis reads a map drawn on a UNIFORM grid through its residues instead, so the
	// preview has to as well, or the two split apart on exactly the maps that carry no flag.
	const cutTimes =
		grid.gridCuts ??
		deriveGridCuts(boundaries, Float64Array.from(beats), tempo.beatsPerBar, tempo.downbeatPhase);
	const cutBeats = resyncedCuts(
		cutTimes.filter(Number.isFinite).map(beatAt),
		deliberate.map(beatAt),
		boundaries.filter(Number.isFinite).map(beatAt),
		beats.length,
		tempo.beatsPerBar,
		tempo.downbeatPhase
	).filter((i) => i > 0 && i < beats.length - 1);
	if (cutBeats.length === 0) return null;

	const starts = barStartsAtCuts(beats.length, tempo.beatsPerBar, tempo.downbeatPhase, cutBeats);
	const barTimes = starts.map((i) => Math.round(beats[i] * 1000) / 1000);
	// Each new bar takes its measurements from the old bar its middle falls in. The analysis
	// re-derives these from the audio on the next play; a preview only has to be right about
	// WHERE the bars are, and the two bars either side of a cut are the only approximate ones.
	const bars: BarRow[] = [];
	for (let b = 0; b < barTimes.length - 1; b++) {
		const middle = (barTimes[b] + barTimes[b + 1]) / 2;
		let src = 0;
		for (let i = 1; i < analysis.bars.length; i++) {
			if (analysis.bars[i].t <= middle) src = i;
			else break;
		}
		bars.push({ ...analysis.bars[src], bar: b, t: barTimes[b] });
	}
	return { tempo: { ...tempo, barTimes }, bars };
}

export function applyHandSections(analysis: TrackAnalysis, hand: JudgedSection[]): TrackAnalysis | null {
	// A time that is not a number is not a boundary. The judgement is written by the panel and
	// read back as data, so nothing upstream guarantees the shape; without this the spans come
	// out NaN, most of the track ends up covered by no section at all, and `composeShow`
	// quietly lights the whole thing as an outro rather than failing.
	const drawn = hand.filter((s) => Number.isFinite(s.startTime));
	if (drawn.length < 2) return null;
	// The grid first: a boundary the owner placed off a bar line becomes one, so what follows
	// reads it exactly instead of rounding it onto the nearest bar the old table happened to
	// have. Without cuts this is the cached table unchanged.
	const regrid = regridForMap(analysis, drawn);
	const gridded: TrackAnalysis = regrid
		? { ...analysis, tempo: regrid.tempo, bars: regrid.bars }
		: analysis;
	const sections = rebuildSections(gridded, drawn);
	// The analyser refuses a map that collapses to a single span, and the preview has to
	// refuse the same ones, or it previews an arrangement the room will never adopt.
	if (sections.length < 2) return null;
	return {
		...gridded,
		sections,
		bars: relabelBars(gridded.bars, sections),
		moments: rebuildMoments(gridded.moments, sections)
	};
}

/**
 * The per-bar section column, rewritten to the drawn map.
 *
 * A bar no span covers keeps whatever it had: the spans cover the track by construction, so
 * that is a bar past the end of the table rather than a hole in it.
 */
function relabelBars(bars: readonly BarRow[], sections: readonly SectionSpan[]): BarRow[] {
	const out = bars.map((b) => ({ ...b }));
	for (const s of sections) {
		for (let b = Math.max(0, s.startBar); b < Math.min(s.endBar, out.length); b++) {
			out[b].section = s.kind;
		}
	}
	return out;
}

/**
 * Hand maps keep `kind` a plain string so old maps survive vocabulary changes; a word the
 * current vocabulary does not know reads as the neutral middle of it.
 */
function coerceKind(kind: string): SectionKind {
	return (SECTION_KINDS as readonly string[]).includes(kind) ? (kind as SectionKind) : 'groove';
}

function rebuildSections(analysis: TrackAnalysis, hand: JudgedSection[]): SectionSpan[] {
	const barCount = analysis.bars.length;
	const drawn = [...hand].sort((a, b) => a.startTime - b.startTime);

	// Boundaries between consecutive drawn sections, snapped to the nearest bar. Times are the
	// authoritative coordinate on a hand map (its stored bars are fractional, and pinned to
	// whatever grid the map was drawn over), while the engine addresses cues by whole bars, so
	// the map rounds onto the current grid here. The first and last boundaries are forced to
	// the track's edges: the engine expects sections to cover every bar with no gaps.
	const bounds = drawn.map((s, i) =>
		i === 0 ? 0 : Math.max(0, Math.min(barCount, nearestBar(analysis.tempo, s.startTime)))
	);
	bounds.push(barCount);

	const spans: SectionSpan[] = [];
	let cursor = 0;
	for (let i = 0; i < drawn.length; i++) {
		const endBar = Math.min(barCount, bounds[i + 1]);
		// A sliver that rounded to nothing on the bar grid has nothing to light; its bars
		// belong to the neighbour that absorbed the boundary.
		if (endBar <= cursor) continue;

		let sum = 0;
		let peak = 0;
		for (let b = cursor; b < endBar; b++) {
			const e = analysis.bars[b].energy;
			sum += e;
			if (e > peak) peak = e;
		}
		const len = endBar - cursor;
		spans.push({
			index: spans.length,
			kind: coerceKind(drawn[i].kind),
			startBar: cursor,
			endBar,
			startTime: barTimeAt(analysis.tempo, cursor),
			endTime: barTimeAt(analysis.tempo, endBar),
			lengthBars: len,
			meanEnergy: Math.round(sum / len),
			peakEnergy: peak,
			energyRank: 0,
			group: -1,
			repeatOf: null
		});
		cursor = endBar;
	}

	// Preview-grade repeat grouping: same kind within a bar of the same length reads as the
	// same material. The analyser matches material by audio self-similarity, which a hand map
	// does not carry, so this is approximate on purpose. It only has to be right enough for
	// the picker to repeat a look across the obvious repeats, such as identical choruses.
	let nextGroup = 0;
	for (const s of spans) {
		const kin = spans.find(
			(o) => o.index < s.index && o.kind === s.kind && Math.abs(o.lengthBars - s.lengthBars) <= 1
		);
		if (kin) {
			s.group = kin.group;
			s.repeatOf = spans.find((o) => o.group === kin.group)!.index;
		} else {
			s.group = nextGroup++;
		}
	}

	// Ranked by mean, not peak, mirroring the analyser: a long mid-energy section containing
	// one loud bar must not outrank a short section that is loud the whole way through.
	[...spans]
		.sort((a, b) => b.meanEnergy - a.meanEnergy || b.peakEnergy - a.peakEnergy)
		.forEach((s, i) => {
			spans[s.index].energyRank = i + 1;
		});

	return spans;
}

/**
 * Only the section_start rows are section-derived; the event moments come from the bars,
 * which a hand map does not move, so they carry over unchanged. The note text mirrors the
 * analyser's format, so anything reading the preview analysis sees the same shape.
 */
function rebuildMoments(moments: Moment[], sections: SectionSpan[]): Moment[] {
	const out: Moment[] = moments.filter((m) => m.kind !== 'section_start');
	for (const s of sections) {
		out.push({
			bar: s.startBar,
			beat: 0,
			t: s.startTime,
			kind: 'section_start',
			note: `${s.kind} begins, ${s.lengthBars} bars, energy ${s.meanEnergy}${
				s.energyRank === 1 ? ', the peak of the track' : ''
			}${s.repeatOf !== null ? `, repeats section ${s.repeatOf}` : ''}`
		});
	}
	out.sort((a, b) => a.t - b.t || a.bar - b.bar);
	return out;
}
