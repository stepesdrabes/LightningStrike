/**
 * Listener cuts absorb inserted beats as short bars ending at each cut, preserving gesture
 * durations. Broadband onsets cannot prove half-bar edits: backbeats are symmetric under them.
 */

/** Cut beat indices become bar lines via short bars ending at each cut. On-grid cuts do nothing. */
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
 * Derive cuts from changes in boundary beat residues on a uniform drawing grid. Require the
 * next boundary to corroborate a change; a lone off-bar drag says nothing about meter.
 * A final-boundary edit needs explicit gridCuts. Use handMapGrid for existing piecewise grids.
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

/** Invert barStartsAtCuts by counting beats in short bars; elapsed bar duration also varies with tempo. */
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
 * Complete cuts with the next boundary on the uncut reference grid, restoring its phase with
 * a short bar ending there. Skip unflagged off-bar boundaries; no later match means no return.
 * All coordinates are beat indices and the reference is walked, independent of cached analysis.
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
 * Derive residues only on uniform drawing grids. Carry an existing piecewise grid forward:
 * its shifted coordinates would invent cuts against a uniform walk. New edits there require
 * explicit listener cuts, since beat-snapped nudges cannot establish meter.
 */
export function handMapGrid(
	boundaryTimes: readonly number[],
	drawnOn: DrawingGrid | null,
	/**
	 * Deliberate fine-drag boundaries, seconds. They move bar lines; unflagged legacy beat-snapped
	 * boundaries do not. resyncedCuts restores the original phase afterward when supported.
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
