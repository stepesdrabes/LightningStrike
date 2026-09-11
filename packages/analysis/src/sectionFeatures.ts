import { NUM_BANDS } from '@mv/core';
import { quantile } from './dsp/stats.ts';

/**
 * Shared feature order for analysis and fitting; changing order silently changes the model.
 * Normalise within track so kit fullness is relative to the recording.
 */

/** The order the weights are indexed by. Appending is safe; reordering invalidates the model. */
export const SECTION_FEATURES = [
	'energy',
	'energyPeak',
	'energyFloor',
	'sub',
	'low',
	'mid',
	'air',
	'kick',
	'snare',
	'kit',
	'dEnergyPrev',
	'dSubPrev',
	'dKickPrev',
	'dSnarePrev',
	'dKitPrev',
	'dEnergyNext',
	'dSubNext',
	'dKickNext',
	'dSnareNext',
	'dKitNext',
	'startFrac',
	'endFrac',
	'lengthBars',
	'lengthFrac',
	'rankFrac',
	'isRepeat',
	'groupSize',
	'occurrence',
	'isFirst',
	'isLast',
	'energyVsBody',
	'kickVsBody'
] as const;

export const SECTION_FEATURE_COUNT = SECTION_FEATURES.length;

interface FeatureSpan {
	startBar: number;
	endBar: number;
	/** Which material this is; sections sharing an id are the same passage. */
	group: number;
}

interface SectionFeatureInput {
	/** Per bar, 0..1 across the track. */
	energy: Float32Array;
	/** barCount * NUM_BANDS, each band 0..1 across the track. */
	bands: Float32Array;
	kicks: Int32Array;
	snares: Int32Array;
	segments: readonly FeatureSpan[];
	barCount: number;
}

interface Stat {
	energy: number;
	peak: number;
	floor: number;
	band: number[];
	kick: number;
	snare: number;
	kit: number;
}

/** One row per segment, in `SECTION_FEATURES` order. */
export function sectionFeatures(input: SectionFeatureInput): number[][] {
	const { energy, bands, kicks, snares, segments, barCount } = input;
	if (segments.length === 0) return [];

	// The track's own busiest bars, so density is read against what this kit actually does.
	const kickRef = Math.max(1e-6, quantile(kicks, 0.9));
	const snareRef = Math.max(1e-6, quantile(snares, 0.9));

	const stats: Stat[] = segments.map((s) => {
		const hi = Math.min(s.endBar, barCount);
		const n = Math.max(1, hi - s.startBar);
		let e = 0;
		let peak = 0;
		let floor = Infinity;
		const band = new Array(NUM_BANDS).fill(0);
		let kick = 0;
		let snare = 0;
		let played = 0;
		for (let b = s.startBar; b < hi; b++) {
			e += energy[b];
			if (energy[b] > peak) peak = energy[b];
			if (energy[b] < floor) floor = energy[b];
			for (let k = 0; k < NUM_BANDS; k++) band[k] += bands[b * NUM_BANDS + k];
			kick += kicks[b];
			snare += snares[b];
			if (kicks[b] > 0 || snares[b] > 0) played++;
		}
		return {
			energy: e / n,
			peak,
			floor: Number.isFinite(floor) ? floor : 0,
			band: band.map((v) => v / n),
			kick: kick / n / kickRef,
			snare: snare / n / snareRef,
			kit: played / n
		};
	});

	const bodyEnergy = quantile(
		stats.map((s) => s.energy),
		0.5
	);
	const bodyKick = quantile(
		stats.map((s) => s.kick),
		0.5
	);

	const rank = new Array(segments.length).fill(0);
	[...stats.keys()]
		.sort((a, b) => stats[b].energy - stats[a].energy)
		.forEach((idx, r) => (rank[idx] = r));

	const groupCount = new Map<number, number>();
	for (const s of segments) groupCount.set(s.group, (groupCount.get(s.group) ?? 0) + 1);
	const seen = new Map<number, number>();

	return segments.map((s, i) => {
		const cur = stats[i];
		const prev = stats[i - 1] ?? cur;
		const next = stats[i + 1] ?? cur;
		const occurrence = (seen.get(s.group) ?? 0) + 1;
		seen.set(s.group, occurrence);

		return [
			cur.energy,
			cur.peak,
			cur.floor,
			cur.band[0],
			cur.band[1],
			cur.band[2],
			cur.band[3],
			cur.kick,
			cur.snare,
			cur.kit,
			cur.energy - prev.energy,
			cur.band[0] - prev.band[0],
			cur.kick - prev.kick,
			cur.snare - prev.snare,
			cur.kit - prev.kit,
			next.energy - cur.energy,
			next.band[0] - cur.band[0],
			next.kick - cur.kick,
			next.snare - cur.snare,
			next.kit - cur.kit,
			s.startBar / barCount,
			Math.min(s.endBar, barCount) / barCount,
			// Capped, because a 200-bar segment is a segmentation failure rather than a very long
			// section, and letting it run away moves every coefficient to accommodate it.
			Math.min(64, s.endBar - s.startBar) / 64,
			(s.endBar - s.startBar) / barCount,
			rank[i] / Math.max(1, segments.length - 1),
			occurrence > 1 ? 1 : 0,
			(groupCount.get(s.group) ?? 1) / segments.length,
			Math.min(4, occurrence) / 4,
			i === 0 ? 1 : 0,
			i === segments.length - 1 ? 1 : 0,
			cur.energy - bodyEnergy,
			cur.kick - bodyKick
		];
	});
}
