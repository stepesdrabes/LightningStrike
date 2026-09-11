import { BARS_PER_PHRASE, PHRASE_BARS, type GenreFamily, type LyricLine } from '@mv/core';
import type { Segment } from './arrange.ts';
import { mean } from './dsp/stats.ts';
import { IMPACT_KICKS, IMPACT_KICK_JUMP } from './structure.ts';

/**
 * Per-bar repeated-hook starts reveal boundaries when vocal coverage is continuous. Back-quarter
 * starts belong to the next bar to allow singer anticipation and lyric-sync jitter.
 */
export function hookBars(
	lyrics: readonly LyricLine[],
	duration: number,
	barTime: Float64Array,
	barCount: number
): Uint8Array {
	const hooks = new Uint8Array(barCount);
	for (const span of chorusSpansFromLyrics(lyrics, duration)) {
		let b = 0;
		while (b < barCount - 1 && barTime[b + 1] <= span.start) b++;
		const len = barTime[b + 1] - barTime[b];
		if (len > 0 && (span.start - barTime[b]) / len > 0.75 && b + 1 < barCount) b++;
		hooks[b] = 1;
	}
	return hooks;
}

/** Minimum hook count/agreement for phase voting; two hooks can agree by chance. */
const SUNG_MIN_HOOKS = 3;
const SUNG_AGREEMENT = 0.8;
/** Require most interior boundaries to share the early offset before treating it as a song-wide habit. */
const SUNG_MAJORITY = 0.6;

/**
 * Shift song boundaries onto a strongly agreed sung phrase phase when most sit one bar early.
 * Keep kit arrivals/departures and protected boundaries; club hooks can lag their drop and
 * must not apply this global shift.
 */
export function sungPhaseShift(
	bounds: number[],
	hooks: Uint8Array,
	kicksPerBar: Int32Array,
	barCount: number,
	fixed: ReadonlySet<number>
): number[] {
	const sung: number[] = [];
	for (let b = 1; b < barCount; b++) if (hooks[b] === 1) sung.push(b);
	if (sung.length < SUNG_MIN_HOOKS) return [];
	const votes = new Int32Array(PHRASE_BARS);
	for (const b of sung) votes[b % PHRASE_BARS]++;
	let phase = 0;
	for (let k = 1; k < PHRASE_BARS; k++) if (votes[k] > votes[phase]) phase = k;
	if (votes[phase] < SUNG_AGREEMENT * sung.length) return [];
	const before = (phase - 1 + PHRASE_BARS) % PHRASE_BARS;
	const interior = bounds.filter((b) => b > 0 && b < barCount);
	if (interior.length === 0) return [];
	const early = interior.filter((b) => b % PHRASE_BARS === before);
	if (early.length < SUNG_MAJORITY * interior.length) return [];

	const moved: number[] = [];
	for (let i = 1; i + 1 < bounds.length; i++) {
		const b = bounds[i];
		if (b % PHRASE_BARS !== before || fixed.has(b)) continue;
		const now = kicksPerBar[b] ?? 0;
		const prev = kicksPerBar[b - 1] ?? 0;
		// Require kit landing rather than one pickup kick before the sung phrase.
		const kitLands = (prev <= 1 && now >= IMPACT_KICKS) || now >= prev + IMPACT_KICK_JUMP;
		const kitLeaves = now === 0 && prev > 0;
		if (kitLands || kitLeaves) continue;
		const to = b + 1;
		if (to >= barCount || bounds.includes(to) || bounds[i + 1] - to < 2) continue;
		bounds[i] = to;
		moved.push(to);
	}
	return moved;
}

/**
 * Genre selects lighting vocabulary: club families retain impact-led drops; other families
 * use chorus/verse labels.
 */
const CLUB_FAMILIES: ReadonlySet<GenreFamily> = new Set([
	'techno',
	'house',
	'edm',
	'trance',
	'bass',
	'ambient'
] as GenreFamily[]);

/**
 * Minimum loud-bar kick rate corroborating club vocabulary, below four-on-floor rate so
 * halftime bass qualifies while beatless ballads do not.
 */
