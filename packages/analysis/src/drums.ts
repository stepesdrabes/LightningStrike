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
	/** Optional rendered confidence at each evidence frame, in the same units as `levels`. */
	levelCurve?: Float32Array;
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

/** Deafness rule bounds: model hats per beat, DSP hats per beat, and the half-heard share. */
const DEAF_MODEL_MAX = 0.6;
const DEAF_DSP_MIN = 0.75;
const DEAF_HEARD_MIN = 0.1;
const DEAF_EVIDENCE_S = 0.03;
const DEAF_EVIDENCE = 0.05;

/** How much of the bass band's rise is charged against the kick band's, per band. */
const BASS_WEIGHT = 4;
/** Refractory gaps as a fraction of a sixteenth note. */
const KICK_GAP = 0.75;
const SNARE_GAP = 0.75;

function bandFlux(
	mag: Float32Array,
	original: Float32Array,
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
			const rise = Math.log10(1 + original[f * bands + b]) - Math.log10(1 + original[(f - lag) * bands + b]);
			// A changing HPSS mask can rise while the actual sound is decaying.
			if (cur > prev && rise > 0) acc += Math.min(cur - prev, rise);
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

/** Spectral shape supplies class evidence that independent band scaling cannot recover. */
function drumShape(spec: Spectrogram, mag: Float32Array): { kick: Float32Array; snare: Float32Array } {
	const ranges = [[20, 90], [110, 260], [700, 2500], [4000, 10000], [700, 7000]];
	const bins = ranges.map(([lo, hi]) => {
		const found: number[] = [];
		for (let b = 0; b < spec.bands; b++) {
			if (spec.centreHz[b] >= lo && spec.centreHz[b] <= hi) found.push(b);
		}
		return found;
	});
	const kick = new Float32Array(spec.frames);
	const snare = new Float32Array(spec.frames);
	const clamp = (v: number) => Math.max(0, Math.min(1, v));
	for (let f = 0; f < spec.frames; f++) {
		const offset = f * spec.bands;
		const mean = (range: number, source = mag) => {
			let total = 0;
			for (const b of bins[range]) total += source[offset + b];
			return total / Math.max(1, bins[range].length);
		};
		const bottom = mean(0, spec.mag);
		const bass = mean(1, spec.mag);
		kick[f] = clamp((bottom / Math.max(1e-12, bass) - 0.35) / 0.65);
		const middle = mean(2);
		const high = mean(3);
		const noise = mean(4, spec.mag);
		let log = 0;
		for (const b of bins[4]) log += Math.log(Math.max(1e-20, spec.mag[offset + b]));
		const flatness = Math.exp(log / Math.max(1, bins[4].length)) / Math.max(1e-12, noise);
		const percussion = mean(4) / Math.max(1e-12, noise);
		// Dense distorted drums can be noisy even when HPSS cannot isolate a percussive ridge.
		snare[f] = clamp((flatness - 0.35) / 0.25)
			* clamp((middle / Math.max(1e-12, high) - 0.35) / 0.65)
			* Math.max(clamp((percussion - 0.4) / 0.35), clamp((flatness - 0.6) / 0.2));
	}
	return { kick, snare };
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

/** Match the nearest attack: a louder nearby instrument must not steal a model-classified hit. */
export function snapTimesToOnsets(
	times: readonly number[],
	odf: Float32Array,
	fps: number,
	radiusSec: number
): number[] {
	const radius = Math.max(1, Math.round(radiusSec * fps));
	return times.map((t) => {
		const frame = Math.round(t * fps);
		let best = t;
		let distance = radiusSec;
		const from = Math.max(1, frame - radius);
		const to = Math.min(odf.length - 2, frame + radius);
		for (let i = from; i <= to; i++) {
			if (odf[i] <= 0 || odf[i] < odf[i - 1] || odf[i] < odf[i + 1]) continue;
			if (odf[i] === odf[i - 1] && odf[i] === odf[i + 1]) continue;
			const candidate = refinePeakTime(odf, i, fps);
			const delta = Math.abs(candidate - t);
			if (delta > distance) continue;
			distance = delta;
			best = candidate;
		}
		return best;
	});
}

/** Keep hits whose evidence curve rises to at least `floor` within `radiusSec`. */
export function gateByEvidence(
	stream: DrumStream,
	evidence: DrumStream,
	radiusSec: number,
	floor: number
): DrumStream {
	const radius = Math.max(1, Math.round(radiusSec * evidence.fps));
	const keep: number[] = [];
	for (let i = 0; i < stream.times.length; i++) {
		const centre = Math.round(stream.times[i] * evidence.fps);
		let best = 0;
		const to = Math.min(evidence.curve.length - 1, centre + radius);
		for (let k = Math.max(0, centre - radius); k <= to; k++) {
			if (evidence.curve[k] > best) best = evidence.curve[k];
		}
		if (best >= floor) keep.push(i);
	}
	if (keep.length === stream.times.length) return stream;
	return { ...stream, times: keep.map((i) => stream.times[i]), levels: keep.map((i) => stream.levels[i]) };
}

/** Keep every hit except the suspects that `evidence` does not confirm within `radiusSec`. */
export function dropUnconfirmed(
	stream: DrumStream,
	suspects: readonly number[],
	evidence: DrumStream,
	radiusSec: number,
	floor: number
): DrumStream {
	if (suspects.length === 0) return stream;
	const suspect = new Set(suspects);
	const confirmed = new Set(
		gateByEvidence({ ...stream, times: [...suspects], levels: suspects.map(() => 1) }, evidence, radiusSec, floor).times
	);
	const keep: number[] = [];
	for (let i = 0; i < stream.times.length; i++) {
		const t = stream.times[i];
		if (!suspect.has(t) || confirmed.has(t)) keep.push(i);
	}
	if (keep.length === stream.times.length) return stream;
	return { ...stream, times: keep.map((i) => stream.times[i]), levels: keep.map((i) => stream.levels[i]) };
}

/**
 * Sampled trap hats are out of the model's vocabulary: it hears a dense DSP hat pattern only
 * faintly, whereas sibilance and piano hammers, which the DSP band also fires on, leave the
 * hat class silent. `heard` is the share of DSP hats with faint model evidence within 30 ms.
 */
export function modelDeafToHats(
	model: DrumStream,
	dsp: DrumStream,
	beats: number
): { deaf: boolean; heard: number } {
	const modelPerBeat = model.times.length / Math.max(1, beats);
	const dspPerBeat = dsp.times.length / Math.max(1, beats);
	const heard = dsp.times.length > 0
		? gateByEvidence(dsp, model, DEAF_EVIDENCE_S, DEAF_EVIDENCE).times.length / dsp.times.length
		: 0;
	return {
		deaf: modelPerBeat < DEAF_MODEL_MAX && dspPerBeat >= DEAF_DSP_MIN && heard >= DEAF_HEARD_MIN,
		heard
	};
}

/** Union of two streams in time order; within `gapSec` the stronger hit stands for both. */
export function mergeStreams(a: DrumStream, b: DrumStream, gapSec: number): DrumStream {
	const hits = a.times
		.map((time, i) => ({ time, level: a.levels[i] ?? 1 }))
		.concat(b.times.map((time, i) => ({ time, level: b.levels[i] ?? 1 })))
		.sort((x, y) => x.time - y.time);
	const out: { time: number; level: number }[] = [];
	for (const hit of hits) {
		const last = out[out.length - 1];
		if (last && hit.time - last.time < gapSec) {
			if (hit.level > last.level) out[out.length - 1] = hit;
			continue;
		}
		out.push(hit);
	}
	return { ...a, times: out.map((h) => h.time), levels: out.map((h) => h.level) };
}

/** HPSS distinguishes sustained bass from kicks by time behaviour where frequency bands overlap. */
export function detectDrums(spec: Spectrogram, opts: DrumOptions): DrumOnsets {
	const { percussive } = separate(spec.mag, spec.frames, spec.bands);
	const shape = drumShape(spec, percussive);
	const lag = 2;

	const raw = (lo: number, hi: number) =>
		bandFlux(percussive, spec.mag, spec.frames, spec.bands, spec.centreHz, lo, hi, lag);
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
	for (let f = 0; f < spec.frames; f++) kickCurve[f] *= shape.kick[f];

	// Use the weaker snare band: a product admits bodyless hats. Do not veto low end, because
	// backbeats commonly coincide with kicks.
	const snareCurve = new Float32Array(spec.frames);
	for (let f = 0; f < spec.frames; f++) {
		snareCurve[f] = Math.min(bodyCurve[f], crackCurve[f]) * shape.snare[f];
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
