import type { TempoGrid } from './contracts/analysis.ts';

/** Shared four-bar structural grid for section detection and cue linting. */
export const PHRASE_BARS = 4;

/**
 * Eight-bar musical phrase, distinct from the four-bar structural grid.
 * Resolve both phases so phraseStart lands on the opening half.
 */
export const BARS_PER_PHRASE = 8;

/**
 * Bar start in seconds, using measured barTimes to avoid accumulated tempo-fit drift.
 * Extrapolate outside the table with the nearest known period.
 */
export function barTimeAt(tempo: TempoGrid, bar: number): number {
	const times = tempo.barTimes;
	if (!times || times.length === 0) {
		return tempo.firstBeat + (tempo.downbeatPhase + bar * tempo.beatsPerBar) * tempo.beatPeriod;
	}

	const last = times.length - 1;
	if (bar <= 0) {
		// Extrapolate negative bars so pre-boundary fades retain their full duration.
		const span = last >= 1 ? times[1] - times[0] : tempo.beatPeriod * tempo.beatsPerBar;
		return times[0] + bar * span;
	}
	if (bar >= last) {
		const span = last >= 1 ? times[last] - times[last - 1] : tempo.beatPeriod * tempo.beatsPerBar;
		return times[last] + (bar - last) * span;
	}

	const i = Math.floor(bar);
	const frac = bar - i;
	return frac === 0 ? times[i] : times[i] + (times[i + 1] - times[i]) * frac;
}

/** How long the bar containing `bar` lasts, seconds. */
export function barDurationAt(tempo: TempoGrid, bar: number): number {
	const times = tempo.barTimes;
	const fallback = tempo.beatPeriod * tempo.beatsPerBar;
	if (!times || times.length < 2) return fallback;
	const i = Math.max(0, Math.min(times.length - 2, Math.floor(bar)));
	const span = times[i + 1] - times[i];
	return span > 1e-6 ? span : fallback;
}

/** Inverse of barTimeAt, including fractional bar phase so every consumer shares one clock. */
export function barAtTime(tempo: TempoGrid, t: number): number {
	const times = tempo.barTimes;
	if (!times || times.length === 0) {
		const beats = (t - tempo.firstBeat) / tempo.beatPeriod;
		return (beats - tempo.downbeatPhase) / tempo.beatsPerBar;
	}

	const last = times.length - 1;
	if (t <= times[0]) {
		const span = last >= 1 ? times[1] - times[0] : tempo.beatPeriod * tempo.beatsPerBar;
		return span > 1e-6 ? (t - times[0]) / span : 0;
	}
	if (t >= times[last]) {
		const span = last >= 1 ? times[last] - times[last - 1] : tempo.beatPeriod * tempo.beatsPerBar;
		return span > 1e-6 ? last + (t - times[last]) / span : last;
	}

	let lo = 0;
	let hi = last;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= t) lo = mid;
		else hi = mid;
	}
	const span = times[lo + 1] - times[lo];
	return span > 1e-6 ? lo + (t - times[lo]) / span : lo;
}

/** Nearest bar line, ties to the earlier bar. Preview and adopted hand maps must agree. */
export function nearestBar(tempo: TempoGrid, t: number): number {
	return tieToEarlier(barAtTime(tempo, t));
}

/** The same tie rule for analysis callers that only have a bar table. */
export function nearestBarIn(barTimes: ArrayLike<number>, t: number, barCount: number): number {
	const last = Math.max(0, Math.min(barCount, barTimes.length - 1));
	if (last < 1 || t <= barTimes[0]) return 0;
	if (t >= barTimes[last]) return last;
	let lo = 0;
	let hi = last;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (barTimes[mid] <= t) lo = mid;
		else hi = mid;
	}
	const span = barTimes[lo + 1] - barTimes[lo];
	return span > 1e-6 ? tieToEarlier(lo + (t - barTimes[lo]) / span) : lo;
}

function tieToEarlier(bars: number): number {
	const floor = Math.floor(bars);
	return bars - floor > 0.5 ? floor + 1 : floor;
}

