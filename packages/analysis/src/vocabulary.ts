import { BARS_PER_PHRASE, PHRASE_BARS, type GenreFamily, type LyricLine } from '@mv/core';
import type { Segment } from './arrange.ts';
import { mean } from './dsp/stats.ts';
import { IMPACT_KICKS, IMPACT_KICK_JUMP } from './structure.ts';

/**
 * Where a repeated-line block BEGINS, as a per-bar flag: on a wall-to-wall vocal track
 * the coverage column never moves, and the hook starting is the boundary the audience
 * hears. A hook landing in the back quarter of a bar is sung INTO the next bar: lyric
 * sync carries tens-of-milliseconds jitter and singers anticipate the downbeat.
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

/**
 * Fewest sung hooks that may vote for the phrase phase, and how many must agree: two hooks
 * agree by chance half the time, three choruses is the smallest song this is for.
 */
const SUNG_MIN_HOOKS = 3;
const SUNG_AGREEMENT = 0.8;
/**
 * Share of the interior boundaries that must sit a bar before the sung phase before the shift
 * is the song's habit rather than one boundary's: an instrumental change a bar ahead of the
 * singer is a production choice a record makes everywhere or nowhere.
 */
const SUNG_MAJORITY = 0.6;

/**
 * Move the boundaries a song places a bar before its sung phrases onto the phrases, in place.
 *
 * The DP reads material and the refine reads arrivals, and on a record whose instrumental
 * turns a bar ahead of the singer both put every section a bar early: Best Part's chords and
 * level move at bars 3, 11, 15, 27, 39 and 55 and the owner draws 4, 12, 16, 28, 40 and 56,
 * where each sung phrase begins. The hooks the lyrics prove (`hookBars`) carry the phrase
 * phase the owner hears; where three or more agree on one residue and most of the table sits
 * exactly a bar before it, the table moves. A boundary the kit lands on or leaves at keeps its
 * bar - the drums arriving or stopping is the record's own line, and the owner draws it there
 * (Best Part's build at 51, where the kit stops under the bridge) - and so does a movement
 * start or a boundary an arrival moved and pinned. Song vocabulary only: a club track's hook
 * lags the drop it belongs to, which is the snap's business.
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
		// The landing the anacrusis guard reads, not any kick after none: one kick on the bar
		// before the sung phrase is the drummer's pickup (Best Part's last chorus).
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
 * Which section vocabulary a track speaks.
 *
 * Club music has drops: passages defined by impact, set up and slammed into. Song music
 * has choruses: the same energy class arrived at by lift rather than by impact, and lit
 * as an anthem rather than an assault. The families whose records are built around the
 * drop keep the club vocabulary; everything else reads as songs.
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
 * The kick rate under which a club-family verdict is not believed. The drop vocabulary
 * is a claim about how the record moves, and a genre tag cannot outvote a floor that
 * never kicks: a piano ballad the audio model filed as house (0.0 kicks/beat) got six
 * "drop" sections, while every genuinely club track in the judged round measures 0.5+
 * even at half-time. Sits well under fourOnFloor's 0.8 so halftime bass keeps its drops.
 */
const CLUB_KICK_FLOOR = 0.4;

/** Whether the genre family is one whose records are built around the drop. */
export function isClubFamily(family: GenreFamily | null): boolean {
	return family !== null && CLUB_FAMILIES.has(family);
}

/**
 * The families whose name is a promise about the drums: a house record has a kick, and so
 * does a techno, edm, trance or bass one. Ambient is deliberately absent though it keeps
 * the club vocabulary - a record with no kick is exactly what ambient IS, so silence
 * corroborates it rather than refuting it.
 */
export const KICK_CLAIMING_FAMILIES: readonly GenreFamily[] = [
	'techno',
	'house',
	'edm',
	'trance',
	'bass'
] as GenreFamily[];

