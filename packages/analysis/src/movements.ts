import type { Chromagram } from './chroma.ts';
import { estimateKeySpan } from './chroma.ts';
import type { BarFeatures } from './structure.ts';
import { PITCH_CLASSES } from './chroma.ts';
import { barLinesFrom, phaseSegments } from './downbeatPhase.ts';
import { median } from './dsp/stats.ts';

/**
 * Where one file holds several songs, and the grid repairs that make the question askable.
 *
 * A beat switch is found by witnesses that are independent of each other, because every
 * single one of them fires on ordinary tracks: a tempo step fires on a rock intro at half
 * speed, a downbeat break fires on a fill, and "nothing after this point recurs before it"
 * fires on any intro that never returns. What no ordinary track does is all of it at once -
 * change tempo or break its count, stop repeating itself across the seam, AND change key.
 * Measured over 245 single-song tracks and 330 candidate seams (bench/movements.ts), the
 * four real switches on file sit at chroma recurrence 0.57-0.67 against a control median of
 * 0.98, and at key distance 3.5-6.5 fifths against a control median of 0.
 *
 * The grid repair is the other half. Beat This changes metrical level mid-track (a 71 bpm
 * song read at 143 for thirty seconds, twice, on Melanz) and emits beats through a spoken
 * intro at 250 bpm; both used to reach the bar table as bars of half or a fifth the length
 * of their neighbours. The tempo regimes that find a switch also name those stretches, and
 * they are re-read at the song's own level or filled from its grid.
 */

/** A stretch of the beat stream at one tempo. */
export interface TempoRegime {
	fromBeat: number;
	toBeat: number;
	bpm: number;
	/** Share of the regime's beats within 8% of its median period. */
	steady: number;
	/** The tracker changed level here: the song read at x2, x3, /2 or /3. */
	flip?: number;
	/** Which song this regime belongs to; flips join the song they are a reading of. */
	song: number;
}

/** A run of regimes that is one song counted at one level, flips folded in. */
export interface SongRun {
	index: number;
	fromBeat: number;
	toBeat: number;
	/** Tempo of the longest unflipped stretch. */
	bpm: number;
	/** Duration-weighted steadiness. */
	steady: number;
	seconds: number;
	flippedSeconds: number;
}

/** A tolerance a 20 ms beat grid lives inside: at 140 bpm one frame is 4.7% of a beat. */
const SAME_TEMPO = Math.log(1.08);
/** How far the tempo must move to be a change of tempo rather than a track breathing. */
const MIN_STEP = Math.log(1.1);
const HALF = 16;
const GUARD = 2;
const FLIP_RATIOS = [2, 3, 0.5, 1 / 3];
/**
 * Ratios a tracker also produces by reading triplets or dotted notes of the same pulse. A
 * real 3:2 tempo change exists too (Paranoid Android's third part), so these fold only when
 * the new beats sit on the old grid walked at the new period: a flip keeps phase, a change
 * breaks it.
 */
const TRIPLET_FLIP_RATIOS = [1.5, 4 / 3, 2 / 3, 0.75];
/** How near the old grid a beat must land to count as on it: two frames of the model's 20 ms grid. */
const ON_GRID_S = 0.04;
/**
 * Under this a stretch has no tempo to speak of: speech, silence, a hallucinated intro.
 * Low on purpose - live drums with a swing sit near 0.6 and are music, not noise.
 */
const CHAOS = 0.4;
/**
 * An interior stretch this long with no steady tempo is played music the tracker could not
 * follow, not a gap: it keeps its beats. Edges and short gaps are filled from their neighbour.
 */
const MAX_FILL_S = 20;
/**
 * And an intro or outro this long with no steady tempo is a slow song the tracker lost, not
 * a spoken intro: the two on file are 30 s, Free Bird's first half is 500.
 */
const MAX_EDGE_FILL_S = 45;
/** Fewest beats a stretch needs to be read at all rather than filled from its neighbour. */
const MIN_RUN_BEATS = 6;

/**
 * Change points in the log beat period: the median of the sixteen beats after a point
 * against the sixteen before, with a guard of two so the beat that carries the switch (a
 * dropped beat, a pickup) votes for neither. A step passes through the medians at once; a
 * ramp slides through them and never clears the threshold.
 */
function changePoints(lp: Float64Array): number[] {
	const n = lp.length;
	const jump = new Float64Array(n);
	const window = (from: number, to: number) => median(lp.subarray(from, to));
	for (let i = HALF + GUARD; i + HALF + GUARD <= n; i++) {
		jump[i] = Math.abs(window(i + GUARD, i + GUARD + HALF) - window(i - HALF - GUARD, i - GUARD));
	}
	const cuts: number[] = [];
	let i = 0;
	while (i < n) {
		if (jump[i] < MIN_STEP) {
			i++;
			continue;
		}
		// The run of beats this jump holds, and its top. A median flips all at once, so on a
		// quantised grid the jump sits on a plateau; its centre is the cut, not its first edge.
		let end = i;
		let top = jump[i];
		while (end + 1 < n && jump[end + 1] >= MIN_STEP) {
			end++;
			top = Math.max(top, jump[end]);
		}
		let first = i;
		while (first <= end && jump[first] < top * 0.95) first++;
		let last = end;
		while (last >= first && jump[last] < top * 0.95) last--;
		const centre = (first + last) >> 1;
		// The beat where the period itself moves most, within reach of that centre.
		let best = centre;
		let bestMove = -1;
		for (let k = Math.max(1, centre - HALF / 2); k <= Math.min(n - 1, centre + HALF / 2); k++) {
			const move = Math.abs(lp[k] - lp[k - 1]);
			if (move > bestMove) {
				bestMove = move;
				best = k;
			}
		}
		cuts.push(best);
		i = end + 1;
	}
	return [...new Set(cuts)].sort((a, b) => a - b);
}

/** Tempo of a stretch from the mean of its in-tolerance periods: a median of a 20 ms grid
 * sits on one quantisation level and reads 130 for a 128 bpm track. */
function regimeBpm(lp: Float64Array, from: number, to: number, level: number): number {
	let acc = 0;
	let count = 0;
	for (let i = from; i < to; i++) {
		if (Math.abs(lp[i] - level) >= SAME_TEMPO) continue;
		acc += Math.exp(lp[i]);
		count++;
	}
	return count > 0 ? 60 / (acc / count) : 60 / Math.exp(level);
}

/**
 * `breaks` are moments (seconds) the stream was written across - a filled pause - where no
 * phase survives, so a triplet ratio across one is a change and never a flip.
 */
