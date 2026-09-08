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
 * WHAT READS THIS. `analyze.ts` places a movement seam on the right beat with it, within a bar
 * of the mark or the detected seam, and since the 2026-09-08 round it also lets one song move
 * its bar line where the walk's runs pass `acceptedRestarts` below. Run UNRESTRICTED the walk
 * re-bars praised tracks: `bench/phasegrid.ts` scored it five worse, including a Killing In the
 * Name seam moved 0.64 s, because the raw walk chases every stretch where the model hedges the
 * half bar of a 2-bar loop. What the owner's second corpus showed is that the real changes
 * look nothing like the hedges - eight or more bars unanimous on a new residue, out of a run
 * that was unanimous on the old one, with no return - and the strictness that separates them
 * is what `acceptedRestarts` encodes: FE!N's first minute, Stíny's last chorus and bad guy's
 * coda are the model's own downbeats and the owner's marks to the beat; Higher's and
 * Immaterial's hedged stretches are left on the modal phase they were accepted on.
 *
 * It is at least the asymmetric voter the killed plateau detector's postmortem asked for: a
 * broadband onset vote is symmetric under a half-bar flip because a backbeat is, while a
 * downbeat head trained on annotated downbeats is not. On SICKO MODE its two restarts are the
 * owner's own two movement marks, and the first agrees with the kick/snare phase profile and
 * with the mark to within 0.02 s.
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

/** One walk segment with the model's own downbeats counted against it. */
export interface PhaseRun {
	startBeat: number;
	endBeat: number;
	/** Beat index mod `beatsPerBar` of this run's bar lines. */
	phase: number;
	bars: number;
	/** The model's downbeats inside the run, and how many sit on each residue. */
	downbeats: number;
	onPhase: number[];
	/** Share of the run's downbeats on its own bar lines. */
	share: number;
}

/**
 * The walk's segments as runs the caller can judge: how long each is and how unanimously the
 * model's downbeats back its phase. Residues are absolute (beat index mod `beatsPerBar`), so
 * two runs' phases compare directly.
 */
export function phaseRuns(
	segments: readonly PhaseSegment[],
	beats: readonly number[] | Float64Array,
	downbeats: readonly number[],
	beatsPerBar: number
): PhaseRun[] {
	const bpb = Math.max(1, Math.floor(beatsPerBar));
	const isDownbeat = new Set(downbeats.map((t) => Math.round(t * 1000)));
	return segments.map((seg, k) => {
		const startBeat = seg.startBeat;
		const endBeat = k + 1 < segments.length ? segments[k + 1].startBeat : beats.length;
		const onPhase = new Array<number>(bpb).fill(0);
		let count = 0;
		for (let i = startBeat; i < endBeat; i++) {
			if (!isDownbeat.has(Math.round(beats[i] * 1000))) continue;
			count++;
			onPhase[i % bpb]++;
		}
		const phase = startBeat % bpb;
		return {
			startBeat,
			endBeat,
			phase,
			bars: (endBeat - startBeat) / bpb,
			downbeats: count,
			onPhase,
			share: count > 0 ? onPhase[phase] / count : 0
		};
	});
}

/**
 * When a run is solid enough to say where the bar lines are on its own.
 *
 * Eight bars is two phrases, the length the downbeat literature asks a new residue to win
 * before a bar-pointer model may switch (Krebs, Böck), and the shortest stretch over which
 * the owner has ever confirmed a phase by ear; a run to the end of the record may be shorter,
 * because nothing after it can contradict it (Stíny's last chorus, half a bar off for its
 * eight bars). Unanimity at 85% with at least six downbeats: a house record's 2-bar loop has
 * the model hedging both halves at 50-60% for stretches (Higher, Immaterial), and that is
 * ambiguity, not a change.
 */
const SOLID_SHARE = 0.85;
const SOLID_MIN_DOWNBEATS = 6;
const SOLID_MIN_BARS = 8;
const SOLID_TAIL_BARS = 6;
/**
 * And the model has to be SAYING something across the run: it emits a downbeat on nearly every
 * bar it is sure of, and a run where it skips a third of them is a quiet tail it is guessing
 * through. Safír's outro carried 11 downbeats over 16 bars on a new residue, and re-barring
 * it a beat later lost the owner's accepted outro to the DP for nothing audible.
 */
