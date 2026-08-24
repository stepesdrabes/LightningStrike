/**
 * Half-bar grid edits, listener-supplied.
 *
 * Safir proved the class: the record inserts two beats twice, the owner's marks sit on
 * two different phases of the same uniform grid, and meterConfidence 0.52 was the
 * pipeline noticing without being able to say what it saw. The grid absorbs each edit
 * as one SHORT bar ending at the cut, so every mark lands on a bar line and pre-arrival
 * gestures keep their true length - never a long bar, which stretches whatever gesture
 * lands in it (the staged strobe led its slam by six real beats).
 *
 * The cuts come from the listener - a hand-drawn section map's off-grid boundaries, or
 * moments heard directly. An automatic plateau detector over per-bar onset phases was
 * built, measured against the one track with verified edits, and killed the same
 * evening: a backbeat is symmetric under a half-bar shift, so the broadband vote
 * carries no signal (the phase-0 truth region of Safir voted 0/0/5/2), and the
 * detector's one real act was hallucinating an edit on a praised sentinel. The
 * postmortem lives in the round record; an automatic form may return only with an
 * asymmetric voter, behind the same instruments that killed this one.
 */

/**
 * Bar starts for a grid honouring listener-supplied cuts: each cut is a beat index that
 * must become a bar line, and the walk absorbs the offset as one short bar ENDING at
 * the cut. Any offset 1..beatsPerBar-1 is absorbed, because a hand-drawn map is allowed
 * to know things a detector does not; a cut already on the walking grid changes nothing.
 */
export function barStartsAtCuts(
	beatCount: number,
	beatsPerBar: number,
	phase: number,
	cutBeats: readonly number[]
): number[] {
	const cuts = [...cutBeats].sort((a, b) => a - b);
	const starts: number[] = [phase];
	let beat = phase;
	let next = 0;
	while (true) {
		while (next < cuts.length && cuts[next] <= beat) next++;
		const toCut = next < cuts.length ? cuts[next] - beat : Infinity;
		const span = toCut >= 1 && toCut < beatsPerBar ? toCut : beatsPerBar;
		if (beat + span > beatCount) break;
		beat += span;
		starts.push(beat);
	}
	return starts;
}

/**
 * Grid cuts implied by a hand-drawn section map: every boundary whose beat residue
 * against the uniform grid differs from the previous boundary's marks a place where the
 * record inserted beats, and the cut sits at that boundary. A map drawn over a correct
 * uniform grid carries residue 0 everywhere and implies nothing; Safir's map carries
 * 0, 2, 2, 0 and implies exactly the two cuts the owner confirmed by ear.
 *
 * A residue change counts only when the NEXT boundary carries it too. An inserted half bar
 * shifts everything after it, so real evidence always comes in twos; a lone change is a
 * drag, because the editor snaps to BEATS and a nudge onto a mid-bar beat is expressible
 * without meaning anything about meter. Blinding Lights' outro is one such nudge - one
 * boundary of eleven, 35 ms off a mid-bar beat - and it was cutting that track's grid.
 * The cost of the rule is an edit evidenced only by a map's final boundary, which no
 * following boundary can corroborate; that one has to come in as `gridCuts` directly.
 *
 * The residue walk only means anything on a UNIFORM drawing surface - see `handMapGrid`,
 * which is what callers with a map should use.
 */
export function deriveGridCuts(
	boundaryTimes: readonly number[],
	beatTimes: Float64Array,
	beatsPerBar: number,
	phase: number
): number[] {
	const beatAt = (t: number): number => {
		let best = 0;
		for (let i = 1; i < beatTimes.length; i++) {
			if (Math.abs(beatTimes[i] - t) < Math.abs(beatTimes[best] - t)) best = i;
		}
		return best;
	};
	const kept: { beat: number; residue: number }[] = [];
	for (const t of boundaryTimes) {
		const beat = beatAt(t);
		// A boundary that does not actually sit on a beat is a drag artefact, not evidence.
		if (Math.abs(beatTimes[beat] - t) > 0.35) continue;
		kept.push({ beat, residue: (((beat - phase) % beatsPerBar) + beatsPerBar) % beatsPerBar });
	}
	const cuts: number[] = [];
	let prev = 0;
	for (let i = 0; i < kept.length; i++) {
		if (kept[i].residue === prev) continue;
		if (kept[i + 1]?.residue !== kept[i].residue) continue;
		cuts.push(beatTimes[kept[i].beat]);
		prev = kept[i].residue;
	}
	return cuts;
}

/** The grid a hand map was drawn on, enough of it to read the cuts back out. */
export interface DrawingGrid {
	readonly beats: readonly number[];
	readonly barTimes: readonly number[];
	readonly beatsPerBar: number;
}

/** How close two grid times must be to count as the same instant. Both come from the
 * same beat table through one JSON round-trip, so this is float noise, not tolerance. */
const SAME_INSTANT = 1e-6;

/**
 * The cuts a bar table already carries. A cut bar is the one that absorbed an edit, so it
 * spans FEWER beats than the meter, and the cut is where that bar ends - the inverse of
 * `barStartsAtCuts`. Bar durations cannot answer this: a track that drifts from 146 to 190
 * bpm has bars half a second apart in length while every one of them still holds four
 * beats, and Safir's tail drifts exactly that far. Counting beats is exact.
 */