const CLUB_KICK_FLOOR = 0.4;

/** Whether the genre family is one whose records are built around the drop. */
export function isClubFamily(family: GenreFamily | null): boolean {
	return family !== null && CLUB_FAMILIES.has(family);
}

/** Families that imply drums. Ambient is exempt because its absence of kick is expected. */
export const KICK_CLAIMING_FAMILIES: readonly GenreFamily[] = [
	'techno',
	'house',
	'edm',
	'trance',
	'bass'
] as GenreFamily[];

/**
 * Check a genre's drum claim against measured loud-bar kicks. Confident but incorrect club
 * labels can otherwise outvote a ballad label regardless of vote weighting.
 */
export function familyCorroborated(family: GenreFamily | null, loudKicksPerBeat: number): boolean {
	if (family === null || !KICK_CLAIMING_FAMILIES.includes(family)) return true;
	return loudKicksPerBeat >= CLUB_KICK_FLOOR;
}

export function speaksClub(
	family: GenreFamily | null,
	loudKicksPerBeat: number
): boolean {
	// A club family speaks club only where the record corroborates it - see the floor.
	if (family) return isClubFamily(family) && loudKicksPerBeat >= CLUB_KICK_FLOOR;
	// No metadata: a relentless four-on-the-floor kick is the one audio signature that
	// separates the two vocabularies without a genre tag. Defaulting the unknown to song
	// errs toward blooms over strobes, which is the survivable direction.
	return loudKicksPerBeat >= 0.8;
}

/** Re-read club labels as song labels, in place. The grid and grouping are untouched. */
export function toSongVocabulary(segments: Segment[]): void {
	for (const s of segments) {
		if (s.kind === 'drop') s.kind = 'chorus';
		else if (s.kind === 'groove') s.kind = 'verse';
	}
}

interface TimeSpan {
	start: number;
	end: number;
}

/** One line's identity for repeat detection: case, accents and punctuation are delivery. */
function foldLine(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/** Repeated runs of at least two lyric lines identify coarse chorus spans, not exact boundaries. */
export function chorusSpansFromLyrics(lyrics: readonly LyricLine[], duration: number): TimeSpan[] {
	if (lyrics.length < 8) return [];

	const counts = new Map<string, number>();
	const keys = lyrics.map((l) => foldLine(l.text));
	for (const k of keys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);

	const spans: TimeSpan[] = [];
	let runStart = -1;
	let runLines = 0;
	for (let i = 0; i <= lyrics.length; i++) {
		const repeated = i < lyrics.length && !!keys[i] && (counts.get(keys[i]) ?? 0) >= 2;
		if (repeated) {
			if (runStart < 0) runStart = i;
			runLines++;
			continue;
		}
		if (runStart >= 0 && runLines >= 2) {
			const start = lyrics[runStart].t;
			const last = lyrics[i - 1];
			const next = lyrics[i];
			// A line lasts until the next one starts, but never longer than a phrase: sync
			// gaps span instrumental breaks, and a chorus must not annex the solo after it.
			const end = Math.min(duration, next ? next.t : last.t + 4, last.t + 6);
			spans.push({ start, end });
		}
		runStart = -1;
		runLines = 0;
	}

	// Merge blocks the lyric formatting split: an instrumental turnaround inside a chorus
	// is still the chorus.
	const merged: TimeSpan[] = [];
	for (const s of spans.sort((a, b) => a.start - b.start)) {
		const prev = merged[merged.length - 1];
		if (prev && s.start - prev.end < 3) prev.end = Math.max(prev.end, s.end);
		else merged.push({ ...s });
	}
	return merged;
}

/** Share of [from, to) covered by the spans, 0..1. */
export function spanOverlap(spans: readonly TimeSpan[], from: number, to: number): number {
	if (to <= from) return 0;
	let covered = 0;
	for (const s of spans) {
		covered += Math.max(0, Math.min(to, s.end) - Math.max(from, s.start));
	}
	return Math.min(1, covered / (to - from));
}

/**
 * Promote sufficiently loud verses covered by repeated lyrics; absent matches alone cannot
 * undo energy evidence, and quiet repeated tags must not become choruses.
 */
export function promoteChorusesFromLyrics(
	segments: Segment[],
	segEnergy: readonly number[],
	barTime: (bar: number) => number,
	spans: readonly TimeSpan[]
): void {
	if (spans.length === 0) return;
	const loudest = Math.max(...segEnergy, 0.001);
	const loud = (i: number) => segEnergy[i] >= loudest * 0.8;
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (s.kind !== 'verse') continue;
		const overlap = spanOverlap(spans, barTime(s.startBar), barTime(s.endBar));
		if (overlap >= 0.55 && loud(i)) s.kind = 'chorus';
	}
	// Propagate chorus identity only when sung choruses are the majority of the material's loud
	// instances. A shared rap loop is backing material, not proof that every verse is a chorus.
	const groups = new Map<number, { chorus: number; loud: number }>();
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (s.group < 0 || !loud(i) || (s.kind !== 'chorus' && s.kind !== 'verse')) continue;
		const cell = groups.get(s.group) ?? { chorus: 0, loud: 0 };
		cell.loud++;
		if (s.kind === 'chorus') cell.chorus++;
		groups.set(s.group, cell);
	}
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (s.kind !== 'verse' || s.group < 0 || !loud(i)) continue;
		const cell = groups.get(s.group);
		if (cell && cell.chorus > 0 && cell.chorus * 2 >= cell.loud) s.kind = 'chorus';
	}
}

