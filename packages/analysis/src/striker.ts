import { STRONG_ONSET_EXCESS, activationStream } from './adtof.ts';
import type { DrumStream } from './drums.ts';
import { RealFft, hannWindow } from './dsp/fft.ts';
import { quantile } from './dsp/stats.ts';
import { pickPeaks, refinePeakTime } from './onsets.ts';
import type { SeparatedDrumAudio, SourceOnsets } from './separatedDrums.ts';

/**
 * Striker: transcription and separated-source onset candidates, classified by gradient-boosted trees that
 * bench/drumeval trains. Cymbals join the hat stream afterwards; toms serve benchmarks only.
 */
export const STRIKER_KINDS = ['kick', 'snare', 'hat', 'cymbal'] as const;
export const BENCHMARK_KINDS = [...STRIKER_KINDS, 'tom'] as const;
export type StrikerKind = typeof BENCHMARK_KINDS[number];
type AnalysisKind = typeof STRIKER_KINDS[number];

/** ADTOF activation layout: frames x 5 at 100 fps, classes kick, snare, tom, hat, cymbal. */
const ACT_FPS = 100;
const ACT_CLASSES = 5;
const CHANNEL: Record<StrikerKind, number> = { kick: 0, snare: 1, tom: 2, hat: 3, cymbal: 4 };
const CANDIDATE_THRESHOLD = 0.05;
/** Ghost notes leave only faint snare activation and attacks, so snare proposals reach lower. */
const SNARE_CANDIDATE_THRESHOLD = 0.02;
const MERGE_S = 0.02;
/** Where no class activation rises at all, the mixture's own onset function still does: every class
 * proposes from it and the classifier decides. */
const ODF_PEAKS = { localMaxSec: 0.02, movingMeanSec: 0.1, refractorySec: 0.03, delta: 0.05 };
/**
 * Selected hits closer than this collapse to the more probable one. A benchmark's 50 ms matching
 * tolerance is not a duplicate radius: flams, drags and rolls put two real hits inside it.
 */
const SELECT_GAP_S: Record<StrikerKind, number> = {
	kick: 0.05, snare: 0.028, hat: 0.025, cymbal: 0.05, tom: 0.04
};
const SOURCES = ['kick', 'snare', 'hat', 'cymbal'] as const;
type Source = typeof SOURCES[number];
const FFT_SIZE = 2048;
/** Log-spaced bands, Hz, describing a source's spectral shape just after an attack. */
const SHAPE_LOW_HZ = 40;
const SHAPE_BANDS = 24;
/** A source's strongest attacks, as a share of its peaks, form the track's template of that sound. */
const TEMPLATE_SHARE = 0.3;
const TEMPLATE_MIN = 4;
/** Reach for a source's bleed floor: its median level at another source's attacks. */
const BLEED_REACH_S = 4;
/** dB below the track reference assumed as the floor when no such attacks are near. */
const BLEED_FLOOR_DB = -60;

/** Bump whenever candidate proposals or features change: models trained on other candidates are refused. */
export const CANDIDATE_REVISION = 5;

/** Band edges, Hz, measured on the mixture, so an attack still has evidence when separation fails. */
const MIX_BANDS = [30, 80, 200, 500, 1500, 4000, 8000, 16000] as const;
const MIX_FFT = 1024;
const MIX_HOP = 128;