export function tempoRegimes(beats: ArrayLike<number>, breaks: readonly number[] = []): TempoRegime[] {
	const n = beats.length - 1;
	if (n < 4) return n >= 1 ? [{ fromBeat: 0, toBeat: n, bpm: 60 / Math.max(1e-3, (beats[n] - beats[0]) / n), steady: 1, song: 0 }] : [];
	const lp = new Float64Array(n);
	for (let i = 0; i < n; i++) lp[i] = Math.log(Math.max(1e-3, beats[i + 1] - beats[i]));
	const cuts = [0, ...changePoints(lp).filter((c) => c > 0 && c < n), n];

	const regimes: TempoRegime[] = [];
	for (let k = 0; k + 1 < cuts.length; k++) {
		const from = cuts[k];
		const to = cuts[k + 1];
		if (to <= from) continue;
		const level = median(lp.subarray(from, to));
		let ok = 0;
		for (let i = from; i < to; i++) if (Math.abs(lp[i] - level) < SAME_TEMPO) ok++;
		regimes.push({ fromBeat: from, toBeat: to, bpm: regimeBpm(lp, from, to, level), steady: ok / (to - from), song: 0 });
	}

	// Songs: runs of regimes related by a tracker flip or by no change at all. The anchor is
	// the longest unflipped regime of the run, so a song that flips twice is still one song.
	// A chaotic regime is never the same song as anything: it has no tempo to agree with.
	let song = 0;
	let anchor: TempoRegime | null = regimes[0].steady < CHAOS ? null : regimes[0];
	const seconds = (r: TempoRegime) => beats[r.toBeat] - beats[r.fromBeat];
	for (let k = 1; k < regimes.length; k++) {
		const r = regimes[k];
		if (r.steady < CHAOS || anchor === null) {
			// Two chaotic stretches in a row are one stretch of nothing.
			if (!(r.steady < CHAOS && anchor === null)) song++;
			r.song = song;
			anchor = r.steady < CHAOS ? null : r;
			continue;
		}
		const songBpm = anchor.bpm;
		const anchorStart = beats[anchor.fromBeat];
		const ratio = r.bpm / songBpm;
		// Up to the regime's first eight beats, because the cut lands a beat or two before the
		// stretch it names, and a pickup written at the incoming period is in phase with the
		// outgoing bar line by construction.
		const broken = breaks.some((t) => t > anchorStart && t <= beats[Math.min(r.toBeat - 1, r.fromBeat + 8)] + 1e-6);
		const flip =
			FLIP_RATIOS.find((f) => Math.abs(ratio / f - 1) < 0.05) ??
			TRIPLET_FLIP_RATIOS.find((f) => Math.abs(ratio / f - 1) < 0.03 && !broken && phaseContinuous(beats, r, songBpm, f));
		if (flip !== undefined) {
			r.flip = flip;
			r.song = song;
			continue;
		}
		if (Math.abs(Math.log(ratio)) < SAME_TEMPO) {
			r.song = song;
			if (seconds(r) > seconds(anchor)) anchor = r;
			continue;
		}
		song++;
		r.song = song;
		anchor = r;
	}
	foldBreakdowns(regimes, beats);
	settleLevels(regimes, beats);
	return regimes;
}

/**
 * A short passage at half or double a song's tempo with that song on both sides of it is a
 * breakdown the tracker read at another level - an EDM drop, break, drop - and joins the
 * song. Looser than a flip's own tolerance because a break has few onsets to read a period
 * from, and 134 bpm came back as 73.9 rather than 67 on one annotated track.
 */
const BREAKDOWN_S = 60;
const BREAKDOWN_RATIO_TOLERANCE = 0.12;

function foldBreakdowns(regimes: TempoRegime[], beats: ArrayLike<number>): void {
	const seconds = (r: TempoRegime) => beats[r.toBeat] - beats[r.fromBeat];
	const songs = [...new Set(regimes.map((r) => r.song))];
	for (let k = 1; k + 1 < songs.length; k++) {
		const of = (id: number) => regimes.filter((r) => r.song === id);
		const a = of(songs[k - 1]);
		const b = of(songs[k]);
		const c = of(songs[k + 1]);
		const level = (rs: TempoRegime[]) => {
			let acc = 0;
			let total = 0;
			for (const r of rs) {
				if (r.flip !== undefined || r.steady < CHAOS) continue;
				acc += r.bpm * seconds(r);
				total += seconds(r);
			}
			return total > 0 ? acc / total : null;
		};
		const la = level(a);
		const lb = level(b);
		const lc = level(c);
		if (la === null || lb === null || lc === null) continue;
		if (Math.abs(Math.log(la / lc)) >= SAME_TEMPO) continue;
		if (b.reduce((n, r) => n + seconds(r), 0) > BREAKDOWN_S) continue;
		const ratio = lb / la;
		if (![2, 0.5].some((f) => Math.abs(ratio / f - 1) < BREAKDOWN_RATIO_TOLERANCE)) continue;
		for (const r of [...b, ...c]) r.song = songs[k - 1];
		songs.splice(k, 2);
		k--;
	}
}

/**
 * Each song's level is the tempo with the most seconds behind it, and everything else in
 * the song is a flip of that. The greedy walk above anchors on whatever came first, which
 * on Melanz was a three-second blip at 120 in a song at 60.
 */
function settleLevels(regimes: TempoRegime[], beats: ArrayLike<number>): void {
	const seconds = (r: TempoRegime) => beats[r.toBeat] - beats[r.fromBeat];
	const bySong = new Map<number, TempoRegime[]>();
	for (const r of regimes) bySong.set(r.song, [...(bySong.get(r.song) ?? []), r]);
	for (const rs of bySong.values()) {
		const clusters: { bpm: number; seconds: number; members: TempoRegime[] }[] = [];
		for (const r of rs) {
			const d = seconds(r);
			const c = clusters.find((x) => Math.abs(Math.log(r.bpm / x.bpm)) < SAME_TEMPO);
			if (c) {
				c.bpm = (c.bpm * c.seconds + r.bpm * d) / Math.max(1e-9, c.seconds + d);
				c.seconds += d;
				c.members.push(r);
			} else {
				clusters.push({ bpm: r.bpm, seconds: d, members: [r] });
			}
		}
		const ref = clusters.reduce((x, y) => (y.seconds > x.seconds ? y : x));
		for (const c of clusters) {
			for (const r of c.members) r.flip = c === ref ? undefined : r.bpm / ref.bpm;
		}
	}
}

/**
 * Whether a regime's first beats sit on the song's own grid walked at the flipped period.
 * The grid is anchored on the last beat before the regime, which is the song's whatever
 * came between.
 */
function phaseContinuous(beats: ArrayLike<number>, r: TempoRegime, songBpm: number, flip: number): boolean {
	const period = 60 / songBpm / flip;
	// Anchored on the previous song's own beats, two to four back from the cut: the cut may
	// sit a beat late, and a regime's own first beat would agree with itself. Across a gap
	// of more than a few beats there is no phase to keep.
	let best = 0;
	for (let a = Math.max(0, r.fromBeat - 4); a <= r.fromBeat - 2; a++) {
		const anchor = beats[a];
		if (beats[r.fromBeat] - anchor > 5 * (60 / songBpm)) continue;
		let on = 0;
		let total = 0;
		for (let i = r.fromBeat + 1; i < Math.min(r.toBeat, r.fromBeat + 17); i++) {
			const k = Math.round((beats[i] - anchor) / period);
			if (Math.abs(beats[i] - (anchor + k * period)) <= ON_GRID_S) on++;
			total++;
		}
		if (total >= 4) best = Math.max(best, on / total);
	}
	return best >= 0.85;
}

export function songRuns(regimes: readonly TempoRegime[], beats: ArrayLike<number>): SongRun[] {
	const out: SongRun[] = [];
	for (const r of regimes) {
		let s = out[out.length - 1];
		const d = beats[r.toBeat] - beats[r.fromBeat];
		if (!s || s.index !== r.song) {
			s = { index: r.song, fromBeat: r.fromBeat, toBeat: r.toBeat, bpm: r.bpm, steady: 0, seconds: 0, flippedSeconds: 0 };
			out.push(s);
		}
		s.toBeat = r.toBeat;
		s.steady = (s.steady * s.seconds + r.steady * d) / Math.max(1e-9, s.seconds + d);
		s.seconds += d;
		if (r.flip !== undefined) s.flippedSeconds += d;
	}
	for (const s of out) {
		let acc = 0;
		let total = 0;
		for (const r of regimes) {
			if (r.song !== s.index || r.flip !== undefined) continue;
			const d = beats[r.toBeat] - beats[r.fromBeat];
			acc += r.bpm * d;
			total += d;
		}
		if (total > 0) s.bpm = acc / total;
	}
	return out;
}

