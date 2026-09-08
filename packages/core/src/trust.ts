import type { TrackAnalysis } from './contracts/analysis.ts';

/**
 * Whether the analysed grid deserves an authored show, and why not when it does not.
 *
 * Some tracks defeat the analyser - a wrong metrical level reads a pop song in 2/4, every
 * downstream judgement inherits the broken grid, and the show comes out as thirty-five cues
 * over twenty-three sections, changing looks every six seconds. That show is worse than no
 * show: the lounge scenes follow the same track through its spectrum and its section
 * boundaries without trusting either very far, so a track the analyser lost runs calm there
 * instead of frantic. This is the verdict that routes it.
 */
export interface GridTrust {
	trusted: boolean;
	/** Human-readable, shown on the queue row and in the inspector. Empty when trusted. */
	reasons: string[];
}

/**
 * Fragmentation is the tell, confidence and meter are the accessories.
 *
 * Calibrated against a 113-track cache: the clean end of the corpus tops out near 4.8
 * sections a minute (busy but honest house), the broken end starts at 5.5 with the one
 * catastrophic grid at 6.3. Confidence alone cannot draw this line - one track at
 * meterConfidence 0.55 has clean structure while another at 0.88 is chopped to bits by a
 * half-time grid - so it only ever tightens the fragmentation test, never trips on its own.
 * A 2/4 verdict is treated the same way: real 2/4 barely exists in this repertoire, so on a
 * fragmented track it is evidence of a meter failure rather than of a polka.
 */
const FRAGMENTED = 5.2;
const SUSPECT = 4.5;
const SHAKY_METER = 0.55;
/**
 * Fragmentation needs FRAGMENTS. A rate alone is biased against short tracks: a 95-second
 * hardstyle edit with a normal eight-section arrangement reads as 5.1 a minute, which is how
 * the owner heard a correctly-labelled track routed to lounge. The genuine wrecks this gate
 * exists for carried 11 and 23 sections; below ten, no track is "chopped to bits" whatever
 * its rate says.
 */
const MIN_SECTIONS = 10;
/**
 * A published tempo this close to the analysed one, at the same level, corroborates the
 * grid: the wrecks this gate catches are wrong-level grids, and a catalogue that agrees on
 * the level is the witness a fragmented but honest arrangement needs. HUMBLE. is 16
 * sections in 177 s at meter confidence 0.99 with Deezer's 149.8 against the model's 150,
 * and the fragmentation is the record's stop-time drops, not a broken grid.
 */
const CORROBORATED_BPM = 0.035;

export function gridTrust(analysis: TrackAnalysis, publishedBpm?: number | null): GridTrust {
	const minutes = analysis.duration / 60;
	// The PRE-consolidation count where the analysis carries one: fragmentation is a fact
	// about what the segmenter heard, and a wreck that merged into a tidy table is still
	// a wreck - the merge hid the symptom, not the broken grid underneath it.
	const sectionCount = analysis.rawSectionCount ?? analysis.sections.length;
	// Too short to fragment meaningfully, and too short for lounge to improve on anything.
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