export const STRIKER_FEATURES = [
	'mix0', 'mix1', 'mix2', 'mix3', 'mix4', 'stem0', 'stem1', 'stem2', 'stem3', 'stem4', 'mixMean', 'stemMean',
	'mixBarPrev', 'stemBarPrev', 'mixBarNext', 'stemBarNext',
	'mixBar2Prev', 'stemBar2Prev', 'mixBar2Next', 'stemBar2Next',
	'mixBeatPrev', 'stemBeatPrev', 'mixBeatNext', 'stemBeatNext', 'mixDb',
	'kickRatio', 'kickDb', 'kickRise', 'kickOnset', 'kickMatch', 'kickDensity',
	'snareRatio', 'snareDb', 'snareRise', 'snareOnset', 'snareMatch', 'snareDensity',
	'hatRatio', 'hatDb', 'hatRise', 'hatOnset', 'hatMatch', 'hatDensity',
	'cymbalRatio', 'cymbalDb', 'cymbalRise', 'cymbalOnset', 'cymbalMatch', 'cymbalDensity',
	'snareOverKick', 'hatOverKick', 'cymbalOverKick', 'kickOverSnare',
	'snareMid', 'kickSub', 'hatHigh', 'cymbalHigh', 'mixOdf', 'dspKick', 'dspSnare', 'dspHat',
	'fromMix', 'fromStem', 'fromSource', 'fromSourceModel', 'fromOdf',
	'bandRise0', 'bandRise1', 'bandRise2', 'bandRise3', 'bandRise4', 'bandRise5', 'bandRise6',
	'bandLevel0', 'bandLevel1', 'bandLevel2', 'bandLevel3', 'bandLevel4', 'bandLevel5', 'bandLevel6',
	'bandTilt', 'bandDrop',
	'kickModel0', 'kickModel1', 'kickModel2', 'kickModel3', 'kickModel4',
	'snareModel0', 'snareModel1', 'snareModel2', 'snareModel3', 'snareModel4',
	'hatModel0', 'hatModel1', 'hatModel2', 'hatModel3', 'hatModel4',
	'cymbalModel0', 'cymbalModel1', 'cymbalModel2', 'cymbalModel3', 'cymbalModel4'
] as const;

/** Share of each source's power in the band its instrument owns, Hz. */
const OWN_BAND: Record<Source, [number, number]> = {
	kick: [20, 90], snare: [1000, 3000], hat: [7000, 11025], cymbal: [3000, 11025]
};

/** ADTOF activations (mix, drum stem, each source) come in the layout activationStream reads. */
export interface StrikerInputs {
	mix: Float32Array;
	stem: Float32Array;
	sourceActivations: Record<Source, Float32Array>;
	sources: SeparatedDrumAudio & { hat: Float32Array; cymbal: Float32Array };
	sourceOnsets: Record<Source, SourceOnsets>;
	/** The mix the sources were separated from, at the sources' rate. */
	audio: Float32Array;
	odf: Float32Array;
	odfFps: number;
	dsp: Record<'kick' | 'snare' | 'hat', DrumStream>;
	beats: Float64Array;
	/** Bar starts followed by the end of the last bar. */
	barTimes: Float64Array;
}

export interface Candidates {
	times: number[];
	/** Row-major, STRIKER_FEATURES.length values per candidate, float32 as the model was trained. */
	features: Float32Array;
	/** Largest rise of the class activation above its trailing average on either pass. */
	strength: number[];
}

function channel(act: Float32Array, c: number): Float32Array {
	const out = new Float32Array(Math.floor(act.length / ACT_CLASSES));
	for (let t = 0; t < out.length; t++) out[t] = act[t * ACT_CLASSES + c];
	return out;
}

function maxAround(curve: ArrayLike<number>, frame: number, radius: number): number {
	let m = 0;
	const to = Math.min(curve.length - 1, frame + radius);
	for (let i = Math.max(0, frame - radius); i <= to; i++) if (curve[i] > m) m = curve[i];
	return m;
}

function meanAround(curve: ArrayLike<number>, frame: number, radius: number): number {
	let sum = 0;
	let n = 0;
	const to = Math.min(curve.length - 1, frame + radius);
	for (let i = Math.max(0, frame - radius); i <= to; i++, n++) sum += curve[i];
	return n ? sum / n : 0;
}

function rms(audio: Float32Array, rate: number, time: number, from: number, to: number): number {
	const start = Math.max(0, Math.floor((time + from) * rate));
	const end = Math.min(audio.length, Math.ceil((time + to) * rate));
	let sum = 0;
	for (let i = start; i < end; i++) sum += audio[i] * audio[i];
	return Math.sqrt(sum / Math.max(1, end - start));
}

const db = (v: number) => 20 * Math.log10(Math.max(1e-6, v));

function lowerBound(sorted: ArrayLike<number>, t: number): number {
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] < t) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** A loud passage's frame RMS: the level that dB features are measured against. */
function referenceLevel(audio: Float32Array, rate: number): number {
	const hop = Math.round(rate / 10);
	const levels: number[] = [];
	for (let at = 0; at + hop <= audio.length; at += hop) {
		let sum = 0;
		for (let i = at; i < at + hop; i++) sum += audio[i] * audio[i];
		levels.push(Math.sqrt(sum / hop));
	}
	return Math.max(1e-6, levels.length ? quantile(levels, 0.95) : 0);
}