export interface GridRepair {
	beats: Float64Array;
	downbeats: number[];
	regimes: TempoRegime[];
	songs: SongRun[];
	/**
	 * Stretches that held no steady beat - a pause, a pickup, a few stray beats, a spoken
	 * intro - and whether each was written over at a neighbouring song's period. The seam's
	 * pause witness reads these, since a filled stream no longer shows a gap and an unfilled
	 * one is still a passage of nothing.
	 */
	zones: { from: number; to: number; filled: boolean }[];
	/**
	 * Tempo seams the incoming song was walked back over: the tracker rode the outgoing
	 * period through the new song's first bar before changing, so its first steady beat
	 * lands a bar late. Where one incoming bar back from it is an outgoing bar line, that
	 * line is the seam and the beats between are rewritten at the incoming period.
	 */
	handshakes: { seam: number; first: number }[];
	/** Beats to the bar, from the model's downbeat spacing; 4 without downbeats. */
	beatsPerBar: number;
	/** Seconds re-read at the song's level after a tracker flip. */
	relevelledSeconds: number;
	/** Seconds written over: pauses, pickups, a spoken intro. */
	filledSeconds: number;
	/** Both; 0 leaves the input untouched. */
	repairedSeconds: number;
}

/**
 * The beat stream with the tracker's level flips undone and its beatless stretches filled.
 *
 * A flipped regime is resampled to the song's level, keeping the beats that continue the
 * neighbouring phase; a chaotic stretch (steady under `CHAOS`, or too short to read) beside
 * a song is replaced by that song's grid extrapolated across it, from the song's own first
 * beat backwards or last beat forwards. Downbeats survive only where the beat under them
 * does. A stream with nothing to repair comes back equal to the input.
 */
/** Beats to the bar from the commonest downbeat spacing, folded the way the meter reads it. */
export function beatsPerBarOf(beats: ArrayLike<number>, downbeats: readonly number[]): number {
	if (beats.length < 2 || downbeats.length < 3) return 4;
	const idx = downbeats.map((d) => nearestIndex(beats, d));
	const gaps = new Map<number, number>();
	for (let i = 1; i < idx.length; i++) {
		const g = idx[i] - idx[i - 1];
		if (g >= 2 && g <= 12) gaps.set(g, (gaps.get(g) ?? 0) + 1);
	}
	let bpb = 4;
	let best = 0;
	for (const [g, c] of gaps) {
		if (c > best) {
			best = c;
			bpb = g;
		}
	}
	// Two is the model hedging half bars on a slow record, not a meter: see `meterFromDownbeats`.
	return bpb === 8 || bpb === 12 || bpb === 2 ? 4 : bpb === 6 ? 3 : bpb;
}

/**
 * Downbeats a flipped regime must carry before they may say which of its beats the fold
 * keeps, and by how much they must favour one parity: two on the other half against one on
 * the walk's own is a hedge, six against one is the record.
 */
const FOLD_MIN_DOWNBEATS = 3;
const FOLD_MAJORITY = 2;

