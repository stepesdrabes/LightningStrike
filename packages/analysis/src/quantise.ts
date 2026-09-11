import type { OnsetStream } from '@mv/core';
import type { DrumStream } from './drums.ts';

/**
 * Pattern correction follows Yoshii et al. (ICASSP 2006): patterns propose additions/removals;
 * audio verifies every candidate so fills and breaks survive. Detected hits keep their times.
 * Missing-hit slots use actual beat times, not an averaged period that drifts on live music.
 */
interface QuantiseOptions {
	beats: Float64Array;
	beatsPerBar: number;
	/** Which beat index mod beatsPerBar starts a bar, so invented hits land in real bars. */
	downbeatPhase?: number;
	/** Subdivisions per beat. Four resolves a sixteenth, which is as fine as a kit is placed. */
	perBeat?: number;
	/** Fraction of a subdivision an onset may sit from the grid and still be called on it. */
	tolerance?: number;
	/** Repeat identity per bar; negative or absent ids use a fixed-window fallback. */
	barGroup?: Int32Array;
	/** Bars considered together when there is no repeat identity to use instead. */
	windowBars?: number;
	/** Track length. Completing a pattern must not invent hits past the end of the audio. */
	duration: number;
}

interface QuantisedOnsets extends OnsetStream {
	/** True where the hit was completed from the pattern rather than detected. */
	invented: boolean[];
}

/**
 * Pattern claims need group support; promotion also needs audible local energy. A nonzero
 * floor prevents completing a pattern across a deliberate gap.
 */
const PATTERN_SUPPORT = 0.45;
const PROMOTE_EVIDENCE = 0.12;
/** Remove only weak, unexpected detections; strong unpatterned hits may be genuine fills. */
const DEMOTE_SUPPORT = 0.12;
const DEMOTE_LEVEL = 0.22;
/** What an invented hit is worth, as a fraction of the support that asked for it. */
const INVENTED_LEVEL = 0.55;

/** Time of subdivision `slot`, interpolated inside the real beat it falls in. */
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

interface Hit {
	time: number;
	level: number;
	invented: boolean;
}

export function quantiseOnsets(stream: DrumStream, opts: QuantiseOptions): QuantisedOnsets {
	const { beats, beatsPerBar } = opts;
	const perBeat = opts.perBeat ?? 4;
	const tolerance = opts.tolerance ?? 0.5;
	const windowBars = opts.windowBars ?? 8;
	const downbeatPhase = opts.downbeatPhase ?? 0;
	const { times, levels, curve, fps } = stream;

	const empty = (): QuantisedOnsets => ({
		times: [...times],
		levels: [...levels],
		invented: times.map(() => false)
	});
	if (beats.length < 2 || times.length === 0) return empty();

	const slotsPerBar = beatsPerBar * perBeat;
	// Slot 0 is the first downbeat, so a bar of slots is a real bar and a pattern read off it
	// is the pattern the drummer played rather than one rotated by a beat or two.
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

	// Each detection is assigned to a slot for the pattern vote, and its own time is kept.
	const detected = new Map<number, Hit>();
	const unquantised: Hit[] = [];
	for (let i = 0; i < times.length; i++) {
		const t = times[i];
		const hit: Hit = { time: t, level: levels[i] ?? 1, invented: false };
		const slot = slotOf(t);
		const span = Math.max(1e-6, slotTime(slot + 1) - slotTime(slot));
		// Genuinely unquantised, or a detector artefact. Either way it is not part of a pattern,
		// so it does not vote and the pattern cannot remove it; it is still reported, because it
		// was heard.
		if (slot < 0 || slot >= totalSlots || Math.abs(t - slotTime(slot)) > span * tolerance) {
			unquantised.push(hit);
			continue;
		}
		const prev = detected.get(slot);
		if (prev === undefined || Math.abs(t - slotTime(slot)) < Math.abs(prev.time - slotTime(slot))) {
			detected.set(slot, hit);
		}
	}

	const bars = Math.ceil(totalSlots / slotsPerBar);
	const barActive = new Uint8Array(bars);
	for (const slot of detected.keys()) {
		const bar = Math.floor(slot / slotsPerBar);
		if (bar >= 0 && bar < bars) barActive[bar] = 1;
	}

	// Pool repeating bars instead of mixing different groove patterns within a fixed window.
	const cohorts = new Map<number, number[]>();
	for (let bar = 0; bar < bars; bar++) {
		if (!barActive[bar]) continue;
		const id = opts.barGroup && opts.barGroup[bar] >= 0 ? opts.barGroup[bar] : -1 - Math.floor(bar / windowBars);
		const list = cohorts.get(id);
		if (list) list.push(bar);
		else cohorts.set(id, [bar]);
	}

	/** Loudest thing the curve shows within half a slot of a time, 0..1. */
	const evidenceAt = (t: number, span: number): number => {
		const radius = Math.max(1, Math.round(span * 0.5 * fps));
		const centre = Math.round(t * fps);
		let best = 0;
		for (let i = Math.max(0, centre - radius); i <= Math.min(curve.length - 1, centre + radius); i++) {
			if (curve[i] > best) best = curve[i];
		}
		return best;
	};

	const out = new Map<number, Hit>(detected);
	for (const members of cohorts.values()) {
		if (members.length < 2) continue;

		// Confidence-weighted, so one certain hit outvotes two marginal ones rather than three
		// detections of unknown quality being counted as three.
		const support = new Float64Array(slotsPerBar);
		for (const bar of members) {
			for (let k = 0; k < slotsPerBar; k++) {
				support[k] += detected.get(bar * slotsPerBar + k)?.level ?? 0;
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
				const slot = bar * slotsPerBar + k;
				if (slot >= totalSlots) continue;
				const t = slotTime(slot);
				const span = Math.max(1e-6, slotTime(slot + 1) - t);
				const here = detected.get(slot);

				if (here) {
					// Demote: the passage does not play this slot and the detection barely cleared
					// the floor. Removing it is the half of the correction that never existed.
					if (share < DEMOTE_SUPPORT && here.level < DEMOTE_LEVEL) out.delete(slot);
					continue;
				}
				if (share < PATTERN_SUPPORT) continue;
				const evidence = evidenceAt(t, span);
				if (evidence < PROMOTE_EVIDENCE) continue;
				// Promote, at the confidence that asked for it rather than at full strength: a
				// completed hit is an inference, and the room should not be told otherwise.
				out.set(slot, { time: t, level: support[k] * INVENTED_LEVEL, invented: true });
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
		invented: hits.map((h) => h.invented)
	};
}

/** Repeat identity per bar, from the segmenter's bounds and groups. */
export function barGroups(
	bounds: readonly number[],
	group: readonly number[],
	barCount: number
): Int32Array {
	const out = new Int32Array(barCount).fill(-1);
	for (let i = 0; i + 1 < bounds.length; i++) {
		const id = group[i] ?? -1;
		for (let b = bounds[i]; b < Math.min(bounds[i + 1], barCount); b++) out[b] = id;
	}
	return out;
}