/** Power spectra 40 ms after an attack, and what they say about one source there. */
class Spectra {
	private readonly fft = new RealFft(FFT_SIZE);
	private readonly window = hannWindow(FFT_SIZE);
	private readonly magnitude: Float32Array;
	private readonly bandStart: Int32Array;
	private readonly rate: number;

	constructor(rate: number) {
		this.rate = rate;
		this.magnitude = new Float32Array(this.fft.bins);
		const top = rate / 2;
		this.bandStart = Int32Array.from({ length: SHAPE_BANDS + 1 }, (_, b) => {
			const hz = SHAPE_LOW_HZ * Math.pow(top / SHAPE_LOW_HZ, b / SHAPE_BANDS);
			return Math.min(this.fft.bins, Math.round((hz * FFT_SIZE) / rate));
		});
	}

	/** Reads `source` around `time`; the queries below describe that read until the next one. */
	read(source: Float32Array, time: number): void {
		const start = Math.round((time + 0.04) * this.rate) - FFT_SIZE / 2;
		this.fft.magnitudes(source, start, this.window, this.magnitude, 1);
	}

	share(loHz: number, hiHz: number): number {
		let total = 0;
		let band = 0;
		for (let b = 0; b < this.magnitude.length; b++) {
			const power = this.magnitude[b] * this.magnitude[b];
			const hz = (b * this.rate) / FFT_SIZE;
			total += power;
			if (hz >= loHz && hz < hiHz) band += power;
		}
		return band / Math.max(1e-20, total);
	}

	/** Mean-free, unit-length log band energies: the sound's shape regardless of its level. */
	shape(out: Float64Array): Float64Array {
		let mean = 0;
		for (let b = 0; b < SHAPE_BANDS; b++) {
			let energy = 0;
			const from = this.bandStart[b];
			const to = Math.max(from + 1, this.bandStart[b + 1]);
			for (let k = from; k < to; k++) energy += this.magnitude[k] * this.magnitude[k];
			out[b] = Math.log(1e-12 + energy / (to - from));
			mean += out[b];
		}
		mean /= SHAPE_BANDS;
		let norm = 0;
		for (let b = 0; b < SHAPE_BANDS; b++) {
			out[b] -= mean;
			norm += out[b] * out[b];
		}
		norm = Math.sqrt(norm);
		for (let b = 0; b < SHAPE_BANDS; b++) out[b] = norm > 1e-9 ? out[b] / norm : 0;
		return out;
	}
}

interface MixBands {
	/** One RMS curve per band of MIX_BANDS. */
	energy: Float32Array[];
	/** Each band's loud level in this track, so a level reads the same across recordings. */
	reference: number[];
	fps: number;
}

/** Band energies of the mixture itself, at a finer clock than the transcription's 100 Hz. */
function mixBands(audio: Float32Array, rate: number): MixBands {
	const fft = new RealFft(MIX_FFT);
	const window = hannWindow(MIX_FFT);
	const mags = new Float32Array(fft.bins);
	const frames = Math.max(1, Math.ceil(audio.length / MIX_HOP));
	const count = MIX_BANDS.length - 1;
	const edge = MIX_BANDS.map((hz) => Math.min(fft.bins - 1, Math.round((hz * MIX_FFT) / rate)));
	const energy = Array.from({ length: count }, () => new Float32Array(frames));
	for (let f = 0; f < frames; f++) {
		fft.magnitudes(audio, f * MIX_HOP - (MIX_FFT >> 1), window, mags, 2 / MIX_FFT);
		for (let b = 0; b < count; b++) {
			let acc = 0;
			for (let k = edge[b]; k < Math.max(edge[b] + 1, edge[b + 1]); k++) acc += mags[k] * mags[k];
			energy[b][f] = Math.sqrt(acc);
		}
	}
	return {
		energy,
		reference: energy.map((curve) => Math.max(1e-6, quantile(curve, 0.95))),
		fps: rate / MIX_HOP
	};
}

interface SourceContext {
	/** Refined attack times of the source's own onset peaks. */
	peaks: Float64Array;
	/** Unit-length mean shape of its strongest attacks; zero when there are too few. */
	template: Float64Array;
}