/** Local beat period from the bar table; the track median cannot time tempo-changing passages. */
export function beatPeriodAt(tempo: TempoGrid, bar: number): number {
	return barDurationAt(tempo, bar) / Math.max(1, tempo.beatsPerBar);
}

export function bpmAt(tempo: TempoGrid, bar: number): number {
	const period = beatPeriodAt(tempo, bar);
	return period > 1e-6 ? 60 / period : tempo.bpm;
}

/** A stretch of the track whose bars are the same length, and what tempo that is. */
interface TempoSegment {
	startBar: number;
	endBar: number;
	bpm: number;
	/** Seconds, from the bar table. */
	start: number;
	end: number;
}

/** A 12% step separates ordinary tempo drift from beat switches. */
const TEMPO_STEP = 0.12;
/** Require a sustained change so a single edited bar is not a tempo segment. */
const TEMPO_SEGMENT_BARS = 4;

/** Group consecutive bars by sustained duration changes, using the measured bar table. */
export function tempoSegments(tempo: TempoGrid, minBars = TEMPO_SEGMENT_BARS): TempoSegment[] {
	const times = tempo.barTimes;
	if (!times || times.length < 2 + minBars) {
		return [
			{
				startBar: 0,
				endBar: Math.max(1, (times?.length ?? 1) - 1),
				bpm: tempo.bpm,
				start: times?.[0] ?? 0,
				end: times?.[times.length - 1] ?? 0
			}
		];
	}

	const perBar = Math.max(1, tempo.beatsPerBar);
	const durations: number[] = [];
	for (let b = 0; b + 1 < times.length; b++) durations.push(times[b + 1] - times[b]);

	const cuts: number[] = [0];
	let reference = durations[0];
	for (let b = 1; b < durations.length; b++) {
		if (Math.abs(durations[b] - reference) <= TEMPO_STEP * reference) {
			// Follow gradual drift so a ramp does not become a false step against the first
			// bar.
			reference = reference * 0.7 + durations[b] * 0.3;
			continue;
		}
		// Require the new length to hold through a passage.
		const holds = durations
			.slice(b, b + minBars)
			.every((d) => Math.abs(d - durations[b]) <= TEMPO_STEP * durations[b]);
		if (!holds || durations.length - b < minBars) continue;
		cuts.push(b);
		reference = durations[b];
	}
	cuts.push(durations.length);

	const out: TempoSegment[] = [];
	for (let i = 0; i + 1 < cuts.length; i++) {
		const [from, to] = [cuts[i], cuts[i + 1]];
		if (to - from < 1) continue;
		const span = times[to] - times[from];
		const bars = to - from;
		out.push({
			startBar: from,
			endBar: to,
			bpm: span > 1e-6 ? (60 * perBar * bars) / span : tempo.bpm,
			start: times[from],
			end: times[to]
		});
	}
	return out.length > 0 ? out : [{ startBar: 0, endBar: durations.length, bpm: tempo.bpm, start: times[0], end: times[times.length - 1] }];
}

/** Hit duration in seconds at its actual placement, shared by planner and linter. */
export function hitSeconds(
	tempo: TempoGrid,
	bar: number,
	beat: number,
	beats: number
): number {
	const perBar = Math.max(1, tempo.beatsPerBar);
	const from = bar + beat / perBar;
	return barTimeAt(tempo, from + beats / perBar) - barTimeAt(tempo, from);
}

/** How far past the last phrase boundary this bar sits, 0 when it is on one. */
export function phraseOffset(bar: number, anchorBar: number): number {
	return (((bar - anchorBar) % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
}

export function onPhraseGrid(bar: number, anchorBar: number): boolean {
	return phraseOffset(bar, anchorBar) === 0;
}

/** Nearest bar on the phrase grid, preferring the earlier one on a tie. */
export function nearestPhraseBar(bar: number, anchorBar: number): number {
	const down = bar - phraseOffset(bar, anchorBar);
	const up = down + PHRASE_BARS;
	return bar - down <= up - bar ? down : up;
}