/**
 * Demote lyric-free choruses only when repeated lines strongly establish a chorus elsewhere;
 * sparse sync alone is insufficient.
 */
export function demoteVersesFromLyrics(
	segments: Segment[],
	barTime: (bar: number) => number,
	spans: readonly TimeSpan[]
): void {
	if (spans.length < 2) return;
	const overlaps = segments.map((s) =>
		s.kind === 'chorus' ? spanOverlap(spans, barTime(s.startBar), barTime(s.endBar)) : 0
	);
	const anchored = overlaps.some((o) => o >= 0.5);
	if (!anchored) return;
	// Preserve chorus-group reprises even when instrumental or worded differently in the sync file.
	const kept = new Set<number>();
	for (let i = 0; i < segments.length; i++) {
		if (segments[i].kind === 'chorus' && overlaps[i] >= 0.12) kept.add(segments[i].group);
	}
	for (let i = 0; i < segments.length; i++) {
		if (segments[i].kind !== 'chorus' || overlaps[i] >= 0.12) continue;
		if (segments[i].group >= 0 && kept.has(segments[i].group)) continue;
		segments[i].kind = 'verse';
	}
}

interface HookStart {
	/** When the block's first line starts being sung, seconds. */
	t: number;
	/** A restart is mid-flow; an entrance after unrepeated lines can lag a club drop. */
	restart: boolean;
}

/**
 * Repeated-block starts, seconds, including restarts inside a continuous repeated-line run.
 * Relative line timing exposes a new chorus that merged lyric spans would hide.
 */
export function hookStarts(lyrics: readonly LyricLine[]): HookStart[] {
	if (lyrics.length < 8) return [];
	const keys = lyrics.map((l) => foldLine(l.text));
	const counts = new Map<string, number>();
	for (const k of keys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);

	const out: HookStart[] = [];
	let runStart = -1;
	const flush = (end: number) => {
		const from = runStart;
		runStart = -1;
		if (from < 0 || end - from < 2) return;
		out.push({ t: lyrics[from].t, restart: false });
		let cycleStart = from;
		const firstAt = new Map<string, number>();
		for (let j = from; j < end; j++) {
			const seen = firstAt.get(keys[j]);
			if (seen !== undefined && seen >= cycleStart) {
				const restart = j - (seen - cycleStart);
				// A one-line cycle is a line chanted twice, not a block starting over. The
				// key still advances, or a long chant reads its third line as a restart.
				if (restart > cycleStart && restart - cycleStart >= 2) {
					out.push({ t: lyrics[restart].t, restart: true });
					cycleStart = restart;
					firstAt.clear();
					for (let k = restart; k <= j; k++) firstAt.set(keys[k], k);
					continue;
				}
			}
			firstAt.set(keys[j], j);
		}
	};
	for (let i = 0; i <= lyrics.length; i++) {
		const repeated = i < lyrics.length && !!keys[i] && (counts.get(keys[i]) ?? 0) >= 2;
		if (repeated) {
			if (runStart < 0) runStart = i;
			continue;
		}
		flush(i);
	}
	return out;
}