interface Context {
	mixCurves: Float32Array[];
	stemCurves: Float32Array[];
	sourceCurves: Record<Source, Float32Array[]>;
	reference: number;
	spectra: Spectra;
	bands: MixBands;
	odfPeaks: number[];
	sources: Record<Source, SourceContext>;
	/** Level of the first source, dB against the reference, at each attack of the second. */
	bleed: {
		snareAtKick: Float64Array; hatAtKick: Float64Array; cymbalAtKick: Float64Array; kickAtSnare: Float64Array;
	};
}

/** Median bleed level among `at`'s attacks within the reach of `time`. */
function bleedFloor(levels: Float64Array, at: Float64Array, time: number, scratch: number[]): number {
	scratch.length = 0;
	const end = time + BLEED_REACH_S;
	for (let i = lowerBound(at, time - BLEED_REACH_S); i < at.length && at[i] <= end; i++) scratch.push(levels[i]);
	if (!scratch.length) return BLEED_FLOOR_DB;
	scratch.sort((a, b) => a - b);
	const mid = scratch.length >> 1;
	return scratch.length % 2 ? scratch[mid] : (scratch[mid - 1] + scratch[mid]) / 2;
}

function sourcePeaks(onsets: SourceOnsets) {
	return pickPeaks(onsets.odf, onsets.fps, {
		localMaxSec: 0.025, movingMeanSec: 0.15, refractorySec: 0.06, delta: 0.1
	});
}

function context(inputs: StrikerInputs): Context {
	const spectra = new Spectra(inputs.sources.sampleRate);
	const sources = {} as Record<Source, SourceContext>;
	const shape = new Float64Array(SHAPE_BANDS);
	for (const name of SOURCES) {
		const onsets = inputs.sourceOnsets[name];
		const peaks = sourcePeaks(onsets);
		const times = Float64Array.from(peaks, (peak) => refinePeakTime(onsets.odf, peak.frame, onsets.fps));
		const strongest = peaks.map((peak, i) => ({ i, strength: peak.strength }))
			.sort((a, b) => b.strength - a.strength || a.i - b.i)
			.slice(0, Math.max(TEMPLATE_MIN, Math.ceil(peaks.length * TEMPLATE_SHARE)));
		const template = new Float64Array(SHAPE_BANDS);
		if (peaks.length >= TEMPLATE_MIN) {
			for (const { i } of strongest) {
				spectra.read(inputs.sources[name], times[i]);
				spectra.shape(shape);
				for (let b = 0; b < SHAPE_BANDS; b++) template[b] += shape[b];
			}
			const norm = Math.sqrt(template.reduce((sum, v) => sum + v * v, 0));
			for (let b = 0; b < SHAPE_BANDS; b++) template[b] = norm > 1e-9 ? template[b] / norm : 0;
		}
		sources[name] = { peaks: times, template };
	}
	const rate = inputs.sources.sampleRate;
	const reference = referenceLevel(inputs.audio, rate);
	const levelsAt = (source: Float32Array, times: Float64Array) =>
		Float64Array.from(times, (time) => db(rms(source, rate, time, -0.02, 0.06) / reference));
	return {
		mixCurves: Array.from({ length: ACT_CLASSES }, (_, c) => channel(inputs.mix, c)),
		stemCurves: Array.from({ length: ACT_CLASSES }, (_, c) => channel(inputs.stem, c)),
		sourceCurves: Object.fromEntries(SOURCES.map((name) => [
			name, Array.from({ length: ACT_CLASSES }, (_, c) => channel(inputs.sourceActivations[name], c))
		])) as Record<Source, Float32Array[]>,
		reference,
		spectra,
		bands: mixBands(inputs.audio, rate),
		odfPeaks: pickPeaks(inputs.odf, inputs.odfFps, ODF_PEAKS)
			.map((peak) => refinePeakTime(inputs.odf, peak.frame, inputs.odfFps)),
		sources,
		bleed: {
			snareAtKick: levelsAt(inputs.sources.snare, sources.kick.peaks),
			hatAtKick: levelsAt(inputs.sources.hat, sources.kick.peaks),
			cymbalAtKick: levelsAt(inputs.sources.cymbal, sources.kick.peaks),
			kickAtSnare: levelsAt(inputs.sources.kick, sources.snare.peaks)
		}
	};
}