/**
 * Whether the record backs up its genre verdict's drum claim.
 *
 * The audio classifier is confident and sometimes wrong in the same breath: it heard a
 * Lewis Capaldi piano ballad as Tropical House 0.63 with House 0.48 behind it, and two
 * house labels outvote its own Pop Ballad 0.45 however the ballot is weighted, so no vote
 * arithmetic can overturn it. A measurement can. This is the same floor `speaksClub`
 * gates the drop vocabulary on, asked one level up: not "may this track speak club" but
 * "is this genre verdict true of this record at all".
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

export interface TimeSpan {
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

/**
 * Where the chorus is, according to the words.
 *
 * A chorus is the passage whose lines the track repeats: runs of two or more lines that
 * each occur again elsewhere. Line-level sync is enough - the value is the span, not the
 * word - and the estimate is deliberately coarse: it exists to settle which loud section
 * is THE chorus, not to place a boundary.
 */
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
 * Let the words promote a loud verse to the chorus it evidently is.
 *
 * Promotion only: the energy evidence that made a section a chorus is stronger than the
 * absence of a lyric match, which on a sparsely synced track means nothing. A verse is
 * promoted when the repeated lines sit squarely on it and it is loud enough to be the
 * chorus it claims - the second condition keeps a repeated post-chorus tag from dragging
 * a quiet section up.
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
	// And the same material at the same energy is the same chorus, whatever the sync file
	// made of its words: Someone You Loved's second chorus shares its group with the first and
	// the last, sits within a few points of them, and carried none of the repeated lines
	// because the file words it differently - the owner heard the chorus "there more times".
	// Only where the sung statements are the MAJORITY of the material's loud statements: on a
	// rap record the verses and the hook ride one loop and share one group (HUMBLE.'s eight
	// loud sections, two of them the hook), and there the material is the song's bed, not its
	// chorus.
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
 * The other direction: a "chorus" whose bars carry none of the repeated lines, on a track
 * where the repeated lines clearly live somewhere else, is a loud verse - rock verses are
 * walls of guitar and the energy model cannot tell them from the hook. Demotion needs both
 * halves: near-zero overlap here AND a strongly overlapping chorus elsewhere, so a track
 * with instrumental chorus reprises or sparse sync data is left alone.
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
	// A group with a chorus member that KEEPS its label is chorus MATERIAL: an instrumental
	// reprise of the hook carries no lines and must not be demoted away from its own siblings,
	// and neither may a second chorus whose lines the sync file words differently (Someone You
	// Loved's second chorus, the same material as the first and last at the same energy, came
	// out a verse while they stayed choruses, and the owner heard the chorus "there more times").
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

export interface HookStart {
	/** When the block's first line starts being sung, seconds. */
	t: number;
	/**
	 * True for a restart inside a continuing run. The distinction carries trust: a run
	 * START after unrepeated lines is a vocal ENTRANCE, which in club music routinely
	 * lags the instrumental drop it belongs to, while a restart happens mid-flow and
	 * cannot lag anything.
	 */
	restart: boolean;
}

/**
 * Where a repeated-line block starts being sung, seconds - the run starts that become the
 * chorus spans, PLUS the restarts hiding inside a run. When the opening chorus flows
 * straight into the first real one, every line from the first bar to the second verse is
 * "repeated" and the merged span buries the boundary the audience hears; but the block's
 * own lines coming round again betray it, sitting the same distance from the repeat as
 * the originals sat from the cycle's start.
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

export interface HookSnapMove {
	from: number;
	to: number;
}

/**
 * Fewest bars a section needs before a hook inside it may split it, and how far from either
 * end the hook has to sit: twelve is a phrase and a half, under which the DP already put its
 * boundary where it heard a change, and a phrase from each edge keeps the split from being
 * the refine's one-bar business.
 */
const SPLIT_MIN_BARS = 12;
const SPLIT_EDGE_BARS = 4;

/**
 * Split long song-vocabulary sections where a sung block begins a whole phrase into them, in
 * place; returns the bars the new sections begin on.
 *
 * The DP reads material and one loop played end to end has none to change: Thinkin Bout You
 * is one groove for three minutes, and the owner draws its sections where the verses and the
 * hook begin, eight bars apart. A repeated block beginning eight (or sixteen) bars into a
 * chorus or a verse is that boundary, whether the lyrics call it the start of a run or a
 * restart inside one - the pre-chorus and the hook are both repeated lines, and only the
 * eight-bar grid tells the hook from the refrain four bars before it. The block's bar is the
 * nearest bar line, not the sung-into rule the snap uses: a singer on a slow record leads the
 * downbeat by a beat or more ("Or do you not think so far ahead" a third of a bar early).
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

/**
 * Hooks that recur within a phrase are a refrain cycling inside its section, not section
 * starts, and a snap fed them drags real boundaries onto chant lines.
 */