const SOLID_DENSITY = 0.7;
/**
 * The run whose phase the track opens on needs only a majority, not unanimity: bad guy's
 * verses sit at 78% on one residue for 150 s and the rest is the loop's other half; an
 * opening under this is noise the first solid run reads for it (Higher's first minute at 55%).
 * The same majority over four phrases or more is a BODY, and a body may change the phase too:
 * Lose Yourself opens with fifteen bars of piano on one residue and spends its remaining
 * hundred at 83% on another, and holding the intro's phase over the song put every boundary
 * of the song a beat late.
 */
const OPENING_SHARE = 0.6;
const BODY_BARS = 32;
/**
 * A change of phase is a change only if the run before it did not already carry the new
 * residue: a reference with a quarter of its downbeats on the incoming phase was ambiguous,
 * and the incoming run is the model settling, not the record moving its bar line.
 */
const AMBIGUOUS_SHARE = 0.25;

function solid(run: PhaseRun, tail: boolean): boolean {
	if (run.downbeats < SOLID_MIN_DOWNBEATS || run.downbeats < SOLID_DENSITY * run.bars) return false;
	if (run.share >= SOLID_SHARE && run.bars >= (tail ? SOLID_TAIL_BARS : SOLID_MIN_BARS)) return true;
	return run.share >= OPENING_SHARE && run.bars >= BODY_BARS;
}

/**
 * The run that says where the track's bars start: the first with a majority over at least
 * eight bars, else the first solid one. Null when nothing qualifies, and the modal phase is
 * all there is. FE!N opens with nine bars of downbeats on one residue and spends the rest of
 * the record on another; the modal phase put its first minute a beat off, and every one of
 * the owner's four off-grid marks there was the model's own downbeat.
 */
export function openingRun(runs: readonly PhaseRun[]): PhaseRun | null {
	const majority = runs.find((r) => r.share >= OPENING_SHARE && r.bars >= SOLID_MIN_BARS);
	if (majority) return majority;
	return runs.find((r, k) => solid(r, k === runs.length - 1)) ?? null;
}

/**
 * The restarts that are the record moving its bar line, as beat indices where the count starts
 * again. Read from the opening run onward:
 *
 * - a run too short or too divided to be solid changes nothing: the count before it carries
 *   through (the intro of Killing In the Name wanders for thirteen bars);
 * - a solid run on a residue the reference run already carried a quarter of the time is the
 *   model settling an ambiguity, not a change;
 * - a solid run half a bar off that later returns to the reference's residue is the 2-bar
 *   loop heard from its other half (Immaterial's second minute, T.N.T.'s riff), unless the
 *   caller says a seam sits there, where the record really did restart;
 * - anything else solid is a change, and the run becomes the reference.
 */
export function acceptedRestarts(
	runs: readonly PhaseRun[],
	beatsPerBar: number,
	/** Beat indices a movement seam already cuts at; a restart within a bar of one is its business. */
	seams: readonly number[] = []
): number[] {
	const bpb = Math.max(1, Math.floor(beatsPerBar));
	const opening = openingRun(runs);
	if (!opening) return [];
	const out: number[] = [];
	let reference = opening;
	for (let k = runs.indexOf(opening) + 1; k < runs.length; k++) {
		const run = runs[k];
		const tail = k === runs.length - 1;
		if (!solid(run, tail)) continue;
		const shift = (((run.phase - reference.phase) % bpb) + bpb) % bpb;
		if (shift === 0) {
			reference = run;
			continue;
		}
		if (reference.onPhase[run.phase] > AMBIGUOUS_SHARE * reference.downbeats) continue;
		const returns = runs.slice(k + 1).some((later) => later.phase === reference.phase);
		const nearSeam = seams.some((s) => Math.abs(s - run.startBeat) <= bpb);
		if (shift * 2 === bpb && returns && !nearSeam) continue;
		if (!nearSeam) out.push(run.startBeat);
		reference = run;
	}
	return out;
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