export function drumCandidates(inputs: StrikerInputs, kind: StrikerKind, shared = context(inputs)): Candidates {
	const { sources, audio } = inputs;
	const rate = sources.sampleRate;
	const { mixCurves, stemCurves, reference, spectra } = shared;
	const mixCurve = mixCurves[CHANNEL[kind]];
	const stemCurve = stemCurves[CHANNEL[kind]];
	const frames = Math.min(mixCurve.length, stemCurve.length);
	// The kit separator's tom stem is not kept, so tom candidates come from the transcriptions only.
	const sourceOnset = kind === 'tom' ? null : inputs.sourceOnsets[kind];

	const proposalThreshold = kind === 'snare' ? SNARE_CANDIDATE_THRESHOLD : CANDIDATE_THRESHOLD;
	const mixPeaks = activationStream(mixCurve, proposalThreshold);
	const stemPeaks = activationStream(stemCurve, proposalThreshold);
	const proposals: { time: number; from: number }[] = [];
	for (const time of mixPeaks.times) proposals.push({ time, from: 0 });
	for (const time of stemPeaks.times) proposals.push({ time, from: 1 });
	if (sourceOnset && kind !== 'tom') {
		const peaks = pickPeaks(sourceOnset.odf, sourceOnset.fps, {
			localMaxSec: 0.025, movingMeanSec: 0.15, refractorySec: kind === 'snare' ? 0.04 : 0.06,
			delta: kind === 'kick' ? 0.3 : kind === 'snare' ? 0.03 : 0.1
		});
		for (const peak of peaks) {
			proposals.push({ time: refinePeakTime(sourceOnset.odf, peak.frame, sourceOnset.fps), from: 2 });
		}
		for (const time of activationStream(shared.sourceCurves[kind][CHANNEL[kind]], proposalThreshold).times) {
			proposals.push({ time, from: 3 });
		}
	}
	for (const time of shared.odfPeaks) proposals.push({ time, from: 4 });
	proposals.sort((a, b) => a.time - b.time || a.from - b.from);

	const strengthAt = (time: number) => {
		const frame = Math.round(time * ACT_FPS);
		return Math.max(maxAround(mixCurve, frame, 1), maxAround(stemCurve, frame, 1));
	};
	const merged: { time: number; flags: number[] }[] = [];
	for (const proposal of proposals) {
		const last = merged[merged.length - 1];
		if (last && proposal.time - last.time < MERGE_S) {
			last.flags[proposal.from] = 1;
			if (strengthAt(proposal.time) > strengthAt(last.time)) last.time = proposal.time;
			continue;
		}
		const flags = [0, 0, 0, 0, 0];
		flags[proposal.from] = 1;
		merged.push({ time: proposal.time, flags });
	}

	const { beats, barTimes } = inputs;
	const meanPeriod = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
	const width = STRIKER_FEATURES.length;
	const features = new Float32Array(merged.length * width);
	const strength: number[] = [];
	const shape = new Float64Array(SHAPE_BANDS);
	const shares = { kick: 0, snare: 0, hat: 0, cymbal: 0 };
	const levels = { kick: 0, snare: 0, hat: 0, cymbal: 0 };
	const scratch: number[] = [];

	merged.forEach((candidate, row) => {
		const t = candidate.time;
		const frame = Math.round(t * ACT_FPS);
		let column = row * width;
		const put = (value: number) => {
			features[column++] = Number.isFinite(value) ? value : 0;
		};
		for (let c = 0; c < ACT_CLASSES; c++) put(maxAround(mixCurves[c], frame, 2));
		for (let c = 0; c < ACT_CLASSES; c++) put(maxAround(stemCurves[c], frame, 2));
		put(meanAround(mixCurve, frame, 10));
		put(meanAround(stemCurve, frame, 10));

		const bar = Math.max(0, Math.min(barTimes.length - 2, lowerBound(barTimes, t + 1e-9) - 1));
		const barSpan = barTimes.length > 1 && barTimes[bar + 1] > barTimes[bar]
			? barTimes[bar + 1] - barTimes[bar]
			: meanPeriod * 4;
		for (const shift of [-1, 1, -2, 2]) {
			const g = Math.round((t + shift * barSpan) * ACT_FPS);
			put(g >= 0 && g < frames ? maxAround(mixCurve, g, 3) : 0);
			put(g >= 0 && g < frames ? maxAround(stemCurve, g, 3) : 0);
		}
		for (const shift of [-1, 1]) {
			const g = Math.round((t + shift * meanPeriod) * ACT_FPS);
			put(g >= 0 && g < frames ? maxAround(mixCurve, g, 2) : 0);
			put(g >= 0 && g < frames ? maxAround(stemCurve, g, 2) : 0);
		}

		const mixRms = rms(audio, rate, t, -0.02, 0.06);
		put(db(mixRms / reference));
		for (const name of SOURCES) {
			const source = sources[name];
			const level = rms(source, rate, t, -0.02, 0.06);
			levels[name] = db(level / reference);
			put(level / Math.max(1e-6, mixRms));
			put(levels[name]);
			put(db(rms(source, rate, t, 0, 0.08)) - db(rms(source, rate, t, -0.06, -0.01)));
			const onsets = inputs.sourceOnsets[name];
			put(maxAround(onsets.odf, Math.round(t * onsets.fps), 3));
			spectra.read(source, t);
			spectra.shape(shape);
			const { template, peaks: sourceTimes } = shared.sources[name];
			let match = 0;
			for (let b = 0; b < SHAPE_BANDS; b++) match += shape[b] * template[b];
			put(match);
			put((lowerBound(sourceTimes, t + 1) - lowerBound(sourceTimes, t - 1)) / 2);
			shares[name] = spectra.share(OWN_BAND[name][0], Math.min(rate / 2, OWN_BAND[name][1]));
		}
		const { bleed, sources: attacks } = shared;
		put(levels.snare - bleedFloor(bleed.snareAtKick, attacks.kick.peaks, t, scratch));
		put(levels.hat - bleedFloor(bleed.hatAtKick, attacks.kick.peaks, t, scratch));
		put(levels.cymbal - bleedFloor(bleed.cymbalAtKick, attacks.kick.peaks, t, scratch));
		put(levels.kick - bleedFloor(bleed.kickAtSnare, attacks.snare.peaks, t, scratch));
		put(shares.snare);
		put(shares.kick);
		put(shares.hat);
		put(shares.cymbal);
		put(maxAround(inputs.odf, Math.round(t * inputs.odfFps), 3));
		for (const dsp of [inputs.dsp.kick, inputs.dsp.snare, inputs.dsp.hat]) {
			put(maxAround(dsp.curve, Math.round(t * dsp.fps), 3));
		}
		for (const flag of candidate.flags) put(flag);
		const { bands } = shared;
		const frameAt = (offset: number) => Math.round((t + offset) * bands.fps);
		let lowEarly = 0;
		let lowLate = 0;
		let bassEarly = 0;
		let bassLate = 0;
		const rises: number[] = [];
		for (let b = 0; b < bands.energy.length; b++) {
			const curve = bands.energy[b];
			const attack = maxAround(curve, frameAt(0.012), Math.round(0.018 * bands.fps));
			// Clamped, so a candidate in the first frames measures the quiet it has rather than none.
			const quiet = meanAround(curve, Math.max(0, frameAt(-0.06)), Math.round(0.022 * bands.fps));
			rises.push(db(attack) - db(quiet));
			if (b === 0) {
				lowEarly = maxAround(curve, frameAt(0.008), 2);
				lowLate = maxAround(curve, frameAt(0.05), 3);
			}
			if (b === 1) {
				bassEarly = maxAround(curve, frameAt(0.008), 2);
				bassLate = maxAround(curve, frameAt(0.05), 3);
			}
		}
		for (const rise of rises) put(rise);
		for (let b = 0; b < bands.energy.length; b++) {
			put(db(maxAround(bands.energy[b], frameAt(0.012), Math.round(0.018 * bands.fps)) / bands.reference[b]));
		}
		// Where the attack sits between the drum bands, and whether its low end falls into the sub
		// over the first 50 ms, as a pitched 808 or hardstyle kick does and a snare never does.
		put(rises[0] + rises[1] - rises[4] - rises[5]);
		put((db(lowLate) - db(bassLate)) - (db(lowEarly) - db(bassEarly)));
		for (const name of SOURCES) {
			for (let c = 0; c < ACT_CLASSES; c++) put(maxAround(shared.sourceCurves[name][c], frame, 2));
		}
		if (column !== (row + 1) * width) throw new Error('Striker features are out of step with STRIKER_FEATURES.');
		strength.push(Math.max(maxAround(mixPeaks.curve, frame, 1), maxAround(stemPeaks.curve, frame, 1)));
	});
	return { times: merged.map((candidate) => candidate.time), features, strength };
}