export function repairGrid(beatsIn: ArrayLike<number>, downbeatsIn: readonly number[]): GridRepair {
	const beats = Array.from(beatsIn as ArrayLike<number>);
	const regimes = tempoRegimes(beats);
	const runs = songRuns(regimes, beats);
	const bpb = beatsPerBarOf(beats, downbeatsIn);
	const downbeatIndex = new Set(downbeatsIn.map((d) => nearestIndex(beats, d)));
	const untouched = (): GridRepair => ({
		beats: Float64Array.from(beats),
		downbeats: [...downbeatsIn],
		regimes,
		songs: runs,
		zones: [],
		handshakes: [],
		beatsPerBar: bpb,
		relevelledSeconds: 0,
		filledSeconds: 0,
		repairedSeconds: 0
	});
	if (beats.length < 8 || regimes.length === 0) return untouched();

	const chaotic = (s: SongRun) => s.steady < CHAOS || s.toBeat - s.fromBeat < MIN_RUN_BEATS;
	const lp = (i: number) => Math.log(Math.max(1e-3, beats[i + 1] - beats[i]));
	// Each beat keeps a flag saying whether it was heard or written; `fold` marks the one beat a
	// fold moved onto the other half of a doubled regime, so the passes that drop or rewrite a
	// short interval leave that seam alone.
	const out: { t: number; heard: boolean; fold?: boolean }[] = [];
	const zones: { from: number; to: number; filled: boolean }[] = [];
	const handshakes: { seam: number; first: number }[] = [];
	let filledSeconds = 0;
	let relevelled = 0;
	/** The beat a fill has written up to, so the song after it starts at its own first steady beat. */
	let fillEnd = 0;

	/**
	 * The song's regular bar lines, as beat indices: the model's downbeats on the residue
	 * most of them share, so a stray downbeat on the last beat before a pause (Melanz puts
	 * one two beats after the real bar line) does not pass for one.
	 */
	const regularDownbeats = (s: SongRun): number[] => {
		const own = [...downbeatIndex].filter((i) => i >= s.fromBeat && i < s.toBeat).sort((a, b) => a - b);
		if (own.length < 3) return own;
		const votes = new Map<number, number>();
		for (const i of own) votes.set(i % bpb, (votes.get(i % bpb) ?? 0) + 1);
		let residue = own[0] % bpb;
		let best = 0;
		for (const [r, c] of votes) {
			if (c > best) {
				best = c;
				residue = r;
			}
		}
		return own.filter((i) => i % bpb === residue);
	};

	const pushHeard = (from: number, to: number) => {
		for (let i = from; i < to; i++) out.push({ t: beats[i], heard: true });
	};
	/**
	 * Which of a flipped regime's heard beats carry the model's downbeats, as the fraction of
	 * the song's period past the walk's own grid from `anchor`: 0 when they sit on the beats
	 * the walk keeps, 1/2 (or 1/3, 2/3) when they sit on the ones it drops. A regime heard at
	 * double time has two halves the fold can keep, and continuing the phase before it is a
	 * guess about the record: Pátky's chorus is heard at 140 over a 70 song, its downbeats fall
	 * on the half the continuing fold dropped, and the owner's "the chorus starts EXACTLY here"
	 * at 116.6 s sat half a beat off every bar line, unreachable in the editor. Zero when the
	 * regime carries too few downbeats to say, or when they hedge both halves.
	 */
	const foldOffset = (r: TempoRegime, anchor: number, period: number): number => {
		const f = Math.round(r.flip ?? 1);
		if (f < 2 || Math.abs((r.flip ?? 1) - f) > 0.05) return 0;
		const votes = new Int32Array(f);
		for (const d of downbeatIndex) {
			if (d < r.fromBeat || d >= r.toBeat) continue;
			const x = (beats[d] - anchor) / period;
			votes[Math.round((x - Math.floor(x)) * f) % f]++;
		}
		let k = 0;
		for (let j = 1; j < f; j++) if (votes[j] > votes[k]) k = j;
		return k > 0 && votes[k] >= FOLD_MIN_DOWNBEATS && votes[k] >= FOLD_MAJORITY * votes[0] ? k / f : 0;
	};
	/** The incoming song's grid walked back from its first beat to `from`, in order. */
	const fillBack = (firstBeat: number, from: number, period: number) => {
		const virtual: number[] = [];
		for (let t = beats[firstBeat] - period; t >= from - 1e-6; t -= period) virtual.push(t);
		virtual.reverse();
		for (const t of virtual) out.push({ t, heard: false });
	};

	// Where each steady song's own beats begin and end: the beats at its edges that do not
	// hold its period for three beats running are the seam zone, and belong to nobody. Three,
	// because two stray beats in a pause landed a period apart by chance on Melanz.
	const RUN = 3;
	const steadyFrom = (s: SongRun, run = RUN) => {
		const level = Math.log(60 / s.bpm);
		const holds = (i: number) => i < s.toBeat && Math.abs(lp(i) - level) < SAME_TEMPO;
		let i = s.fromBeat;
		while (i < s.toBeat - 1) {
			let ok = true;
			for (let k = 0; k < Math.min(run, s.toBeat - i); k++) if (!holds(i + k)) ok = false;
			if (ok) break;
			i++;
		}
		return i;
	};
	const steadyTo = (s: SongRun) => {
		const level = Math.log(60 / s.bpm);
		const holds = (i: number) => i >= s.fromBeat && Math.abs(lp(i) - level) < SAME_TEMPO;
		let i = s.toBeat;
		while (i > s.fromBeat + 1) {
			let ok = true;
			for (let k = 1; k <= Math.min(RUN, i - s.fromBeat); k++) if (!holds(i - k)) ok = false;
			if (ok) break;
			i--;
		}
		return i;
	};

	/**
	 * The record's lead-in, up to the first beat from which the first steady song holds its
	 * period for four bars. Where the beats before it are not at that period they are the
	 * model hearing a pulse in a beatless intro - SICKO MODE's opens at a beat every 2.5 s -
	 * and are written at the song's period instead, so the bar count into the song's first
	 * downbeat is the song's. Sixteen beats, not the seam zone's three: an intro can hold a
	 * pulse for two bars and lose it again.
	 */
	let leadDone = false;
	const writeLead = (s: SongRun): number | null => {
		if (leadDone || s.seconds < MIN_SONG_S || s.steady < MIN_STEADY) return null;
		leadDone = true;
		const period = 60 / s.bpm;
		let first = steadyFrom(s, 16);
		if (first >= s.toBeat - 16) first = steadyFrom(s);
		if (first < 2 || beats[first] > MAX_EDGE_FILL_S) return null;
		// Kept when nine in ten of its intervals are the song's period: a lead-in the tracker
		// counted through needs nothing. SICKO MODE's holds the period on two beats in three
		// and drops the fourth of every bar, which is what shifts every bar line after it.
		let held = 0;
		for (let i = 1; i <= first; i++) if (Math.abs(Math.log((beats[i] - beats[i - 1]) / period)) < SAME_TEMPO) held++;
		if (held >= 0.9 * first) return null;
		out.length = 0;
		zones.length = 0;
		filledSeconds = 0;
		relevelled = 0;
		fillBack(first, 0, period);
		zones.push({ from: 0, to: beats[first], filled: true });
		filledSeconds = beats[first];
		fillEnd = first;
		return first;
	};

	for (let k = 0; k < runs.length; k++) {
		const s = runs[k];
		const period = 60 / s.bpm;
		if (chaotic(s)) {
			const prev = runs.slice(0, k).reverse().find((r) => !chaotic(r));
			const next = runs.slice(k + 1).find((r) => !chaotic(r));
			const from = beats[s.fromBeat];
			const to = beats[s.toBeat];
			// Filled from the song it leads into where there is one - a pause before a new
			// song belongs to that song's count - otherwise from the one it follows.
			const source = next ?? prev ?? null;
			const interior = prev !== undefined && next !== undefined;
			if (!source || to - from > (interior ? MAX_FILL_S : MAX_EDGE_FILL_S)) {
				zones.push({ from, to, filled: false });
				pushHeard(s.fromBeat, s.toBeat);
				continue;
			}
			filledSeconds += to - from;
			zones.push({ from, to, filled: true });
			const p = 60 / source.bpm;
			if (source === next) {
				const last = out[out.length - 1]?.t ?? -Infinity;
				const first = steadyFrom(next);
				fillBack(first, Math.max(from, last + p * 0.5), p);
				fillEnd = first;
			} else {
				const last = out[out.length - 1]?.t ?? from;
				for (let t = last + p; t < to - 1e-6; t += p) out.push({ t, heard: false });
			}
			continue;
		}

		// The seam zone before this song. After a real pause (more than a beat and a half of
		// the incoming period past the outgoing song's last steady beat) the outgoing song ends
		// on its last complete bar - at that bar's end, or at the start of an incomplete one -
		// and everything from there to the new song's first steady beat is written at the
		// incoming period as its pickup. Without a pause the song ends where its beats do; a
		// three-beat bar rushing into SICKO MODE's switch is the old song's, and the seam is
		// the new downbeat.
		const prev = runs.slice(0, k).reverse().find((r) => !chaotic(r));
		const first = steadyFrom(s);
		const lead = writeLead(s);
		if (prev && lead === null) {
			const lastSteady = steadyTo(prev);
			const outPeriod = 60 / prev.bpm;
			const zoneTo = beats[first];
			const gap = zoneTo - beats[lastSteady];
			if (gap > period * 1.5) {
				const line = regularDownbeats(prev).filter((i) => i <= lastSteady && lastSteady - i < bpb).pop();
				let seamTime = beats[lastSteady];
				let seamHeard = true;
				if (line !== undefined) {
					const complete = lastSteady - line >= bpb - 1;
					seamTime = complete ? beats[line + bpb - 1] + outPeriod : beats[line];
					seamHeard = !complete;
				}
				// Longer than a pickup is a band drifting between two tempos, which is music.
				if (zoneTo - seamTime > period * 1.5 && zoneTo - seamTime <= MAX_FILL_S) {
					// Drop what the loop already pushed inside the zone - stray beats and any fill
					// a chaotic run between the songs was given - then fill it as one.
					while (out.length > 0 && out[out.length - 1].t > seamTime + 1e-6) out.pop();
					while (zones.length > 0 && zones[zones.length - 1].to > seamTime + 1e-6) {
						const z = zones.pop()!;
						if (z.filled) filledSeconds -= z.to - z.from;
					}
					if (!seamHeard) out.push({ t: seamTime, heard: false });
					zones.push({ from: seamTime, to: zoneTo, filled: true });
					filledSeconds += zoneTo - seamTime;
					fillBack(first, seamTime + period * 0.5, period);
					fillEnd = first;
				}
			} else if (Math.abs(Math.log(outPeriod / period)) >= MIN_STEP) {
				// A tempo seam with no pause. One incoming bar back from the new song's first
				// steady beat, on an outgoing bar line to within two frames, means the tracker
				// rode the old period through the new song's first bar: the seam is that line
				// and the bar is rewritten at the incoming period.
				const seamTime = zoneTo - bpb * period;
				const line = regularDownbeats(prev).find((i) => Math.abs(beats[i] - seamTime) <= ON_GRID_S);
				if (line !== undefined) {
					while (out.length > 0 && out[out.length - 1].t > beats[line] + 1e-6) out.pop();
					for (let j = 0; j < bpb; j++) out.push({ t: beats[line] + j * period, heard: j === 0 });
					handshakes.push({ seam: beats[line], first: zoneTo });
					relevelled += zoneTo - beats[line];
					fillEnd = first;
				}
			}
		}
		// The song's own beats start where the last fill stopped writing: strays a fill
		// covered go, drift beats a fill did not touch stay.
		for (const r of regimes) {
			if (r.song !== s.index) continue;
			if (r.flip === undefined) {
				pushHeard(Math.max(r.fromBeat, fillEnd), r.toBeat);
				continue;
			}
			relevelled += beats[r.toBeat] - beats[r.fromBeat];
			// Walk the song's period from the last kept beat through the flipped stretch, taking
			// the heard beat nearest each step where one is close and writing one where not.
			// The first step is shorter where the model's downbeats sit on the other half of the
			// doubled beats: one short beat at the seam, and every bar line after it is where the
			// model heard one, at the same count.
			const anchor = out[out.length - 1]?.t ?? beats[r.fromBeat] - period;
			const end = beats[Math.min(r.toBeat, beats.length - 1)];
			const offset = foldOffset(r, anchor, period);
			let fold = offset > 0;
			let i = r.fromBeat;
			for (let t = anchor + (fold ? offset : 1) * period; t < end + period * 0.25; t += period) {
				while (i < r.toBeat && beats[i] < t - period * 0.25) i++;
				const near = i < r.toBeat && Math.abs(beats[i] - t) <= period * 0.25 ? beats[i] : null;
				if (near !== null) {
					out.push({ t: near, heard: true, fold });
					t = near;
				} else {
					out.push({ t, heard: false, fold });
				}
				fold = false;
			}
		}
	}
	// The stream's last beat, which no regime holds (a regime is a period between beats).
	out.push({ t: beats[beats.length - 1], heard: true });
	out.sort((a, b) => a.t - b.t);
	const blipSeconds = repairBlips(out, runs, beats);
	if (filledSeconds + relevelled + blipSeconds === 0) return { ...untouched(), zones, handshakes };

	// A written beat that lands on a heard one is the same beat, and a beat under six tenths
	// of its song's period from the one before is a leftover of the other level - the regime
	// cut sits a beat or two off the true end of a flip - and goes. The one exception is the
	// fold's own short beat, which is exactly that distance on purpose.
	const periodAt = (t: number) => {
		const song = runs.find((r) => beats[r.fromBeat] <= t && t < beats[r.toBeat]) ?? runs[runs.length - 1];
		return 60 / song.bpm;
	};
	const times: number[] = [];
	const heardAt = new Set<number>();
	for (const b of out) {
		if (!b.fold && times.length > 0 && b.t - times[times.length - 1] < 0.6 * periodAt(b.t)) continue;
		times.push(b.t);
		if (b.heard) heardAt.add(Math.round(b.t * 1000));
	}
	const downbeats = downbeatsIn.filter((d) => heardAt.has(Math.round(d * 1000)));
	const repairedBeats = Float64Array.from(times);
	const regimesOut = tempoRegimes(repairedBeats, [
		...zones.filter((z) => z.filled).map((z) => z.from),
		...handshakes.map((h) => h.seam)
	]);
	return {
		beats: repairedBeats,
		downbeats,
		regimes: regimesOut,
		songs: songRuns(regimesOut, repairedBeats),
		zones,
		handshakes,
		beatsPerBar: bpb,
		relevelledSeconds: relevelled + blipSeconds,
		filledSeconds,
		repairedSeconds: filledSeconds + relevelled + blipSeconds
	};
}

