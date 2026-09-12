// Local copy of packages/analysis/src/quantise.ts quantiseOnsets with its constants exposed,
// so an experiment can sweep pattern completion without touching the shipped source. With
// SHIPPED it must reproduce quantiseOnsets bit for bit (exp-completion.ts asserts this).
import type { DrumStream } from '../../packages/analysis/src/drums.ts';
import { refinePeakTime } from '../../packages/analysis/src/onsets.ts';

export interface VariantOptions {
	beats: Float64Array;
	beatsPerBar: number;
	downbeatPhase?: number;
	perBeat?: number;
	tolerance?: number;
	barGroup?: Int32Array;
	barTimes?: Float64Array;
	windowBars?: number;
	duration: number;
}

export interface VariantParams {
	promote: boolean;
	demote: boolean;
	patternSupport: number;
	promoteEvidence: number;
	/** Bars a cohort needs before it votes; shipped is 2. */
	minCohort: number;
	inventedLevel: number;
	/** Inventions whose scaled level falls below this are dropped; 0 keeps every one. */
	inventedFloor: number;
	demoteSupport: number;
	demoteLevel: number;
	/** 'segmenter' uses barGroup as shipped; 'fixed' pools windowBars consecutive bars. */
	cohort: 'segmenter' | 'fixed';
	windowBars: number;
	/** Absolute mean level a slot needs across the cohort before it can promote; shipped 0. */
	minSupport: number;
	/** Fraction of cohort bars that must have a detection in the slot before it promotes; 0 off. */
	minCount: number;
	/** Cohort strongest-slot support below which nothing is demoted; 0 off. */
	demoteStrongest: number;
	/** Cohort strongest-slot support below which nothing is promoted; 0 off. */
	minStrongest: number;
}

export const SHIPPED: VariantParams = {
	promote: true, demote: true, patternSupport: 0.45, promoteEvidence: 0.12, minCohort: 2,
	inventedLevel: 0.55, inventedFloor: 0, demoteSupport: 0.12, demoteLevel: 0.22,
	cohort: 'segmenter', windowBars: 8, minSupport: 0, minCount: 0, demoteStrongest: 0, minStrongest: 0
};

export interface Decision {
	time: number;
	level: number;
	support: number;
	strongest: number;
	share: number;
	/** Fraction of cohort bars with a detection in this slot. */
	count: number;
	members: number;
	evidence: number;
}

export interface VariantResult {
	times: number[];
	levels: number[];
	invented: boolean[];
	/** Times of detected hits the pattern removed. */
	demoted: number[];
	/** Inventions dropped by inventedFloor, for accounting. */
	floored: number[];
	inventedInfo: Decision[];
	demotedInfo: Decision[];
}

interface Hit {
	time: number;
	level: number;
	invented: boolean;
}

function slotTimeOf(beats: Float64Array, perBeat: number, slot: number): number {
	const beat = Math.floor(slot / perBeat);
	const frac = (slot - beat * perBeat) / perBeat;
	const last = beats.length - 1;
	if (beat >= last) {
		const span = last >= 1 ? beats[last] - beats[last - 1] : 0.5;
		return beats[last] + (beat - last + frac) * span;
	}
	if (beat < 0) {
		const span = last >= 1 ? beats[1] - beats[0] : 0.5;
		return beats[0] + (beat + frac) * span;
	}
	return beats[beat] + (beats[beat + 1] - beats[beat]) * frac;
}