export function strikerCandidates(
	inputs: StrikerInputs, kinds: readonly StrikerKind[] = STRIKER_KINDS
): Partial<Record<StrikerKind, Candidates>> {
	const shared = context(inputs);
	return Object.fromEntries(kinds.map((kind) => [kind, drumCandidates(inputs, kind, shared)]));
}

/** LightGBM trees flattened: negative child indices address leaves as ~index. */
interface Tree {
	feature: number[];
	threshold: number[];
	left: number[];
	right: number[];
	leaf: number[];
}

interface StrikerClass {
	threshold: number;
	trees: Tree[];
}

export interface StrikerModel {
	/** Release name and content hash, such as `Striker 1.0 (56e52c9c)`; analyses record it. */
	version: string;
	/** Training options, for provenance. */
	recipe?: string;
	/** The CANDIDATE_REVISION the trees were trained on. */
	candidates: number;
	features: string[];
	classes: Record<AnalysisKind, StrikerClass> & { tom?: StrikerClass };
}

/** Every split must lead forward to a split or to a leaf, so evaluation always terminates. */
function validTree(tree: Tree): boolean {
	const splits = tree.feature?.length ?? -1;
	if (splits < 0 || !tree.leaf?.length) return false;
	if ([tree.threshold, tree.left, tree.right].some((list) => list?.length !== splits)) return false;
	const child = (node: number, next: number) =>
		Number.isInteger(next) && (next >= 0 ? next > node && next < splits : ~next < tree.leaf.length);
	for (let node = 0; node < splits; node++) {
		const feature = tree.feature[node];
		const known = Number.isInteger(feature) && feature >= 0 && feature < STRIKER_FEATURES.length;
		if (!known || !Number.isFinite(tree.threshold[node])) return false;
		if (!child(node, tree.left[node]) || !child(node, tree.right[node])) return false;
	}
	return tree.leaf.every(Number.isFinite);
}

