import type { BarRow, Moment, SectionKind, SectionSpan, TrackAnalysis } from '@mv/core';
import { SECTION_KINDS, barTimeAt, nearestBar } from '@mv/core';
import { barStartsAtCuts, deriveGridCuts, handMapGrid, resyncedCuts } from '@mv/analysis';
import type { JudgedSection } from './judge.ts';

/**
 * Update sections, bars[].section and section-derived moments together so planner, player and
 * linter see one arrangement. Keep input measurements immutable.
 */
/**
 * Use handMapGrid and resyncedCuts, as analysis does, to honour deliberate off-grid boundaries
 * while retaining existing listener cuts. Return null if no cuts are needed.
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

	// The first map start is the track edge, not grid-correction evidence.
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
	// Match analysis's residue interpretation for maps drawn on uniform grids.
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
	// Preview bars reuse measurements from the old bar containing their midpoint; analysis later
	// recomputes them from audio.
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
	// Validate persisted boundary times before they can produce NaN spans.
	const drawn = hand.filter((s) => Number.isFinite(s.startTime));
	if (drawn.length < 2) return null;
	// Apply grid cuts before resolving section boundaries; no-cut maps reuse the cached grid.
	const regrid = regridForMap(analysis, drawn);
	const gridded: TrackAnalysis = regrid
		? { ...analysis, tempo: regrid.tempo, bars: regrid.bars }
		: analysis;
	const sections = rebuildSections(gridded, drawn);
	// Reject single-span maps just as analysis does.
	if (sections.length < 2) return null;
	return {
		...gridded,
		sections,
		bars: relabelBars(gridded.bars, sections),
		moments: rebuildMoments(gridded.moments, sections)
	};
}

/** Rewrite per-bar sections; bars past the covered table retain their previous value. */
function relabelBars(bars: readonly BarRow[], sections: readonly SectionSpan[]): BarRow[] {
	const out = bars.map((b) => ({ ...b }));
	for (const s of sections) {
		for (let b = Math.max(0, s.startBar); b < Math.min(s.endBar, out.length); b++) {
			out[b].section = s.kind;
		}
	}
	return out;
}

/** Unknown legacy section kinds fall back to neutral energy. */
function coerceKind(kind: string): SectionKind {
	return (SECTION_KINDS as readonly string[]).includes(kind) ? (kind as SectionKind) : 'groove';
}

function rebuildSections(analysis: TrackAnalysis, hand: JudgedSection[]): SectionSpan[] {
	const barCount = analysis.bars.length;
	const drawn = [...hand].sort((a, b) => a.startTime - b.startTime);

	// Round authoritative map times onto the current bar grid; force edge boundaries to cover the
	// track.
	const bounds = drawn.map((s, i) =>
		i === 0 ? 0 : Math.max(0, Math.min(barCount, nearestBar(analysis.tempo, s.startTime)))
	);
	bounds.push(barCount);

	const spans: SectionSpan[] = [];
	let cursor = 0;
	for (let i = 0; i < drawn.length; i++) {
		const endBar = Math.min(barCount, bounds[i + 1]);
		// Skip spans collapsed by bar rounding; neighbouring sections absorb them.
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

	// Approximate repeats by kind and near-equal length because hand maps contain no audio similarity
	// features.
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

	// Rank mean energy, matching analysis, so isolated peaks cannot dominate sustained loud sections.
	[...spans]
		.sort((a, b) => b.meanEnergy - a.meanEnergy || b.peakEnergy - a.peakEnergy)
		.forEach((s, i) => {
			spans[s.index].energyRank = i + 1;
		});

	return spans;
}

/** Rebuild section_start moments only; retain measured events and match analysis's note format. */
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