export function quantiseVariant(stream: DrumStream, opts: VariantOptions, p: VariantParams = SHIPPED): VariantResult {
	const { beats, beatsPerBar } = opts;
	const perBeat = opts.perBeat ?? 4;
	const tolerance = opts.tolerance ?? 0.5;
	const windowBars = p.cohort === 'fixed' ? p.windowBars : (opts.windowBars ?? 8);
	const downbeatPhase = opts.downbeatPhase ?? 0;
	const { times, levels, curve, fps } = stream;

	const empty = (): VariantResult => ({
		times: [...times],
		levels: [...levels],
		invented: times.map(() => false),
		demoted: [],
		floored: [],
		inventedInfo: [],
		demotedInfo: []
	});
	if (beats.length < 2 || times.length === 0) return empty();

	const slotsPerBar = beatsPerBar * perBeat;
	const firstSlot = downbeatPhase * perBeat;
	const totalSlots = Math.max(0, (beats.length - 1 - downbeatPhase) * perBeat + slotsPerBar);
	if (totalSlots <= 0) return empty();

	const slotTime = (slot: number) => slotTimeOf(beats, perBeat, firstSlot + slot);
	const slotOf = (t: number): number => {
		let lo = 0;
		let hi = totalSlots - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (slotTime(mid) <= t) lo = mid;
			else hi = mid;
		}
		return Math.abs(slotTime(lo) - t) <= Math.abs(slotTime(hi) - t) ? lo : hi;
	};

	const detected = new Map<number, Hit>();
	const unquantised: Hit[] = [];
	for (let i = 0; i < times.length; i++) {
		const t = times[i];
		const hit: Hit = { time: t, level: levels[i] ?? 1, invented: false };
		const slot = slotOf(t);
		const span = Math.max(1e-6, slotTime(slot + 1) - slotTime(slot));
		if (slot < 0 || slot >= totalSlots || Math.abs(t - slotTime(slot)) > span * tolerance) {
			unquantised.push(hit);
			continue;
		}
		const prev = detected.get(slot);
		if (prev === undefined) {
			detected.set(slot, hit);
		} else if (hit.level > prev.level) {
			unquantised.push(prev);
			detected.set(slot, hit);
		} else {
			unquantised.push(hit);
		}
	}

	const starts: number[] = [];
	if (opts.barTimes && opts.barTimes.length >= 2) {
		let beat = 0;
		for (const time of opts.barTimes) {
			while (beat + 1 < beats.length && Math.abs(beats[beat + 1] - time) < Math.abs(beats[beat] - time)) beat++;
			starts.push(beat * perBeat - firstSlot);
		}
	} else {
		const count = Math.ceil(totalSlots / slotsPerBar);
		for (let bar = 0; bar <= count; bar++) starts.push(bar * slotsPerBar);
	}
	const bars = starts.length - 1;
	const barActive = new Uint8Array(bars);
	let barIndex = 0;
	for (const slot of detected.keys()) {
		while (barIndex + 1 < starts.length && slot >= starts[barIndex + 1]) barIndex++;
		if (barIndex < bars && slot >= starts[barIndex]) barActive[barIndex] = 1;
	}

	const cohorts = new Map<number, number[]>();
	for (let bar = 0; bar < bars; bar++) {
		if (!barActive[bar] || starts[bar + 1] - starts[bar] !== slotsPerBar) continue;
		const grouped = p.cohort === 'segmenter' && opts.barGroup && opts.barGroup[bar] >= 0;
		const id = grouped ? opts.barGroup![bar] : -1 - Math.floor(bar / windowBars);
		const list = cohorts.get(id);
		if (list) list.push(bar);
		else cohorts.set(id, [bar]);
	}

	const evidenceAt = (t: number, span: number): { time: number; level: number } | null => {
		const radius = Math.max(1, Math.round(span * 0.5 * fps));
		const centre = Math.round(t * fps);
		let best = -1;
		for (let i = Math.max(1, centre - radius); i <= Math.min(curve.length - 2, centre + radius); i++) {
			if (curve[i] < p.promoteEvidence || curve[i] <= curve[i - 1] || curve[i] < curve[i + 1]) continue;
			const time = refinePeakTime(curve, i, fps);
			if (Math.abs(time - t) > span * 0.5 || slotOf(time) !== slotOf(t)) continue;
			if (best < 0 || curve[i] > curve[best]) best = i;
		}
		return best < 0 ? null : {
			time: refinePeakTime(curve, best, fps),
			level: (stream.levelCurve ?? curve)[best]
		};
	};

	const out = new Map<number, Hit>(detected);
	const demoted: number[] = [];
	const floored: number[] = [];
	const inventedInfo: Decision[] = [];
	const demotedInfo: Decision[] = [];
	for (const members of cohorts.values()) {
		if (members.length < p.minCohort) continue;

		const support = new Float64Array(slotsPerBar);
		const count = new Float64Array(slotsPerBar);
		for (const bar of members) {
			for (let k = 0; k < slotsPerBar; k++) {
				const hit = detected.get(starts[bar] + k);
				support[k] += hit?.level ?? 0;
				if (hit) count[k] += 1 / members.length;
			}
		}
		let strongest = 0;
		for (let k = 0; k < slotsPerBar; k++) {
			support[k] /= members.length;
			if (support[k] > strongest) strongest = support[k];
		}
		if (!(strongest > 0)) continue;

		for (let k = 0; k < slotsPerBar; k++) {
			const share = support[k] / strongest;
			for (const bar of members) {
				const slot = starts[bar] + k;
				if (slot >= totalSlots) continue;
				const t = slotTime(slot);
				const span = Math.max(1e-6, slotTime(slot + 1) - t);
				const here = detected.get(slot);

				const info = (time: number, level: number, evidence: number): Decision => ({
					time, level, support: support[k], strongest, share, count: count[k], members: members.length, evidence
				});
				if (here) {
					if (p.demote && strongest >= p.demoteStrongest && share < p.demoteSupport && here.level < p.demoteLevel
						&& out.delete(slot)) {
						demoted.push(here.time);
						demotedInfo.push(info(here.time, here.level, 0));
					}
					continue;
				}
				if (!p.promote || share < p.patternSupport || strongest < p.minStrongest) continue;
				if (support[k] < p.minSupport || count[k] < p.minCount) continue;
				const evidence = evidenceAt(t, span);
				if (!evidence) continue;
				const level = Math.min(support[k], evidence.level) * p.inventedLevel;
				if (level < p.inventedFloor) {
					floored.push(evidence.time);
					continue;
				}
				out.set(slot, { time: evidence.time, level, invented: true });
				inventedInfo.push(info(evidence.time, level, evidence.level));
			}
		}
	}

	const hits = [...out.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([, hit]) => hit)
		.concat(unquantised)
		.filter((h) => h.time >= 0 && h.time <= opts.duration)
		.sort((a, b) => a.time - b.time);

	return {
		times: hits.map((h) => h.time),
		levels: hits.map((h) => h.level),
		invented: hits.map((h) => h.invented),
		demoted,
		floored,
		inventedInfo,
		demotedInfo
	};
}