export function validateStrikerModel(model: StrikerModel): StrikerModel {
	if (typeof model.version !== 'string' || !model.version) throw new Error('Striker model has no version.');
	if (model.candidates !== CANDIDATE_REVISION) throw new Error('Striker model was trained on other candidates.');
	if (model.features?.length !== STRIKER_FEATURES.length
		|| model.features.some((name, i) => name !== STRIKER_FEATURES[i])) {
		throw new Error('Striker model features do not match this analyser.');
	}
	for (const kind of BENCHMARK_KINDS) {
		const entry = model.classes[kind];
		if (!entry && kind === 'tom') continue;
		const inRange = entry && entry.threshold > 0 && entry.threshold < 1;
		if (!inRange || !entry.trees?.length || !entry.trees.every(validTree)) {
			throw new Error(`Striker model has no usable ${kind} classifier.`);
		}
	}
	return model;
}

/**
 * A kick or snare's own source level, dB below the class's loud hits in the track, that maps to
 * level 0. A clap under a loud kick barely moves the transcription but is as loud as its peers.
 * Hat and cymbal levels keep the activation rise, which separates pedal hats better.
 */
const LOUDNESS_RANGE_DB = 18;
/**
 * The player reads a level of 0 as "this hit recorded no level" and substitutes a fixed amplitude
 * for it, which would make a hit far below the track's loud ones brighter than a merely soft one.
 * A hit the classifier accepted keeps a level under that floor instead, so it stays ordered.
 */
const QUIETEST_HIT = 0.02;
const column = (name: typeof STRIKER_FEATURES[number]) => STRIKER_FEATURES.indexOf(name);
const LOUDNESS: Partial<Record<StrikerKind, number>> = {
	kick: column('kickDb'), snare: column('snareDb')
};
/**
 * A fallback, not a fifth opinion: a band holds whatever else plays in it, so a pedal hat under a
 * loud snare must not inherit the snare's level.
 */
const MIX_LOUDNESS: Record<StrikerKind, number[]> = {
	kick: [column('bandLevel0'), column('bandLevel1')],
	snare: [column('bandLevel2'), column('bandLevel4')],
	hat: [column('bandLevel5'), column('bandLevel6')],
	cymbal: [column('bandLevel5'), column('bandLevel6')],
	tom: [column('bandLevel1'), column('bandLevel2')]
};