interface HookSnapMove {
	from: number;
	to: number;
}

/** Minimum section length and edge distance for hook splits; leave short sections to the DP/refiner. */
const SPLIT_MIN_BARS = 12;
const SPLIT_EDGE_BARS = 4;

/**
 * Split long song sections on phrase-spaced sung blocks that unchanged material cannot
 * separate. Use nearest bar lines because singers can lead downbeats; return inserted bars.
 */
export function splitAtHooks(
	segments: Segment[],
	starts: readonly HookStart[],
	barTime: Float64Array,
	barCount: number
): number[] {
	const out: number[] = [];
	const barOf = (t: number) => {
		let b = 0;
		while (b < barCount - 1 && barTime[b + 1] <= t) b++;
		const len = barTime[b + 1] - barTime[b];
		return len > 0 && (t - barTime[b]) / len > 0.5 && b + 1 < barCount ? b + 1 : b;
	};
	const hookBars = [...new Set(starts.map((h) => barOf(h.t)))].sort((a, b) => a - b);
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (s.kind !== 'chorus' && s.kind !== 'verse') continue;
		if (s.endBar - s.startBar < SPLIT_MIN_BARS) continue;
		const b = hookBars.find(
			(h) => h - s.startBar >= SPLIT_EDGE_BARS && s.endBar - h >= SPLIT_EDGE_BARS && (h - s.startBar) % BARS_PER_PHRASE === 0
		);
		if (b === undefined) continue;
		segments.splice(i + 1, 0, { startBar: b, endBar: s.endBar, kind: 'chorus', group: s.group });
		s.endBar = b;
		out.push(b);
	}
	return out;
}

/** Within-phrase repeated hooks are refrains, not section starts. */
const HOOK_MIN_GAP_BARS = 4;
/** How far a boundary may be pulled BACK onto a hook window. The judged failure class. */
const SNAP_REACH_EARLIER = 2;
/** Decisive incumbents need a comparably strong target edge; max(1, ...) bounds near-zero ratios. */
const SNAP_KEEP_DECISIVE = 2;
const SNAP_DOMINANCE = 1.45;
/**
 * Restart hooks bypass the arrival-ratio veto, but still need physical evidence above the
 * noise floor when the incumbent is decisive; a voice-only restart is not a band arrival.
 */
const SNAP_RESTART_NOISE = 0.6;

/**
 * A sung hook claims its current and next bar. Preserve boundaries inside any hook window;
 * otherwise move to the nearest edge, at most two bars earlier or one later. Later moves
 * require a restart: vocal entrances can lag instrumental drops. Runs after vocabulary;
 * re-place events after moving boundaries.
 */
