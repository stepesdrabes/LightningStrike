import type { Spectrogram } from './dsp/spectrogram.ts';
import { separate } from './dsp/hpss.ts';
import { maxFilter, quantile, smooth } from './dsp/stats.ts';
import { pickPeaks, refinePeakTime, type Peak } from './onsets.ts';

/**
 * Carry the evidence curve so pattern correction can verify faint missing hits without
 * inventing hits in silence.
 */
export interface DrumStream {
	times: number[];
	/** Peak height above the local floor, index-aligned with `times`. */
	levels: number[];
	/** Detection function minus its local floor, clamped at zero, at `fps`. */
	curve: Float32Array;
	fps: number;
}

interface DrumOnsets {
	kick: DrumStream;
	snare: DrumStream;
	hat: DrumStream;
}

/**
 * Hz. Stop KICK at 90 to exclude common synth-bass octaves; BASS_NOTE supplies subtraction.
 * Snares need both shell resonance and noise burst, excluding clipped kicks and bodyless hats.
 */
const KICK = [20, 90] as const;
const BASS_NOTE = [110, 260] as const;
const SNARE_BODY = [150, 400] as const;
const SNARE_CRACK = [1500, 8000] as const;
const HAT = [6000, 20000] as const;

/** How much of the bass band's rise is charged against the kick band's, per band. */
const BASS_WEIGHT = 4;
/** Refractory gaps as a fraction of a sixteenth note. */
const KICK_GAP = 0.75;
const SNARE_GAP = 0.75;

function bandFlux(
	mag: Float32Array,
	frames: number,
	bands: number,
	centreHz: Float32Array,
	loHz: number,
	hiHz: number,
	lag: number
): Float32Array {
	let lo = 0;
	let hi = bands;
	while (lo < bands && centreHz[lo] < loHz) lo++;
	while (hi > lo && centreHz[hi - 1] > hiHz) hi--;
	if (hi <= lo) hi = Math.min(bands, lo + 1);

	const out = new Float32Array(frames);
	// Per band rather than summed, so two bands of different widths are in the same units and a
	// weight applied between them means one fixed thing.
	const width = hi - lo;
	for (let f = lag; f < frames; f++) {
		let acc = 0;
		for (let b = lo; b < hi; b++) {
			const cur = Math.log10(1 + mag[f * bands + b]);
			const prev = Math.log10(1 + mag[(f - lag) * bands + b]);
			if (cur > prev) acc += cur - prev;
		}
		out[f] = acc / width;
	}
	return out;
}

function normaliseCurve(curve: Float32Array, out = new Float32Array(curve.length)): Float32Array {
	const sorted = Float32Array.from(curve).sort();
	const top = sorted[Math.floor(sorted.length * 0.995)] || 1;
	for (let i = 0; i < curve.length; i++) out[i] = curve[i] / top;
	return out;
}

/** Drop candidates that land within `windowSec` of a stronger event in another stream. */
function suppressNear(candidates: Peak[], suppressors: Peak[], windowSec: number): Peak[] {
	if (suppressors.length === 0) return candidates;
	let j = 0;
	return candidates.filter((c) => {
		while (j < suppressors.length && suppressors[j].time < c.time - windowSec) j++;
		for (let k = j; k < suppressors.length && suppressors[k].time <= c.time + windowSec; k++) {
			if (Math.abs(suppressors[k].time - c.time) <= windowSec) return false;
		}
		return true;
	});
}

interface DrumOptions {
	/** Sets the refractory gaps, so a 175 bpm track can resolve what a 90 bpm one cannot. */
	beatPeriod: number;
	/** The broadband onset curve the beat grid was fitted to, at `spec.fps`. */
	odf: Float32Array;
}

/**
 * Place hits on the broadband curve used by the beat grid: low-band windows peak systematically
 * late. Bound moves to half a sixteenth; retain the detected peak when no onset is nearby.
 */
function placeOnOnset(
	curve: Float32Array,
	peaks: readonly Peak[],
	odf: Float32Array,
	fps: number,
	radiusSec: number
): number[] {
	const radius = Math.max(1, Math.round(radiusSec * fps));
	return peaks.map((p) => {
		let best = -1;
		let bestValue = 0;
		const from = Math.max(1, p.frame - radius);
		const to = Math.min(odf.length - 2, p.frame + radius);
		for (let i = from; i <= to; i++) {
			if (odf[i] >= odf[i - 1] && odf[i] >= odf[i + 1] && odf[i] > bestValue) {
				bestValue = odf[i];
				best = i;
			}
		}
		return best >= 0 ? refinePeakTime(odf, best, fps) : refinePeakTime(curve, p.frame, fps);
	});
}

/** Align model times to nearby broadband onsets, bounded to half a sixteenth; otherwise keep the time. */
export function snapTimesToOnsets(
	times: readonly number[],
	odf: Float32Array,
	fps: number,
	radiusSec: number
): number[] {
	const radius = Math.max(1, Math.round(radiusSec * fps));
	return times.map((t) => {
		const frame = Math.round(t * fps);
		let best = -1;
		let bestValue = 0;
		const from = Math.max(1, frame - radius);
		const to = Math.min(odf.length - 2, frame + radius);
		for (let i = from; i <= to; i++) {
			if (odf[i] >= odf[i - 1] && odf[i] >= odf[i + 1] && odf[i] > bestValue) {
				bestValue = odf[i];
				best = i;
			}
		}
		return best >= 0 ? refinePeakTime(odf, best, fps) : t;
	});
}

