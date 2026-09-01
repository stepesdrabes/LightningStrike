/**
 * Where the bar count restarts, read from the model's own downbeat stream.
 *
 * One modal phase for a whole track is the assumption that nothing ever inserts or drops a
 * beat. Measured against Beat This's own downbeats, that assumption costs more than it looks:
 * the shipped uniform walk reproduces 39% of the model's downbeats on SICKO MODE, 40% on
 * Melanz, 52% on Safir and 32% on Cigo a kava - not because the model is confused about the
 * meter (85% of its downbeat gaps on SICKO MODE are exactly four beats) but because a single
 * four-beat walk cannot follow a reset, and every reset shifts everything after it.
 *
 * So the phase is chosen by dynamic programming: the state is each beat's position in the bar,
 * stepping on is free, and restarting the count costs a fixed price. That price is the whole
 * design. Too cheap and the walk chases every hesitation the model has; at the shipped cost 43
 * of 60 Harmonix tracks take NO reset at all, and every praised sentinel takes none - Le Freak,
 * EARFQUAKE, Pistacie, Vitej, Hannah Montana and Praha/Viden are all left exactly as they were.
 *
 * WHAT READS THIS, AND WHAT DOES NOT. `analyze.ts` uses it for one thing: placing a
 * listener-marked movement on the right beat, within a bar of the mark. It does NOT re-phase a
 * track nobody has marked, and the reason is measured rather than cautious. Run unrestricted
 * the walk lifts phase carry right across the low-confidence cohort, and `bench/phasegrid.ts`
 * scores that same run at five worse against seams the room has praised - including one on
 * Killing In the Name that moves 0.64 s. Carry is not a thing the room has ever heard, and a
 * boundary it praised is. The unrestricted form stays measurable behind that instrument for
 * whenever it is worth re-opening.
 *
 * That scoping is also what separates this from the killed plateau detector rather than mere
 * assertion - it decides nothing on its own. Where it does speak it is at least the asymmetric
 * voter that postmortem asked for: a broadband onset vote is symmetric under a half-bar flip
 * because a backbeat is, while a downbeat head trained on annotated downbeats is not. On SICKO
 * MODE its two restarts are the owner's own two movement marks, and the first agrees with the
 * kick/snare phase profile and with the mark to within 0.02 s.
 */

/** One stretch of the beat stream that counts its bars from one place. */
export interface PhaseSegment {
	/** Index into the beat stream of this segment's first bar line. */
	startBeat: number;
	/** Which beat index mod `beatsPerBar` carries a downbeat inside this segment. */
	phase: number;
}

/**
 * What restarting the count costs, in downbeats.
 *
 * Swept on 60 Harmonix, 19 judged and the two multi-song tracks: at 2 the walk takes four
 * resets on SICKO MODE where the room hears two, at 8 it gives up Melanz's; 4 is the middle
 * of a wide plateau and is the value the room has confirmed.
 */
const PHASE_RESET_COST = 4;

/**
 * What a bar line with no downbeat under it costs.
 *
 * Small on purpose: it only has to stop the walk inventing bar lines in a passage the model
 * said nothing about. Swept over 0, 0.15 and 0.35 the reset counts do not move.
 */
const EMPTY_BAR_LINE_COST = 0.15;

/** Fewest downbeats worth running the walk over; below this the modal phase is all there is. */
const MIN_DOWNBEATS = 8;

/**
 * The phase of every beat, and where it restarts.
 *
 * `downbeats` are the model's, and are exactly a subset of `beats` (verified across the whole
 * cached corpus: 26197 of 26197 match to the sample), so they are matched by index rather than
 * by time and nothing here carries a tolerance.
 */
export function phaseSegments(
	beats: readonly number[] | Float64Array,
	downbeats: readonly number[],
	beatsPerBar: number,
	resetCost = PHASE_RESET_COST
): PhaseSegment[] {
	const n = beats.length;
	const bpb = Math.max(1, Math.floor(beatsPerBar));
	if (n < bpb * 2 || downbeats.length < MIN_DOWNBEATS || bpb < 2) {
		return [{ startBeat: 0, phase: 0 }];
	}

	const isDownbeat = new Uint8Array(n);
	const at = new Map<number, number>();
	for (let i = 0; i < n; i++) at.set(Math.round(beats[i] * 1000), i);
	for (const t of downbeats) {
		const i = at.get(Math.round(t * 1000));
		if (i !== undefined) isDownbeat[i] = 1;
	}

	// Viterbi over position-in-bar. Stepping on is free; any other successor is a restart.
	const NEG = -Infinity;
	const score = new Float64Array(n * bpb).fill(NEG);
	const back = new Int32Array(n * bpb);
	const emit = (i: number, s: number): number =>
		s === 0 ? (isDownbeat[i] ? 1 : -EMPTY_BAR_LINE_COST) : 0;
	for (let s = 0; s < bpb; s++) score[s] = emit(0, s);
	for (let i = 1; i < n; i++) {
		const row = i * bpb;
		const prevRow = row - bpb;
		for (let s = 0; s < bpb; s++) {
			const stepped = (s - 1 + bpb) % bpb;
			let best = score[prevRow + stepped];
			let from = stepped;
			for (let q = 0; q < bpb; q++) {
				if (q === stepped) continue;
				const v = score[prevRow + q] - resetCost;
				if (v > best) {
					best = v;
					from = q;
				}
			}
			score[row + s] = best + emit(i, s);
			back[row + s] = from;
		}
	}

	let s = 0;
	for (let k = 1; k < bpb; k++) if (score[(n - 1) * bpb + k] > score[(n - 1) * bpb + s]) s = k;
	const states = new Int32Array(n);
	for (let i = n - 1; i >= 0; i--) {
		states[i] = s;
		s = back[i * bpb + s];
	}

	// A segment starts at its own first bar line, which is what `barStartsAtCuts` needs: the
	// walk between two restarts is uniform by construction, so one anchor describes it.
	const out: PhaseSegment[] = [];
	let restarted = true;
	for (let i = 0; i < n; i++) {
		if (i > 0 && states[i] !== (states[i - 1] + 1) % bpb) restarted = true;
		if (states[i] === 0 && restarted) {
			out.push({ startBeat: i, phase: i % bpb });
			restarted = false;
		}
	}
	return out.length > 0 ? out : [{ startBeat: 0, phase: 0 }];
}

/**
 * Every bar line the segments imply, as beat indices.
 *
 * The walk between two restarts is uniform, so a segment is its own anchor plus a stride.
 */
export function barLinesFrom(
	segments: readonly PhaseSegment[],
	beatCount: number,
	beatsPerBar: number
): number[] {
	const out: number[] = [];
	for (let k = 0; k < segments.length; k++) {
		const end = k + 1 < segments.length ? segments[k + 1].startBeat : beatCount;
		for (let i = segments[k].startBeat; i < end; i += beatsPerBar) out.push(i);
	}
	return out;
}
