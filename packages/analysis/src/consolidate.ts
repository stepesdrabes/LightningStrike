import { PHRASE_BARS } from '@mv/core';
import type { Segment } from './arrange.ts';

/** Local comparison radius, bars, matching the DP's banded window. */
const SEAM_BAND = 7;
/** Require near-self cohesion plus an absolute floor so internally loose material cannot merge freely. */
const SAME_MATERIAL = 0.92;
const SAME_MATERIAL_FLOOR = 0.62;

/**
 * Merge same-kind seams only when nearby arrivals are weak and cross-seam material matches.
 * The arrival window includes adjacent bars so an early boundary remains available for repair.
 * Protect pins/hooks, peak segments, void edges, and non-phrase-aligned seams. No length cap:
 * the engine subdivides long sections without adding false arrivals. Mutates the final table;
 * returns removed bars. Re-place events afterward and give trust the pre-merge section count.
 */
export function consolidateSections(
	segments: Segment[],
	arrivals: Float32Array,
	sim: Float32Array,
	barCount: number,
	floor: number,
	energy: Float32Array,
	keep: ReadonlySet<number> = new Set()
): number[] {
	const merged: number[] = [];
	if (floor <= 0 || segments.length < 2) return merged;

	// The loudest segment of the INPUT table: untouchable, because the peak is chosen by
	// mean energy and opened at startBar, and both must survive this pass unchanged.
	let peak = 0;
	let peakMean = -Infinity;
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		let acc = 0;
		for (let b = s.startBar; b < Math.min(s.endBar, energy.length); b++) acc += energy[b];
		const mean = acc / Math.max(1, Math.min(s.endBar, energy.length) - s.startBar);
		if (mean > peakMean) {
			peakMean = mean;
			peak = i;
		}
	}
	const peakSeg = segments[peak];

	// Group identity of a merged run is the PLURALITY of its constituent bars, not the
	// winner of the last pairwise step: A(8)+B(12)+C(16) is C's span, whatever order the
	// walk met them in.
	const tally = new Map<number, number>();

	for (let i = 1; i < segments.length; ) {
		const prev = segments[i - 1];
		const here = segments[i];
		const seam = here.startBar;
		const arrivalNear = Math.max(
			arrivals[seam - 1] ?? 0,
			arrivals[seam] ?? 0,
			arrivals[seam + 1] ?? 0
		);
		const mergeable =
			prev.kind === here.kind &&
			prev.kind !== 'void' &&
			prev !== peakSeg &&
			here !== peakSeg &&
			!keep.has(seam) &&
			(seam - prev.startBar) % PHRASE_BARS === 0 &&
			arrivalNear < floor &&
			sameMaterialAcross(sim, barCount, prev.startBar, seam, here.endBar);
		if (!mergeable) {
			tally.clear();
			i++;
			continue;
		}
		if (tally.size === 0 && prev.group >= 0) {
			tally.set(prev.group, prev.endBar - prev.startBar);
		}
		if (here.group >= 0) {
			tally.set(here.group, (tally.get(here.group) ?? 0) + here.endBar - here.startBar);
		}
		let bestGroup = prev.group;
		let bestBars = -1;
		for (const [group, bars] of tally) {
			if (bars > bestBars) {
				bestBars = bars;
				bestGroup = group;
			}
		}
		prev.group = bestGroup;
		prev.endBar = here.endBar;
		segments.splice(i, 1);
		merged.push(seam);
	}
	return merged;
}

/** Banded mean similarity over pairs inside [from, to), the DP's own cohesion reading. */
function bandedCohesion(sim: Float32Array, n: number, from: number, to: number): number {
	let acc = 0;
	let pairs = 0;
	for (let i = from; i < to; i++) {
		const hi = Math.min(to, i + SEAM_BAND + 1);
		for (let j = i + 1; j < hi; j++) {
			acc += sim[i * n + j];
			pairs++;
		}
	}
	// No internal pairs means a one-bar side, whose only reading is the diagonal's 1.
	return pairs > 0 ? acc / pairs : 1;
}

/** Compare cross-seam similarity with nearby within-side cohesion. */
function sameMaterialAcross(
	sim: Float32Array,
	n: number,
	prevStart: number,
	seam: number,
	nextEnd: number
): boolean {
	const from = Math.max(prevStart, seam - SEAM_BAND);
	const to = Math.min(nextEnd, seam + SEAM_BAND, n);
	if (seam <= from || to <= seam) return false;
	let acc = 0;
	let pairs = 0;
	for (let i = from; i < seam; i++) {
		const hi = Math.min(to, i + SEAM_BAND + 1);
		for (let j = seam; j < hi; j++) {
			acc += sim[i * n + j];
			pairs++;
		}
	}
	if (pairs === 0) return false;
	const cross = acc / pairs;
	const self = (bandedCohesion(sim, n, from, seam) + bandedCohesion(sim, n, seam, to)) / 2;
	return cross >= Math.max(SAME_MATERIAL_FLOOR, self * SAME_MATERIAL);
}