/** A beat interval this far off the period is not the count. */
const BLIP_TOLERANCE = 0.25;
/** The most a blip may span, in bars: longer is a passage, and the regimes own those. */
const MAX_BLIP_BARS = 4;

/**
 * Short stretches inside a steady song where the tracker lost the count - a few beats at
 * double time in a quiet breakdown, a beat dropped or doubled - rewritten at the song's
 * period between the steady beats either side. HIGHEST IN THE ROOM has three, of nine, two
 * and two beats, and each one moved every bar line after it by a beat until the next undid
 * it. Below the regimes' sixteen-beat resolution, which is why they slipped through; and
 * never across a song's edge, where a written zone or the lead-in already holds.
 * Returns the seconds rewritten; the stream is edited in place.
 */
function repairBlips(out: { t: number; heard: boolean; fold?: boolean }[], runs: readonly SongRun[], beats: readonly number[]): number {
	let rewritten = 0;
	for (const s of runs) {
		if (s.steady < MIN_STEADY || s.seconds < MIN_SONG_S) continue;
		const from = beats[s.fromBeat];
		const to = beats[Math.min(beats.length - 1, s.toBeat)];
		const P = 60 / s.bpm;
		const good = (d: number) => Math.abs(d / P - 1) <= BLIP_TOLERANCE;
		let i = 0;
		while (i + 1 < out.length) {
			if (out[i].t < from || out[i].t >= to) {
				i++;
				continue;
			}
			// A is a steady beat: the interval into it and out of it is the count... the one
			// out of it is not, which is where the blip starts. A fold's short beat is the one
			// short interval that is the record, not a lost count.
			const intoA = i > 0 ? out[i].t - out[i - 1].t : P;
			if (!good(intoA) || good(out[i + 1].t - out[i].t) || out[i + 1].fold) {
				i++;
				continue;
			}
			// B is the first beat after the blip that the count holds through for two beats.
			let j = i + 1;
			while (j + 2 < out.length && out[j].t < to && !(good(out[j + 1].t - out[j].t) && good(out[j + 2].t - out[j + 1].t))) j++;
			const span = out[j].t - out[i].t;
			if (out[j].t >= to || j + 2 >= out.length || span > MAX_BLIP_BARS * 4 * P) {
				i = j;
				continue;
			}
			const n = Math.max(1, Math.round(span / P));
			const written: { t: number; heard: boolean }[] = [];
			for (let k = 1; k < n; k++) written.push({ t: out[i].t + (span * k) / n, heard: false });
			out.splice(i + 1, j - i - 1, ...written);
			rewritten += span;
			i = i + written.length + 1;
		}
	}
	return rewritten;
}

// --- seams --------------------------------------------------------------------------------

/** A song shorter than this is a hesitation, not a song. */
const MIN_SONG_S = 20;
const MIN_STEADY = 0.7;
/** Nothing within this of the track's ends is a seam: the model always breaks its count there. */
const EDGE_S = 15;
/** And nothing this early: an opening shorter than this at its own tempo is the song's intro. */
const START_EDGE_S = 45;
/**
 * Two seams closer than this are one, and the stronger keeps it. Hard seams (a tempo step, a
 * long pause, an interlude edge) may sit eight seconds apart - family ties switches twice in
 * sixteen - where the soft class needs a song's worth of distance, or a coda whose count
 * wobbles reads as three switches.
 */
const HARD_SEAM_GAP_S = 8;
const SOFT_SEAM_GAP_S = 30;

export interface SeamCandidate {
	/** Seconds. For a tempo seam with a pause before it, the moment the outgoing song stops. */
	t: number;
	beat: number;
	tempo?: {
		from: number;
		to: number;
		ratio: number;
		/** Two constants against one curve over the beats either side, 0..1; a ramp reads 0. */
		step: number;
		/** The longest beat gap at the seam over the incoming period. */
		pause: number;
		leftSeconds: number;
		rightSeconds: number;
	};
	/** The model's downbeat spacing at the seam where it is not the meter, in beats. */
	downbeatGap?: number;
	/** The phase walk restarts its count within a bar of here. */
	reset: boolean;
	/** A beatless stretch the repair wrote over, ending at this seam, seconds. */
	pause?: number;
	/** The written stretch itself, so the witnesses read the music either side of it. */
	zone?: { from: number; to: number };
	/**
	 * The seam sits on a bar line the repair established - the outgoing song's last regular
	 * bar line before a pause, or a handshake - and is cut exactly there rather than snapped
	 * to the phase walk, which cannot count bars across a rewritten stretch.
	 */
	exact?: boolean;
	/**
	 * This seam is an edge of a long beatless passage - an a cappella, a spoken interlude, an
	 * ambient bridge - which becomes a movement of its own: 'start' where the beat stops,
	 * 'end' where one returns. Seconds of the passage.
	 */
	interlude?: { edge: 'start' | 'end'; seconds: number };
	// Material witnesses, filled by `judgeSeams`.
	chromaRatio?: number;
	timbreRatio?: number;
	keyDist?: number;
	keyConf?: number;
	keyLeft?: string;
	keyRight?: string;
	leftSeconds?: number;
	rightSeconds?: number;
}

/**
 * Step against ramp over the beats either side of a seam: two constants meeting at the seam
 * against one constant-acceleration curve, as a share of the curve's residual the step
 * removes. A band speeding up is explained by the curve; a switch only by the step.
 */
export function stepScore(beats: ArrayLike<number>, seamBeat: number): number {
	// The transition may take a beat or four bars: a guard that hides it is tried at three
	// widths and the clearest reading wins. A slow ramp reads as a curve at every width.
	let best = 0;
	for (const guard of [3, 8, 16]) best = Math.max(best, curveTest(beats, seamBeat, guard + 24, guard));
	return best;
}

