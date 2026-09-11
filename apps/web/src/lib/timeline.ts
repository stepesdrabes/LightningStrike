import { LAYER_ROLES, barTimeAt, beatPeriodAt, type LayerRole, type Show, type TrackAnalysis } from '@mv/core';

interface TimelineSection {
	index: number;
	kind: string;
	start: number;
	end: number;
	title: string;
	lines: string[];
}

interface TimelineCue {
	bar: number;
	start: number;
	end: number;
	section: string;
	intensity: number;
	title: string;
	lines: string[];
}

interface TimelineMarker {
	kind: 'strobe' | 'blackout' | 'slam' | 'bump';
	start: number;
	/** Where the hit stops. A two-bar strobe has to read as longer than a one-bar one. */
	end: number;
	title: string;
	lines: string[];
}

export interface Timeline {
	sections: TimelineSection[];
	cues: TimelineCue[];
	markers: TimelineMarker[];
}

const EMPTY: Timeline = { sections: [], cues: [], markers: [] };

/** Convert bar-indexed show spans to a shared time axis for rendering and tests. */
export function buildTimeline(
	analysis: TrackAnalysis | null,
	show: Show | null,
	duration: number
): Timeline {
	if (!analysis || duration <= 0) return EMPTY;

	const sections: TimelineSection[] = analysis.sections.map((s) => ({
		index: s.index,
		kind: s.kind,
		start: s.startTime,
		end: s.endTime,
		title: s.kind,
		lines: [
			`bars ${s.startBar}-${s.endBar} (${s.lengthBars})`,
			`energy ${s.meanEnergy}, rank ${s.energyRank}${s.energyRank === 1 ? ' - the peak' : ''}`,
			s.repeatOf !== null ? `repeats section ${s.repeatOf}` : ''
		].filter(Boolean)
	}));

	if (!show) return { sections, cues: [], markers: [] };

	// Sort cues before deriving their ends; authored shows may store them out of order.
	const sorted = [...show.cues].sort((a, b) => a.bar - b.bar);
	const cues: TimelineCue[] = sorted.map((cue, i) => {
		const next = sorted[i + 1];
		const intensity = cue.intensity ?? show.defaults.intensity;
		const layers = LAYER_ROLES.filter((r: LayerRole) => cue.layers[r]).map(
			(r: LayerRole) => `${r}: ${cue.layers[r]!.effect}`
		);
		return {
			bar: cue.bar,
			start: barTimeAt(analysis.tempo, cue.bar),
			end: next ? barTimeAt(analysis.tempo, next.bar) : duration,
			section: cue.section,
			intensity,
			title: `bar ${cue.bar} - ${cue.section}`,
			lines: [`intensity ${intensity.toFixed(2)}`, ...layers, cue.note].filter(Boolean)
		};
	});

	const markers: TimelineMarker[] = show.hits
		.map((h) => {
			// Use the local bar's beat duration so markers match the player across tempo changes.
			const local = beatPeriodAt(analysis.tempo, h.bar);
			const start = barTimeAt(analysis.tempo, h.bar) + (h.beat ?? 0) * local;
			return {
				kind: h.kind,
				start,
				end: start + h.beats * local,
				title: h.kind,
				lines: [
					`bar ${h.bar}${h.beat ? ` beat ${h.beat}` : ''}, ${h.beats} beat${h.beats === 1 ? '' : 's'}`,
					h.params?.perBeat ? `${h.params.perBeat} per beat` : '',
					h.note ?? ''
				].filter(Boolean)
			};
		})
		.sort((a, b) => a.start - b.start);

	return { sections, cues, markers };
}

/** Search unsorted cues for the latest start at or before this bar. */
export function activeCue(show: Show | null, bar: number): Show['cues'][number] | undefined {
	if (!show) return undefined;
	let best: Show['cues'][number] | undefined;
	for (const cue of show.cues) {
		if (cue.bar <= bar && (!best || cue.bar > best.bar)) best = cue;
	}
	return best;
}

/** Visible track interval, as fractions of duration; shared by every timeline lane. */
export interface TimeWindow {
	start: number;
	end: number;
}

export const FULL_WINDOW: TimeWindow = { start: 0, end: 1 };

export function windowSpan(w: TimeWindow): number {
	return w.end - w.start;
}

export function isFullWindow(w: TimeWindow): boolean {
	return w.start <= 0 && w.end >= 1;
}

/** Where a fraction of the track falls inside the window. Outside 0..1 when it is off-screen. */
export function fractionIn(w: TimeWindow, fraction: number): number {
	const span = windowSpan(w);
	return span > 0 ? (fraction - w.start) / span : 0;
}

/** The inverse: which fraction of the track a position across the window points at. */
export function fractionAt(w: TimeWindow, across: number): number {
	return w.start + across * windowSpan(w);
}

/** Slide a span of the given width so it sits inside the track, keeping its width. */
function place(start: number, span: number): TimeWindow {
	const width = Math.min(1, span);
	const from = Math.max(0, Math.min(1 - width, start));
	return { start: from, end: from + width };
}

/** Keep the anchor fixed while zooming; the caller sets a musically useful minimum span. */
export function zoomAt(w: TimeWindow, at: number, factor: number, minSpan: number): TimeWindow {
	const span = windowSpan(w);
	const floor = Math.max(1e-4, Math.min(1, minSpan));
	const next = Math.max(floor, Math.min(1, span * factor));

	const relative = span > 0 ? (at - w.start) / span : 0.5;
	return place(at - relative * next, next);
}

export function panBy(w: TimeWindow, delta: number): TimeWindow {
	return place(w.start + delta, windowSpan(w));
}

/** Move the window to hold a point, doing nothing while it already does. */
export function follow(w: TimeWindow, at: number, margin = 0.12): TimeWindow {
	if (isFullWindow(w)) return w;
	const span = windowSpan(w);
	const inset = span * margin;
	if (at >= w.start + inset && at <= w.end - inset) return w;
	return place(at - span / 2, span);
}

/** Bucket onsets per visible pixel, using the window's time range rather than the whole track. */
export function densityColumns(
	times: readonly number[],
	duration: number,
	columns: number,
	window: TimeWindow = FULL_WINDOW
): Uint16Array {
	const out = new Uint16Array(Math.max(1, columns));
	if (duration <= 0) return out;
	const from = window.start * duration;
	const span = windowSpan(window) * duration;
	if (span <= 0) return out;
	for (const t of times) {
		const x = Math.floor(((t - from) / span) * columns);
		if (x >= 0 && x < out.length) out[x]++;
	}
	return out;
}