export function snapToHooks(
	segments: Segment[],
	starts: readonly HookStart[],
	barTime: Float64Array,
	barCount: number,
	minSegmentBars = 2,
	/** PHYSICS-ONLY arrival strengths - no voice term, which is the evidence on trial. */
	arrivals: Float32Array | null = null,
	/** Boundaries that are walls - movement starts - which no hook may move or absorb across. */
	fixed: ReadonlySet<number> = new Set(),
	/** How far a boundary may be pulled back onto a hook window; 0 switches the snap off. */
	reachEarlier = SNAP_REACH_EARLIER,
	/** A decisive incumbent is never displaced: restarts obey the dominance test, and no move later. */
	strict = false,
	/** Apply the shared off-phrase guard so sung pickups cannot bypass the refine's timing constraint. */
	mayMove?: (prevStart: number, from: number, to: number) => boolean
): HookSnapMove[] {
	const moves: HookSnapMove[] = [];
	if (starts.length === 0 || barCount < 2 || reachEarlier <= 0) return moves;

	const windows: { bar: number; restart: boolean }[] = [];
	let lastBar = -Infinity;
	for (const h of [...starts].sort((a, b) => a.t - b.t)) {
		let b = 0;
		while (b < barCount - 1 && barTime[b + 1] <= h.t) b++;
		if (b - lastBar < HOOK_MIN_GAP_BARS) continue;
		lastBar = b;
		windows.push({ bar: b, restart: h.restart });
	}

	const inWindow = (bar: number) => windows.some((w) => bar === w.bar || bar === w.bar + 1);

	for (let i = 1; i < segments.length; i++) {
		const s = segments[i];
		if (s.kind !== 'drop' && s.kind !== 'chorus') continue;
		const prev = segments[i - 1];
		if (prev.kind === 'void') continue;
		const from = s.startBar;
		if (fixed.has(from) || fixed.has(prev.startBar)) continue;
		if (inWindow(from)) continue;

		let to = -1;
		let dist = Infinity;
		let absorb = false;
		for (const w of windows) {
			// The nearest edge of this window, from outside it.
			const edge = from < w.bar ? w.bar : w.bar + 1;
			const d = Math.abs(edge - from);
			if (d >= dist) continue;
			if (edge < from && from - edge > reachEarlier) continue;
			if (edge > from && (edge - from > 1 || !w.restart)) continue;
			if (mayMove && !mayMove(prev.startBar, from, edge)) continue;
			// A decisive arrival cannot move later onto a lagging vocal entrance.
			if (strict && edge > from && arrivals && (arrivals[from] ?? 0) >= SNAP_KEEP_DECISIVE) continue;
			// Preserve a decisive incumbent unless an entrance edge has comparable physics. Restarts
			// need only the absolute noise floor: lyrics place a corroborated mid-flow restart, while
			// physics rejects voice-only edges.
			if (edge < from && arrivals) {
				const incumbent = arrivals[from] ?? 0;
				const target = arrivals[edge] ?? 0;
				// Strict: no window, entrance or restart, claims a bar the record never arrives
				// at (Von dutch's last drop was pulled onto a sung line at 0.25).
				if (strict && target < SNAP_RESTART_NOISE) continue;
				if (
					incumbent >= SNAP_KEEP_DECISIVE &&
					(w.restart && !strict ? target < SNAP_RESTART_NOISE : incumbent >= Math.max(1, target) * SNAP_DOMINANCE)
				) {
					continue;
				}
			}
			// A hook move may absorb a two-bar build leftward rather than leave an undersized predecessor;
			// the chorus then begins on its lyric-supported bar.
			const shrinks = edge - prev.startBar < minSegmentBars;
			const canAbsorb =
				shrinks &&
				prev.kind === 'build' &&
				prev.endBar - prev.startBar === minSegmentBars &&
				i >= 2 &&
				segments[i - 2].kind !== 'void';
			if (shrinks && !canAbsorb) continue;
			if (s.endBar - edge < minSegmentBars) continue;
			to = edge;
			dist = d;
			absorb = shrinks;
		}
		if (to < 0) continue;
		moves.push({ from, to });
		if (absorb) {
			segments[i - 2].endBar = to;
			segments.splice(i - 1, 1);
			s.startBar = to;
			i--;
		} else {
			s.startBar = to;
			prev.endBar = to;
		}
	}
	return moves;
}

/** Kicks per beat across the loud half of the track: what the floor is actually doing. */
export function loudKickRate(
	kicksPerBar: Int32Array,
	energy: Float32Array,
	beatsPerBar: number
): number {
	const count = Math.min(kicksPerBar.length, energy.length);
	if (count === 0) return 0;
	const sorted = Float32Array.from(energy.subarray(0, count)).sort();
	const median = sorted[sorted.length >> 1];
	const loud: number[] = [];
	for (let b = 0; b < count; b++) if (energy[b] >= median) loud.push(kicksPerBar[b]);
	if (loud.length === 0) return 0;
	return mean(Float32Array.from(loud)) / Math.max(1, beatsPerBar);
}