function curveTest(beats: ArrayLike<number>, seamBeat: number, reach: number, guard: number): number {
	const n = beats.length - 1;
	const xs: number[] = [];
	const ys: number[] = [];
	for (let i = Math.max(0, seamBeat - reach); i < Math.min(n, seamBeat + reach); i++) {
		if (Math.abs(i - seamBeat) < guard) continue;
		xs.push(i - seamBeat);
		ys.push(Math.log(Math.max(1e-3, beats[i + 1] - beats[i])));
	}
	if (xs.length < 8) return 0;
	const left: number[] = [];
	const right: number[] = [];
	for (let k = 0; k < xs.length; k++) (xs[k] < 0 ? left : right).push(ys[k]);
	if (left.length < 4 || right.length < 4) return 0;
	const ml = median(left);
	const mr = median(right);
	let rssStep = 0;
	for (let k = 0; k < xs.length; k++) rssStep += (ys[k] - (xs[k] < 0 ? ml : mr)) ** 2;
	const rssQuad = quadraticResidual(xs, ys);
	if (rssQuad <= 1e-12) return 0;
	return Math.max(0, Math.min(1, (rssQuad - rssStep) / rssQuad));
}

function quadraticResidual(xs: number[], ys: number[]): number {
	let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
	for (let k = 0; k < xs.length; k++) {
		const x = xs[k];
		const y = ys[k];
		s0 += 1; s1 += x; s2 += x * x; s3 += x * x * x; s4 += x * x * x * x;
		t0 += y; t1 += x * y; t2 += x * x * y;
	}
	const coef = solve3([[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]], [t0, t1, t2]);
	if (!coef) return 0;
	let rss = 0;
	for (let k = 0; k < xs.length; k++) {
		const x = xs[k];
		rss += (ys[k] - (coef[0] + coef[1] * x + coef[2] * x * x)) ** 2;
	}
	return rss;
}

function solve3(A: number[][], b: number[]): number[] | null {
	const M = A.map((row, i) => [...row, b[i]]);
	for (let c = 0; c < 3; c++) {
		let p = c;
		for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
		if (Math.abs(M[p][c]) < 1e-12) return null;
		[M[c], M[p]] = [M[p], M[c]];
		for (let r = 0; r < 3; r++) {
			if (r === c) continue;
			const f = M[r][c] / M[c][c];
			for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
		}
	}
	return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

function nearestIndex(times: ArrayLike<number>, t: number): number {
	let lo = 0;
	let hi = times.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= t) lo = mid;
		else hi = mid;
	}
	return Math.abs(times[lo] - t) <= Math.abs(times[hi] - t) ? lo : hi;
}

/**
 * Seams worth judging: the boundary between two songs the regimes separate, and every place
 * the model's own downbeat count breaks while the phase walk restarts there. Both classes
 * fire on ordinary tracks; the material witnesses decide.
 */
/** A pickup this long or shorter belongs to the incoming song; longer is a passage of the outgoing one. */
const PICKUP_S = 12;
/** A beatless stretch this long is a seam witness on its own. */
const MIN_PAUSE_S = 2;
/** A beatless passage this long between two songs is a movement of its own. */
const INTERLUDE_S = 20;

export function proposeSeams(repair: GridRepair, beatsPerBar: number, duration: number): SeamCandidate[] {
	const { beats, downbeats, songs, zones, handshakes } = repair;
	const out: SeamCandidate[] = [];
	const add = (c: SeamCandidate) => {
		const near = out.find((x) => Math.abs(x.t - c.t) < 2.5);
		if (!near) {
			out.push(c);
			return;
		}
		if (c.tempo && !near.tempo) Object.assign(near, { tempo: c.tempo, t: c.t, beat: c.beat, exact: c.exact });
		if (c.zone && !near.zone) near.zone = c.zone;
		if (c.downbeatGap !== undefined) near.downbeatGap = c.downbeatGap;
		if (c.pause !== undefined) near.pause = Math.max(near.pause ?? 0, c.pause);
		if (c.interlude && !near.interlude) near.interlude = c.interlude;
		near.reset ||= c.reset;
	};
	/** The filled stretch ending within a beat of `t`, if any. */
	const zoneEndingAt = (t: number, period: number) =>
		zones.find((f) => Math.abs(f.to - t) <= period * 1.5 && f.to - f.from >= MIN_PAUSE_S);

	const idx = downbeats.map((d) => nearestIndex(beats, d));
	const long = songs.filter((s) => s.seconds >= MIN_SONG_S && s.steady >= MIN_STEADY);
	for (let k = 0; k + 1 < long.length; k++) {
		const a = long[k];
		const b = long[k + 1];
		const ratio = Math.max(a.bpm, b.bpm) / Math.min(a.bpm, b.bpm);
		if (Math.log(ratio) < MIN_STEP) continue;
		const incoming = 60 / b.bpm;
		// Where the incoming song's own beats begin: past whatever the repair wrote before them.
		// The regime cut can sit a beat or two before the zone it names, so a zone starting
		// within a bar of the cut is this song's pickup.
		let first = b.fromBeat;
		const zone = zones.find((f) => f.from < beats[b.fromBeat] + beatsPerBar * incoming && f.to > beats[b.fromBeat] - incoming);
		if (zone) first = nearestIndex(beats, zone.to);
		const pauseSeconds = zone ? zone.to - zone.from : 0;
		// An interlude is its own movement and owns both its edges; the tempo seam is then
		// the interlude's end and is proposed below.
		if (zone && pauseSeconds >= INTERLUDE_S) continue;
		// A short pause is the new song's pickup and the seam is where the old one stopped; a
		// long beatless passage is the old song's, and the seam is the new beat. Without a
		// pause, a handshake puts the seam on the outgoing bar line the new song began on.
		const shake = handshakes.find((h) => beats[first] >= h.seam - incoming && beats[first] <= h.first + incoming);
		// The regime cut takes the last old-song beat that happens to fit the new period; the
		// model's first downbeat within a bar of it is where the new song counts from.
		const downbeat = idx.find((j) => j >= first && beats[j] <= beats[first] + beatsPerBar * incoming + 1e-3);
		let beat = first;
		let exact = !!zone;
		if (zone && pauseSeconds <= PICKUP_S) {
			beat = nearestIndex(beats, zone.from);
			exact = true;
		} else if (shake) {
			beat = nearestIndex(beats, shake.seam);
			exact = true;
		} else if (downbeat !== undefined) {
			beat = downbeat;
			exact = true;
		}
		add({
			t: beats[beat],
			beat,
			exact,
			tempo: {
				from: a.bpm,
				to: b.bpm,
				ratio,
				// Across a silence the tempo can only step; the curve test is for a change played through.
				step: zone ? 1 : stepScore(beats, first),
				pause: zone ? pauseSeconds / incoming : 1,
				leftSeconds: a.seconds,
				rightSeconds: b.seconds
			},
			reset: false,
			pause: pauseSeconds,
			zone: zone ? { from: zone.from, to: zone.to } : undefined
		});
	}

	// Beatless stretches inside the track. A short one is a pause or a pickup and one seam;
	// a long one between two songs is an interlude with a seam at each edge.
	const interludes: { from: number; to: number }[] = [];
	for (const f of zones) {
		const seconds = f.to - f.from;
		if (seconds < MIN_PAUSE_S || f.from < EDGE_S || f.to > duration - EDGE_S) continue;
		const before = songs.find((s) => beats[s.toBeat] >= f.from - 1 && beats[s.fromBeat] < f.from && s.seconds >= MIN_SONG_S && s.steady >= MIN_STEADY);
		const after = songs.find((s) => beats[s.fromBeat] <= f.to + 1 && beats[s.toBeat] > f.to && s.seconds >= MIN_SONG_S && s.steady >= MIN_STEADY);
		if (seconds >= INTERLUDE_S) {
			if (!before || !after) continue;
			interludes.push(f);
			add({ t: f.from, beat: nearestIndex(beats, f.from), reset: false, interlude: { edge: 'start', seconds }, zone: f });
			add({ t: f.to, beat: nearestIndex(beats, f.to), reset: false, pause: seconds, interlude: { edge: 'end', seconds }, zone: f });
			continue;
		}
		const beat = nearestIndex(beats, seconds <= PICKUP_S ? f.from : f.to);
		add({ t: beats[beat], beat, reset: false, pause: seconds, exact: true, zone: f });
	}
	const insideInterlude = (t: number) => interludes.some((f) => t > f.from + 1 && t < f.to - 1);
	/** A pickup zone a tempo seam already owns: its end is that seam, not a second one. */
	const ownedPickup = (t: number, period: number) => {
		const z = zoneEndingAt(t, period);
		return !!z && z.to - z.from <= PICKUP_S && out.some((c) => c.tempo && Math.abs(c.t - z.from) < 2.5);
	};

	for (let i = 1; i < idx.length; i++) {
		const g = idx[i] - idx[i - 1];
		if (g === beatsPerBar) continue;
		const t = beats[idx[i]];
		if (t < EDGE_S || t > duration - EDGE_S || insideInterlude(t)) continue;
		const period = beats[idx[i]] - beats[idx[i] - 1];
		if (ownedPickup(t, period)) continue;
		const zone = zoneEndingAt(t, period);
		add({ t, beat: idx[i], downbeatGap: g, reset: false, pause: zone ? zone.to - zone.from : undefined, zone });
	}

	if (downbeats.length > 0) {
		const segs = phaseSegments(beats, downbeats, beatsPerBar);
		for (const s of segs.slice(1)) {
			const t = beats[s.startBeat];
			if (t < EDGE_S || t > duration - EDGE_S || insideInterlude(t)) continue;
			add({ t, beat: s.startBeat, reset: true });
		}
	}
	return out.sort((a, b) => a.t - b.t);
}

