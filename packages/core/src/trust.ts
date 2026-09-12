import type { TrackAnalysis } from './contracts/analysis.ts';

/** Route unreliable grids to lounge, which follows the spectrum without trusting cue timing. */
export interface GridTrust {
	trusted: boolean;
	/** Human-readable, shown on the queue row and in the inspector. Empty when trusted. */
	reasons: string[];
}

/** Fragmentation is a warning when neither published tempo nor raw model timing corroborates the grid. */
const FRAGMENTED = 5.4;
const SUSPECT = 4.5;
const SHAKY_METER = 0.55;
/** Require ten sections so short edits are not penalized by a high per-minute rate. */
const MIN_SECTIONS = 10;
/** A close published BPM at the same metrical level corroborates a busy arrangement. */
const CORROBORATED_BPM = 0.035;

/** Repaired bar lines alone cannot prove themselves; require the unrepaired model's evidence. */
function modelCorroborates(analysis: TrackAnalysis): boolean {
	const { tempo, heard } = analysis;
	if (
		tempo.beatsPerBar !== 4 || !(tempo.meterConfidence >= 0.9) ||
		!(tempo.confidence >= 0.6) || tempo.ambiguous !== false ||
		!heard || heard.downbeats.length < 17 || heard.beats.length < 65 ||
		!tempo.barTimes?.length || !(tempo.beatPeriod > 0)
	) return false;
	const first = heard.downbeats[0];
	const last = heard.downbeats[heard.downbeats.length - 1];
	if (last - first < analysis.duration * 0.5) return false;

	const tolerance = Math.min(0.08, tempo.beatPeriod * 0.2);
	let beat = 0;
	let bar = 0;
	let previous = -1;
	let regular = 0;
	let aligned = 0;
	for (const t of heard.downbeats) {
		if (!Number.isFinite(t)) return false;
		while (beat + 1 < heard.beats.length &&
			Math.abs(heard.beats[beat + 1] - t) < Math.abs(heard.beats[beat] - t)) beat++;
		if (Math.abs(heard.beats[beat] - t) > tolerance) return false;
		if (previous >= 0 && beat - previous === 4) regular++;
		previous = beat;
		while (bar + 1 < tempo.barTimes.length &&
			Math.abs(tempo.barTimes[bar + 1] - t) < Math.abs(tempo.barTimes[bar] - t)) bar++;
		if (Math.abs(tempo.barTimes[bar] - t) <= tolerance) aligned++;
	}
	return regular / (heard.downbeats.length - 1) >= 0.85 &&
		aligned / heard.downbeats.length >= 0.9;
}

export function gridTrust(analysis: TrackAnalysis, publishedBpm?: number | null): GridTrust {
	if (analysis.level?.silent === true) {
		return { trusted: false, reasons: ['no signal in analysed audio'] };
	}
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
	const publishedAgrees =
		typeof publishedBpm === 'number' &&
		publishedBpm > 0 &&
		Math.abs(analysis.tempo.bpm - publishedBpm) / publishedBpm <= CORROBORATED_BPM;
	const corroborated = publishedAgrees || modelCorroborates(analysis);

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