const HOOK_MIN_GAP_BARS = 4;
/** How far a boundary may be pulled BACK onto a hook window. The judged failure class. */
const SNAP_REACH_EARLIER = 2;
/**
 * A boundary on a decisive arrival (the refine pass's pin class) is not pulled back
 * unless the window edge arrives within the refine margin of it; max(1, ...) keeps the
 * ratio meaningful over near-zero edges.
 */
const SNAP_KEEP_DECISIVE = 2;
const SNAP_DOMINANCE = 1.45;
/**
 * Below this, a window edge is a bar the record has not arrived at. A restart is exempt
 * from the ratio veto - it cannot lag or lead - but a "restart" onto silence while the
 * incumbent is decisive is a repeated line mid-flow, not a section the band knows about:
 * the singer runs unbroken through Kisses' last groove, and the snap dragged the pinned
 * drop two bars back onto the voice alone (edge 0.23). A true restart is corroborated -
 * Le Freak's edge arrives at 1.57 with the band and clears this floor untouched.
 */
const SNAP_RESTART_NOISE = 0.6;

/**
 * Align chorus-class startBars with the hook windows the sung lyrics prove, in place.
 *
 * A hook line starting at bar b + frac belongs to bar b or to the downbeat it is sung
 * into at b+1 - measured across the judged library, verified-correct boundaries sit on
 * either side of their hook with the in-bar phase unable to split them (a 0.27 pickup
 * lands on the next bar where a 0.31 lands on its own). So the hook claims a two-bar
 * WINDOW, a boundary already inside any window is evidence and stays, and only a
 * boundary outside every window moves, onto the nearest window edge:
 *
 * - up to two bars EARLIER: the diagnosed failure has an instrumental pickup slamming a
 *   bar or two before the sung chorus and taking the boundary with it;
 * - at most one bar LATER, and only toward a RESTART hook: a run start is a vocal
 *   entrance, which in club music routinely lags the instrumental drop it belongs to,
 *   and must not delay the biggest cue of the night onto its own lag. A restart happens
 *   mid-flow and cannot lag anything.
 *
 * The refiner's hook term still tips one-bar cases against weak incumbents; this pass
 * exists for the boundary that is beyond its reach or facing a strong wrong incumbent.
 * Runs after the vocabulary settles which segments are chorus-class; the caller
 * re-places events afterwards, or cues keep firing at the bars the boundaries left.
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
	/**
	 * Whether a move may leave the phrase grid, given the section before, the boundary and its
	 * target: the anacrusis guard the refine obeys, so the sung hook cannot do by the snap what
	 * the level step may not do by the refine (Killing In the Name's chorus, sung a bar early).
	 */
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
			// The later move exists for a vocal entrance lagging its drop; a boundary that already
			// sits on a decisive arrival is not lagging anything (Az na mesic's last chorus, 4.7).
			if (strict && edge > from && arrivals && (arrivals[from] ?? 0) >= SNAP_KEEP_DECISIVE) continue;
			// The physics veto on the pull-back: a singer leading the beat puts the hook
			// window on bars the record has not arrived at yet, and the snap was dragging
			// correct boundaries off the beat and onto them - EARFQUAKE's second drop by two
			// bars over near-silence, its first chorus by two over a sung entrance. A
			// decisive incumbent stays unless the edge arrives comparably; a wrongly-late
			// boundary sits on a bar nothing arrived at, so every legitimate rescue on
			// record (weak incumbent) still proceeds. This ratio form was tried, dropped
			// against a sentinel that scored its one disagreement as a regression, and
			// restored when the owner's round-2 note overturned that sentinel: the veto had
			// been right about the bar and the instrument wrong.
			// The ratio form is for entrances only: a vocal ENTRANCE can lead the beat (the
			// veto's whole case), but a RESTART happens mid-flow and cannot lag or lead
			// anything - held to the ratio, the veto slid a lyric-perfect restart chorus
			// two bars onto the band's arrival. A restart window still cannot claim a bar
			// the record never arrives at, though: physics cannot rank a corroborated
			// restart edge against a decisive incumbent (the lyric does that), but it can
			// tell a band-backed edge from the voice alone, and only the absolute noise
			// floor makes that call.
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
			// A move that would shrink the previous segment below the minimum is normally
			// refused - except when that segment is a two-bar BUILD, the connective tissue
			// the DP cuts off a riser. Then the move absorbs it leftward instead: its first
			// bar joins the passage it rose out of, and the chorus starts where the hook
			// says. The owner marked Safir's second chorus at 42 twice across two rounds
			// while a 2-bar build at 41-43 held this exact refusal in place.
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