/** What the material witnesses read: the walk-phased bar table and its similarities. */
export interface SeamMaterial {
	bars: BarFeatures;
	sim: Float32Array;
	chroma: Chromagram;
}

/** Bars phased by the unrestricted walk, so a reset on one side does not read as new material. */
export function witnessBarLines(
	beats: readonly number[] | Float64Array,
	downbeats: readonly number[],
	beatsPerBar: number
): number[] {
	const lines = barLinesFrom(phaseSegments(beats, downbeats, beatsPerBar), beats.length, beatsPerBar);
	return [...lines, beats.length - 1].filter((v, i, a) => i === 0 || v > a[i - 1]);
}

const WINDOW = 8;
const KEY_REACH = 40;

/** Mean diagonal similarity of two equal windows: the repeat score `groupSegments` uses. */
function windowScore(sim: Float32Array, n: number, a: number, b: number, w: number): number {
	let acc = 0;
	for (let k = 0; k < w; k++) acc += sim[(a + k) * n + (b + k)];
	return acc / w;
}

/**
 * The strongest window-to-window match across the seam against the strongest either side
 * finds within itself, over the whole track: a bridge is unique material too, but the song
 * comes back after it, and a new song never does.
 */
function recurrence(sim: Float32Array, n: number, seamBar: number, fromBar: number, toBar: number, rightBar = seamBar) {
	const w = WINDOW;
	const left: number[] = [];
	for (let a = fromBar; a + w <= seamBar; a += 2) left.push(a);
	const right: number[] = [];
	for (let b = rightBar; b + w <= toBar; b += 2) right.push(b);
	if (left.length === 0 || right.length === 0) return null;
	let cross = -Infinity;
	for (const a of left) for (const b of right) cross = Math.max(cross, windowScore(sim, n, a, b, w));
	let within = -Infinity;
	for (const side of [left, right]) {
		for (let i = 0; i < side.length; i++) {
			for (let j = i + 1; j < side.length; j++) {
				if (side[j] - side[i] < w) continue;
				within = Math.max(within, windowScore(sim, n, side[i], side[j], w));
			}
		}
	}
	if (!Number.isFinite(within)) within = 0;
	return { cross, within };
}

/** Chroma centred on the track's own mean, then cosine: raw chroma reads 0.95 between songs. */
function centredChromaSimilarity(bars: BarFeatures): Float32Array {
	const n = bars.count;
	const mean = new Float64Array(PITCH_CLASSES);
	for (let i = 0; i < n; i++) for (let k = 0; k < PITCH_CLASSES; k++) mean[k] += bars.chroma[i * PITCH_CLASSES + k] / n;
	const centred = new Float64Array(n * PITCH_CLASSES);
	for (let i = 0; i < n; i++) {
		let norm = 0;
		for (let k = 0; k < PITCH_CLASSES; k++) {
			const v = bars.chroma[i * PITCH_CLASSES + k] - mean[k];
			centred[i * PITCH_CLASSES + k] = v;
			norm += v * v;
		}
		norm = Math.sqrt(norm) || 1;
		for (let k = 0; k < PITCH_CLASSES; k++) centred[i * PITCH_CLASSES + k] /= norm;
	}
	const sim = new Float32Array(n * n);
	for (let i = 0; i < n; i++) {
		sim[i * n + i] = 1;
		for (let j = i + 1; j < n; j++) {
			let dot = 0;
			for (let k = 0; k < PITCH_CLASSES; k++) dot += centred[i * PITCH_CLASSES + k] * centred[j * PITCH_CLASSES + k];
			sim[i * n + j] = dot;
			sim[j * n + i] = dot;
		}
	}
	return sim;
}

/** Distance between two keys on the circle of fifths, half a step more for a mode change. */
function keyDistance(a: { tonic: number; mode: string }, b: { tonic: number; mode: string }): number {
	const fifths = (tonic: number) => (tonic * 7) % PITCH_CLASSES;
	const d = Math.abs(fifths(a.tonic) - fifths(b.tonic));
	return Math.min(d, PITCH_CLASSES - d) + (a.mode !== b.mode ? 0.5 : 0);
}

/**
 * The thresholds, from bench/movements.ts over the app cache, Harmonix, Raveform and the
 * multi-song corpus.
 *
 * A tempo seam stands on its own when the step is a step (or a pause stands in for one):
 * a record that changes tempo and holds it for twenty seconds either side is re-staged
 * whether or not the key moved - the key reading is a guess on most rap (confidence 0.2 to
 * 0.5) and multi-movement rock stays in related keys. A seam with no
 * tempo evidence needs a song's worth of material on both sides, material that does not
 * recur across it on timbre AND harmony, and either a pause or a confident key change.
 */
const TEMPO_STEP = 0.4;
const TEMPO_PAUSE = 2;
/**
 * A 3:2 or 4:3 ratio the phase test did not fold is still what a tracker produces reading
 * triplets, so it also needs the material to stop recurring or the key to move.
 */
const TRIPLET_RATIOS = [1.5, 4 / 3];
const TRIPLET_MATERIAL = 0.75;
const MATERIAL_CHROMA = 0.7;
const MATERIAL_TIMBRE = 0.88;
/** After a silence this long, new harmony alone says the beat that follows is a new song. */
const LONG_PAUSE_S = 8;
const LONG_PAUSE_CHROMA = 0.75;
const SAME_TEMPO_LEFT_S = 45;
const SAME_TEMPO_RIGHT_S = 40;
const SAME_TEMPO_KEY = 3;
const SAME_TEMPO_KEY_CONF = 0.45;
const SAME_TEMPO_PAUSE_S = 2;
/**
 * A passage the beat stops for and then returns to the same material is a breakdown, not
 * a seam, whatever its length: an EDM break, a rock bridge.
 */