export function cutsFromBarTimes(grid: DrawingGrid): number[] {
	const cuts: number[] = [];
	let beat = 0;
	for (let bar = 0; bar + 1 < grid.barTimes.length; bar++) {
		const end = grid.barTimes[bar + 1];
		while (beat < grid.beats.length && grid.beats[beat] < grid.barTimes[bar] - SAME_INSTANT) beat++;
		let span = 0;
		while (beat + span < grid.beats.length && grid.beats[beat + span] < end - SAME_INSTANT) span++;
		if (span > 0 && span < grid.beatsPerBar) cuts.push(end);
	}
	return cuts;
}

/**
 * A cut list completed with the point where the bar count is due back.
 *
 * A cut re-counts bars from the mark, so every bar line after it moves - and a map whose later
 * boundaries were drawn ON bar lines then has all of them fall off the grid and get rounded
 * elsewhere. Measured on the owner's Melanz map, one fine drag moved ten of its sixteen
 * boundaries, by up to 2.24 s. The map itself says where the count is due back: the next
 * boundary that already sits on a bar line of the grid WITHOUT that mark. The walk absorbs the
 * offset as one short bar ending there, which is the shape a cut already uses and which leaves
 * the odd bar at a section's END, where a pre-arrival gesture keeps its length.
 *
 * A boundary sitting between bar lines is passed over rather than snapped to, because an
 * unflagged off-bar boundary is a beat-snapping artefact and says nothing about the meter -
 * the rule that protects Safir's confirmed grid. A cut with no such boundary after it runs to
 * the end of the track, which is the honest answer when the map offers nothing to return to.
 *
 * Everything here is beat indices, and the reference grid is WALKED rather than read off a
 * cached table, so this answers the same way for a track being analysed for the first time as
 * for one being previewed. An earlier version measured against the blob the map was drawn on,
 * which silently did nothing whenever that blob was missing.
 */
export function resyncedCuts(
	cutBeats: readonly number[],
	deliberateBeats: readonly number[],
	boundaryBeats: readonly number[],
	beatCount: number,
	beatsPerBar: number,
	phase: number
): number[] {
	const sorted = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b);
	if (deliberateBeats.length === 0) return sorted(cutBeats);

	const deliberate = new Set(deliberateBeats);
	const reference = new Set(
		barStartsAtCuts(beatCount, beatsPerBar, phase, cutBeats.filter((b) => !deliberate.has(b)))
	);
	const ordered = sorted(boundaryBeats);
	const out = new Set(cutBeats);
	for (const cut of deliberateBeats) {
		const back = ordered.find((b) => b > cut && reference.has(b));
		if (back !== undefined) out.add(back);
	}
	return sorted(out);
}

/**
 * What a hand-drawn map says about the GRID, given the analysis it was drawn on.
 *
 * On a uniform drawing surface the map's own residues are the evidence, and the cuts come
 * from `deriveGridCuts`. On a surface that is ALREADY piecewise they are not: the map's
 * boundaries carry positions from a grid whose bar lines have moved, so measuring them
 * against a uniform walk invents cuts. Safir's map, drawn on its confirmed two-cut grid,
 * derives 54.20 / 67.40 / 106.80 that way where the grid it was drawn on needs 53.80 and
 * 106.80 - the next version bump would have re-cut a grid the room had already confirmed.
 *
 * So a piecewise surface is carried forward as-is. Nor is the map allowed to add cuts to
 * one: its boundaries are dragged onto a BEAT grid, which makes a one-beat nudge (Safir's
 * verse sits a beat past its bar line) indistinguishable from a metrical edit. A new cut
 * on an already-cut track has to come from the listener directly, as `gridCuts`.
 */
export function handMapGrid(
	boundaryTimes: readonly number[],
	drawnOn: DrawingGrid | null,
	/**
	 * Boundaries the listener placed between bar lines ON PURPOSE, seconds. The bar line moves
	 * to each of them, because a section is addressed by whole bars and the alternative is to
	 * round the mark - which is what the room reported as the arrangement "snapping to
	 * something different" from the map. Deliberate is the operative word: the flag comes from
	 * the editor's fine drag, so maps drawn before the editor snapped to bars, whose off-bar
	 * boundaries are beat-snapping artefacts rather than statements, still imply nothing.
	 *
	 * Where the count is handed BACK afterwards is `resyncedCuts`, applied at the walk.
	 */
	placedOffGrid: readonly number[] = []
): { gridCuts?: number[]; sectionMapBoundaries?: number[] } {
	const carried = drawnOn ? cutsFromBarTimes(drawnOn) : [];
	const deliberate = placedOffGrid.filter(
		(t) =>
			Number.isFinite(t) &&
			(!drawnOn || !drawnOn.barTimes.some((b) => Math.abs(b - t) <= SAME_INSTANT))
	);
	const cuts = [...new Set([...carried, ...deliberate])].sort((a, b) => a - b);
	if (cuts.length > 0) return { gridCuts: cuts };
	return { sectionMapBoundaries: [...boundaryTimes] };
}