/** HPSS distinguishes sustained bass from kicks by time behaviour where frequency bands overlap. */
export function detectDrums(spec: Spectrogram, opts: DrumOptions): DrumOnsets {
	const { percussive } = separate(spec.mag, spec.frames, spec.bands);
	const lag = 2;

	const raw = (lo: number, hi: number) =>
		bandFlux(percussive, spec.frames, spec.bands, spec.centreHz, lo, hi, lag);
	const flux = (lo: number, hi: number) => normaliseCurve(raw(lo, hi));

	const bodyCurve = flux(SNARE_BODY[0], SNARE_BODY[1]);
	const crackCurve = flux(SNARE_CRACK[0], SNARE_CRACK[1]);
	const hatCurve = flux(HAT[0], HAT[1]);

	// Subtract bass evidence before normalising; independent percentile scaling would make the
	// subtraction weight depend on each track.
	const kickBand = raw(KICK[0], KICK[1]);
	const bassBand = raw(BASS_NOTE[0], BASS_NOTE[1]);
	const kickCurve = new Float32Array(spec.frames);
	for (let f = 0; f < spec.frames; f++) {
		kickCurve[f] = Math.max(0, kickBand[f] - BASS_WEIGHT * bassBand[f]);
	}
	normaliseCurve(kickCurve, kickCurve);

	// Use the weaker snare band: a product admits bodyless hats. Do not veto low end, because
	// backbeats commonly coincide with kicks.
	const snareCurve = new Float32Array(spec.frames);
	for (let f = 0; f < spec.frames; f++) {
		snareCurve[f] = Math.min(bodyCurve[f], crackCurve[f]);
	}

	const fps = spec.fps;
	// Minimum gap is a fraction of a sixteenth; a beat fraction would suppress resolvable rolls.
	const sixteenth = opts.beatPeriod / 4;
	const kickGap = Math.max(0.05, sixteenth * KICK_GAP);
	const snareGap = Math.max(0.06, sixteenth * SNARE_GAP);

	const kickPeaks = pickPeaks(kickCurve, fps, {
		localMaxSec: 0.03,
		movingMeanSec: 0.1,
		delta: 0.06,
		refractorySec: kickGap
	});
	const snarePeaks = pickPeaks(snareCurve, fps, {
		localMaxSec: 0.03,
		movingMeanSec: 0.1,
		// Use a higher snare threshold because simultaneous bass and hats can satisfy both bands.
		delta: 0.15,
		refractorySec: snareGap
	});

	// A backbeat lands on a kick in most of this repertoire, so a coincident kick cannot veto
	// a snare outright; it only does when the bottom end is doing much more than the snare
	// bands are, which is a kick that happens to have a bright click.
	const kickLevel = maxFilter(kickCurve, Math.max(1, Math.round(0.03 * fps)));
	const snareKept = snarePeaks.filter((p) => p.strength > 0.3 * kickLevel[p.frame]);

	// Hats are vetoed near kicks only. A hi-hat on the backbeat is not a mistake, it is how
	// the pattern is played, so suppressing hats near snares deletes half of them.
	const hatPeaks = suppressNear(
		pickPeaks(hatCurve, fps, {
			localMaxSec: 0.02,
			movingMeanSec: 0.08,
			delta: 0.05,
			// A thirty-second note at 175 bpm is 43 ms; below that it is cymbal decay
			// retriggering rather than a fresh hit.
			refractorySec: Math.max(0.04, opts.beatPeriod * 0.2)
		}),
		kickPeaks,
		0.02
	);

	const radius = Math.min(0.05, opts.beatPeriod / 8);
	const stream = (curve: Float32Array, peaks: Peak[], meanSec: number): DrumStream => ({
		times: placeOnOnset(curve, peaks, opts.odf, fps, radius),
		...levelsOf(curve, peaks, fps, meanSec)
	});

	return {
		kick: stream(kickCurve, kickPeaks, 0.1),
		snare: stream(snareCurve, snareKept, 0.1),
		hat: stream(hatCurve, hatPeaks, 0.08)
	};
}

/**
 * Scale hits and evidence above one local floor by a high peak quantile; isolated mastering
 * outliers must not dim the rest of the track.
 */
function levelsOf(
	curve: Float32Array,
	peaks: readonly Peak[],
	fps: number,
	movingMeanSec: number
): { levels: number[]; curve: Float32Array; fps: number } {
	const floor = smooth(curve, Math.max(1, Math.round(movingMeanSec * fps)));
	const excess = new Float32Array(curve.length);
	for (let i = 0; i < curve.length; i++) excess[i] = Math.max(0, curve[i] - floor[i]);

	const top = peaks.length > 0 ? quantile(peaks.map((p) => p.strength), 0.9) : 0;
	const scale = top > 1e-9 ? 1 / top : 0;
	for (let i = 0; i < excess.length; i++) excess[i] = Math.min(1, excess[i] * scale);

	return {
		levels: peaks.map((p) => Math.min(1, p.strength * scale)),
		curve: excess,
		fps
	};
}