const BREAKDOWN_CHROMA = 0.85;
const BREAKDOWN_TIMBRE = 0.95;

export interface Movement {
	/** Seconds: the seam the analysis cuts the grid at. */
	t: number;
	source: 'auto';
	/** For the panel: what convinced the detector. */
	note: string;
	/** The seam is a bar line already; cut there, do not snap it to the walk. */
	exact: boolean;
}

/**
 * The seams that are movements, judged from the material either side.
 *
 * `material` is the walk-phased bar table (`witnessBarLines`) with `similarityMatrix` over
 * it; the chroma is the track's chromagram. Fills the witness fields on every candidate for
 * the bench to read, and returns the accepted ones.
 */
export function judgeSeams(
	candidates: SeamCandidate[],
	material: SeamMaterial,
	duration: number
): Movement[] {
	const { bars, sim, chroma } = material;
	const n = bars.count;
	if (n < 2 * WINDOW + 2) return [];
	const simChroma = centredChromaSimilarity(bars);
	const barAt = (t: number) => {
		let b = 0;
		while (b < n - 1 && bars.time[b + 1] <= t) b++;
		return b;
	};
	const body: [number, number] = [barAt(EDGE_S), barAt(duration - EDGE_S)];

	const accepted: (Movement & { strength: number; hard: boolean })[] = [];
	const exactOf = (c: SeamCandidate) => c.exact === true || c.downbeatGap !== undefined || c.reset;
	for (const c of candidates) {
		if (c.t < START_EDGE_S || c.t > duration - EDGE_S) continue;
		const s = barAt(c.t);
		// The witnesses read the music either side of a written zone, not the zone: bars of
		// silence resemble nothing, and counted as the incoming song they made every pause
		// look like new material. Whether the zone is quiet says nothing - a real switch in
		// hip-hop carries the hook a cappella through it, Jesus of Suburbia a drum fill - so
		// no rule reads its level.
		let leftEnd = s;
		let rightStart = s;
		if (c.zone) {
			leftEnd = barAt(c.zone.from);
			rightStart = barAt(c.zone.to);
			if (bars.time[rightStart] < c.zone.to - 0.25 && rightStart < n - 1) rightStart++;
		}
		const pauseSeconds = c.pause ?? 0;
		const timbre = recurrence(sim, n, leftEnd, body[0], body[1], rightStart);
		const harmony = recurrence(simChroma, n, leftEnd, body[0], body[1], rightStart);
		if (!timbre || !harmony) continue;
		c.timbreRatio = timbre.within > 0 ? timbre.cross / timbre.within : 1;
		c.chromaRatio = (harmony.cross + 1) / (harmony.within + 1);
		// An interlude is a fact of the beat stream: twenty seconds with no count between two
		// songs that have one. Both its edges are movements, unless the song after it is the
		// song before it, which makes the passage a breakdown.
		if (c.interlude) {
			if (c.chromaRatio >= BREAKDOWN_CHROMA || c.timbreRatio >= BREAKDOWN_TIMBRE) continue;
			accepted.push({
				t: c.t,
				source: 'auto',
				note: c.interlude.edge === 'start' ? `the beat stops for ${c.interlude.seconds.toFixed(0)} s` : `a beat returns after ${c.interlude.seconds.toFixed(0)} s without one`,
				exact: true,
				strength: 3,
				hard: true
			});
			continue;
		}
		const left = estimateKeySpan(chroma, Math.max(bars.time[body[0]], c.t - KEY_REACH), c.t);
		const right = estimateKeySpan(chroma, c.t, Math.min(bars.time[Math.min(n, body[1])], c.t + KEY_REACH));
		c.keyDist = keyDistance(left, right);
		c.keyConf = Math.min(left.confidence, right.confidence);
		c.keyLeft = left.name;
		c.keyRight = right.name;
		c.leftSeconds = bars.time[s] - bars.time[body[0]];
		c.rightSeconds = bars.time[Math.min(n, body[1])] - bars.time[s];
		if (c.leftSeconds < MIN_SONG_S || c.rightSeconds < MIN_SONG_S) continue;

		let note: string | null = null;
		let strength = 0;
		const keys = `${left.name} to ${right.name}`;
		if (c.tempo) {
			const pauseBeats = c.tempo.pause;
			const moved = c.tempo.step >= TEMPO_STEP || pauseBeats >= TEMPO_PAUSE;
			// A tempo step across a pause back into the same material is a breakdown's edge.
			if (pauseSeconds >= SAME_TEMPO_PAUSE_S && c.chromaRatio >= BREAKDOWN_CHROMA && c.timbreRatio >= BREAKDOWN_TIMBRE) continue;
			const triplet = TRIPLET_RATIOS.some((m) => Math.abs(c.tempo!.ratio / m - 1) < 0.03);
			const supported =
				c.chromaRatio <= TRIPLET_MATERIAL ||
				c.timbreRatio <= TRIPLET_MATERIAL ||
				(c.keyDist >= SAME_TEMPO_KEY && c.keyConf >= SAME_TEMPO_KEY_CONF);
			if (moved && (!triplet || supported)) {
				note = `tempo ${c.tempo.from.toFixed(0)} to ${c.tempo.to.toFixed(0)}${pauseBeats >= TEMPO_PAUSE ? ' after a pause' : ''}, ${keys}`;
				strength = 2 + c.tempo.step + Math.min(1, pauseBeats / 8) + (1 - c.chromaRatio);
			}
		} else {
			const longEnough = c.leftSeconds >= SAME_TEMPO_LEFT_S && c.rightSeconds >= SAME_TEMPO_RIGHT_S;
			const paused = pauseSeconds >= SAME_TEMPO_PAUSE_S;
			// A long pause relaxes the material bar (Nights' second half reads 0.90 on timbre),
			// but a beat returning into the same sound at the breakdown standard is a breakdown:
			// "i'm waiting." rests for 16 s and comes back at 1.39, in the same key.
			const newMaterial =
				pauseSeconds >= LONG_PAUSE_S
					? c.chromaRatio <= LONG_PAUSE_CHROMA && c.timbreRatio < BREAKDOWN_TIMBRE
					: c.chromaRatio <= MATERIAL_CHROMA && c.timbreRatio <= MATERIAL_TIMBRE;
			const keyed = c.keyDist >= SAME_TEMPO_KEY && c.keyConf >= SAME_TEMPO_KEY_CONF;
			// The count broke: the walk restarted (its judgement over bars, at a cost of four)
			// or the beat stopped. One odd bar's downbeat gap is not that - a single song
			// modulating on an odd bar (Earthquake, C minor to A major) read as a new song on
			// a gap of two alone.
			const broke = c.reset || paused;
			if (longEnough && newMaterial && broke && (paused || keyed)) {
				note = paused ? `a new beat after ${pauseSeconds.toFixed(0)} s of none, ${keys}` : `the count restarts, ${keys}`;
				strength = 1 + (MATERIAL_CHROMA - c.chromaRatio) + (paused ? 0.5 : 0) + c.keyDist / 12;
			}
		}
		if (note === null) continue;
		const hard = !!c.tempo || pauseSeconds >= LONG_PAUSE_S;
		const near = accepted.find((m) => Math.abs(m.t - c.t) < (hard && m.hard ? HARD_SEAM_GAP_S : SOFT_SEAM_GAP_S));
		if (near) {
			if (strength > near.strength) Object.assign(near, { t: c.t, note, strength, hard, exact: exactOf(c) });
			continue;
		}
		accepted.push({ t: c.t, source: 'auto', note, strength, hard, exact: exactOf(c) });
	}
	return accepted.sort((a, b) => a.t - b.t).map(({ t, source, note, exact }) => ({ t, source, note, exact }));
}