export function strikerProbabilities(model: StrikerModel, kind: StrikerKind, candidates: Candidates): Float64Array {
	const width = STRIKER_FEATURES.length;
	const count = candidates.times.length;
	const out = new Float64Array(count);
	const trees = model.classes[kind]?.trees ?? [];
	for (let row = 0; row < count; row++) {
		const base = row * width;
		let score = 0;
		for (const tree of trees) {
			let node = tree.feature.length ? 0 : -1;
			while (node >= 0) {
				const left = candidates.features[base + tree.feature[node]] <= tree.threshold[node];
				node = left ? tree.left[node] : tree.right[node];
			}
			score += tree.leaf[~node];
		}
		out[row] = 1 / (1 + Math.exp(-score));
	}
	return out;
}

/**
 * Hits above the class threshold, most probable first within SELECT_GAP_S, for every proposed kind
 * the model classifies. Levels map the activation rise as activationStream does.
 */
export function runStriker(
	model: StrikerModel, inputs: StrikerInputs, proposed = strikerCandidates(inputs)
): Record<AnalysisKind, DrumStream> & { tom?: DrumStream } {
	const out: Partial<Record<StrikerKind, DrumStream>> = {};
	for (const kind of BENCHMARK_KINDS) {
		const candidates = proposed[kind];
		const entry = model.classes[kind];
		if (!candidates || !entry) continue;
		const probabilities = strikerProbabilities(model, kind, candidates);
		const threshold = entry.threshold;
		const order = Array.from(probabilities.keys())
			.filter((i) => probabilities[i] >= threshold)
			.sort((a, b) => probabilities[b] - probabilities[a] || candidates.times[a] - candidates.times[b]);
		const chosen: number[] = [];
		const gap = SELECT_GAP_S[kind];
		// Accepted hits by gap bucket; two buckets each side cover every conflict, rounding included.
		const accepted = new Map<number, number[]>();
		for (const i of order) {
			const time = candidates.times[i];
			const bucket = Math.floor(time / gap);
			let taken = false;
			for (let b = bucket - 2; b <= bucket + 2 && !taken; b++) {
				taken = accepted.get(b)?.some((j) => Math.abs(candidates.times[j] - time) < gap) ?? false;
			}
			if (taken) continue;
			chosen.push(i);
			const neighbours = accepted.get(bucket);
			if (neighbours) neighbours.push(i);
			else accepted.set(bucket, [i]);
		}
		chosen.sort((a, b) => candidates.times[a] - candidates.times[b]);
		const frames = Math.floor(Math.min(inputs.mix.length, inputs.stem.length) / ACT_CLASSES);
		const curve = new Float32Array(frames);
		for (let i = 0; i < candidates.times.length; i++) {
			const frame = Math.round(candidates.times[i] * ACT_FPS);
			if (frame >= 0 && frame < frames && probabilities[i] > curve[frame]) curve[frame] = probabilities[i];
		}
		const strengths = chosen.map((i) => candidates.strength[i]).sort((a, b) => a - b);
		const top = Math.max(STRONG_ONSET_EXCESS, strengths[Math.floor(strengths.length * 0.9)] ?? 0);
		const against = (col: number) => {
			const read = chosen.map((i) => candidates.features[i * STRIKER_FEATURES.length + col]);
			const loud = quantile(read, 0.9);
			return read.map((v) => Math.min(1, Math.max(0, 1 + (v - loud) / LOUDNESS_RANGE_DB)));
		};
		const source = LOUDNESS[kind];
		const heard = source === undefined ? null : against(source);
		const fallback = MIX_LOUDNESS[kind].map(against);
		const levels = chosen.map((i, k) => {
			const s = candidates.strength[i];
			let level = Math.max(Math.min(1, s / top) * Math.min(1, s / STRONG_ONSET_EXCESS), heard?.[k] ?? 0);
			if (level <= 0) for (const read of fallback) if (read[k] > level) level = read[k];
			return Math.max(QUIETEST_HIT, level);
		});
		out[kind] = { times: chosen.map((i) => candidates.times[i]), levels, curve, fps: ACT_FPS };
	}
	return out as Record<AnalysisKind, DrumStream> & { tom?: DrumStream };
}
