import type { TrackAnalysis } from './contracts/analysis.ts';

/** Route unreliable grids to lounge, which follows the spectrum without trusting cue timing. */
export interface GridTrust {
	trusted: boolean;
	/** Human-readable, shown on the queue row and in the inspector. Empty when trusted. */
	reasons: string[];
}

/**
 * Fragmentation is the primary signal; low meter confidence and 2/4 only tighten its threshold.
 * The 113-track calibration separated clean arrangements below 5.5 sections/minute from broken
 * grids above it. Do not normalize by BPM: the wrong metrical level also corrupts that value.
 */
const FRAGMENTED = 5.4;
const SUSPECT = 4.5;
const SHAKY_METER = 0.55;
/** Require ten sections so short edits are not penalized by a high per-minute rate. */
const MIN_SECTIONS = 10;
/** A close published BPM at the same metrical level corroborates a busy arrangement. */
const CORROBORATED_BPM = 0.035;

export function gridTrust(analysis: TrackAnalysis, publishedBpm?: number | null): GridTrust {
	const minutes = analysis.duration / 60;
	// Use the pre-consolidation count so merging cannot hide a fragmented grid.
	const sectionCount = analysis.rawSectionCount ?? analysis.sections.length;
	// Short tracks do not provide enough evidence of fragmentation.
	if (minutes < 1 || sectionCount < MIN_SECTIONS) {
		return { trusted: true, reasons: [] };
	}

	const perMinute = sectionCount / minutes;
	const meter = analysis.tempo.meterConfidence;
	const halfBars = analysis.tempo.beatsPerBar === 2;
	const corroborated =
		typeof publishedBpm === 'number' &&
		publishedBpm > 0 &&
		Math.abs(analysis.tempo.bpm - publishedBpm) / publishedBpm <= CORROBORATED_BPM;

	const reasons: string[] = [];
	if (perMinute > FRAGMENTED && !(corroborated && !halfBars)) {
		reasons.push(`${perMinute.toFixed(1)} sections a minute`);
	} else if (perMinute > SUSPECT && !corroborated && (meter <= SHAKY_METER || halfBars)) {
		reasons.push(
			`${perMinute.toFixed(1)} sections a minute on ${
				halfBars ? 'a 2/4 grid' : `meter confidence ${meter.toFixed(2)}`
			}`
		);
	}
	if (reasons.length > 0 && halfBars) reasons.push('read in 2/4, which this repertoire almost never is');

	return { trusted: reasons.length === 0, reasons };
}
