/**
 * node bench/audibility.ts [--id ID] [--from S] [--to S] [--cache DIR] [--out DIR] [--no-adtof]
 *
 * What is audible in a span of a cached track: loudness at 10 ms, the broadband SuperFlux
 * curve and its peaks, DSP and ADTOF drum evidence, the cached analysis's onsets and grid, and
 * a 30-band spectral snapshot of every attack candidate. Writes <out>/<id>.json and .md.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TrackAnalysis } from '@mv/core';
import { Adtof, activationStream } from '../packages/analysis/src/adtof.ts';
import { ANALYSIS_RATE, decodeAudio } from '../packages/analysis/src/decode.ts';
import { applyCascade, kWeighting } from '../packages/analysis/src/dsp/filters.ts';
import { RealFft, hannWindow } from '../packages/analysis/src/dsp/fft.ts';
import { detectDrums, type DrumStream } from '../packages/analysis/src/drums.ts';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import { pickPeaks, refinePeakTime } from '../packages/analysis/src/onsets.ts';
import { benchmarkCache } from './cache.ts';

const args = process.argv.slice(2);
const option = (flag: string): string | undefined => {
	const i = args.indexOf(flag);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const id = option('--id') ?? '9vWNauaZAgg';
const from = Math.max(0, Number(option('--from') ?? 0));
const toArg = Number(option('--to') ?? 32);
const cache = resolve(benchmarkCache(option('--cache')));
const outDir = resolve(option('--out') ?? 'bench/reports/audio-reliability/intro');
const skipAdtof = args.includes('--no-adtof');
if (!/^[\w-]+$/.test(id)) throw new Error('Pass a cached track id.');
if (outDir === cache || outDir.startsWith(cache + '\\') || outDir.startsWith(cache + '/')) {
	throw new Error('Diagnostic output must stay outside the audio cache.');
}

const HOP_SEC = 0.01;
const HOP_FPS = 100;
/** Centred 50 ms RMS and trailing 400 ms K-weighted momentary block, in hops. */
const RMS_RADIUS = 2;
const MOMENTARY_HOPS = 40;
const LUFS_OFFSET = -0.691;
/** analyze.ts normalises to this before feature extraction; the DSP path here does the same. */
const TARGET_LUFS = -14;
const ADTOF_FPS = 100;
const ADTOF_CLASSES = ['kick', 'snare', 'tom', 'hat', 'cymbal'] as const;
const ADTOF_THRESHOLDS = [0.22, 0.24, 0.32, 0.22, 0.3] as const;
const ADTOF_LOW = 0.1;
const ODF_PICK = { localMaxSec: 0.03, movingMeanSec: 0.1, delta: 0.05, refractorySec: 0.04 };
const SNAP_RATE = 44100;
const SNAP_FFT = 2048;
const SNAP_HOP = 441;
const SNAP_BANDS = 30;
const SNAP_LO_HZ = 40;
const SNAP_HI_HZ = 16000;
/** Region edges, Hz: low, mid, high, plus an air band for hat clicks. */
const LOW_HZ = 200;
const MID_HZ = 2000;
const AIR_HZ = 6000;
/** Rise is measured against the 30..60 ms before the energy peak. */
const RISE_BEFORE = [6, 3] as const;
const DECAY_DB = 10;
const DECAY_CAP_FRAMES = 100;
const MERGE_SEC = 0.02;

type AdtofClass = (typeof ADTOF_CLASSES)[number];
type Kit = 'kick' | 'snare' | 'hat';
const KIT: Kit[] = ['kick', 'snare', 'hat'];

interface SourceMark {
	time: number;
	source: string;
	detail: Record<string, number>;
}

interface Snapshot {
	peakTime: number;
	rmsDb: number;
	momentaryLufs: number;
	totalDb: number;
	riseDb: number;
	centroidHz: number;
	lowFrac: number;
	midFrac: number;
	highFrac: number;
	airFrac: number;
	riseLowDb: number;
	riseMidDb: number;
	riseHighDb: number;
	riseAirDb: number;
	riseLowFrac: number;
	riseMidFrac: number;
	riseHighFrac: number;
	riseCentroidHz: number;
	decayMs: number | null;
	decayHighMs: number | null;
	decayAirMs: number | null;
	bandDb: number[];
	riseBandDb: number[];
	guess: string;
}

const r = (v: number, digits = 2) => Number(v.toFixed(digits));
const dB = (power: number) => 10 * Math.log10(Math.max(power, 1e-12));
const mean = (v: ArrayLike<number>, lo: number, hi: number) => {
	const a = Math.max(0, lo);
	const b = Math.min(v.length, hi);
	if (b <= a) return 0;
	let acc = 0;
	for (let i = a; i < b; i++) acc += v[i];
	return acc / (b - a);
};
const inSpan = (t: number) => t >= from - 1e-6 && t <= to + 1e-6;

const analysis = JSON.parse(readFileSync(join(cache, `${id}.analysis.json`), 'utf8')) as TrackAnalysis;
const audioFile = readdirSync(cache).find(
	(name) => name.startsWith(`${id}.`) && /\.(m4a|mp3|opus|webm|wav|flac)$/.test(name)
);
if (!audioFile) throw new Error(`Audio missing for ${id} in ${cache}`);
const audioPath = join(cache, audioFile);
const to = Math.min(toArg, analysis.duration);
if (!(to > from)) throw new Error('Empty span.');

console.error(`${id} ${analysis.title}: decoding`);
const dsp = await decodeAudio(audioPath, ANALYSIS_RATE);
const wide = await decodeAudio(audioPath, SNAP_RATE);

// (a) loudness at 10 ms: raw RMS and K-weighted momentary on the unnormalised mono.
function hopPower(signal: Float32Array, sampleRate: number): Float64Array {
	const step = Math.round(HOP_SEC * sampleRate);
	const hops = Math.floor(signal.length / step);
	const out = new Float64Array(hops);
	for (let h = 0; h < hops; h++) {
		let acc = 0;
		const o = h * step;
		for (let i = 0; i < step; i++) acc += signal[o + i] * signal[o + i];
		out[h] = acc / step;
	}
	return out;
}
const rawPower = hopPower(dsp.mono, dsp.sampleRate);
const weighted = Float32Array.from(dsp.mono);
applyCascade(weighted, kWeighting(dsp.sampleRate));
const weightedPower = hopPower(weighted, dsp.sampleRate);
const rmsDbAt = (t: number) => {
	const h = Math.round(t * HOP_FPS);
	return dB(mean(rawPower, h - RMS_RADIUS, h + RMS_RADIUS + 1));
};
const momentaryAt = (t: number) => {
	const h = Math.round(t * HOP_FPS);
	return LUFS_OFFSET + dB(mean(weightedPower, h - MOMENTARY_HOPS + 1, h + 1));
};

const loudness = measureLoudness(dsp.mono, dsp.sampleRate);
const rawGain = Math.pow(10, (TARGET_LUFS - loudness.integrated) / 20);
const gain = Number.isFinite(rawGain) && Math.abs(rawGain - 1) > 0.01 ? Math.min(rawGain, 40) : 1;
const normalised = Float32Array.from(dsp.mono, (v) => v * gain);

// (b) broadband SuperFlux and (c) DSP drums, whole track so conditioning matches the app.
console.error('features');
const features = extractFeatures(normalised, dsp.sampleRate);
const odfFps = features.curves.fps;
const odfPeaks = pickPeaks(features.odf, odfFps, ODF_PICK)
	.filter((p) => inSpan(p.time))
	.map((p) => ({
		time: r(refinePeakTime(features.odf, p.frame, odfFps), 3),
		height: r(features.odf[p.frame], 3),
		strength: r(p.strength, 3),
		rawFlux: r(features.curves.flux[p.frame], 3)
	}));
console.error('dsp drums');
const dspDrums = detectDrums(features.spec, { beatPeriod: analysis.tempo.beatPeriod, odf: features.odf });
const streamEvents = (s: DrumStream) =>
	s.times
		.map((time, i) => ({ time: r(time, 3), level: r(s.levels[i], 3), curve: r(s.curve[Math.round(time * s.fps)], 3) }))
		.filter((e) => inSpan(e.time));
const dspEvents = { kick: streamEvents(dspDrums.kick), snare: streamEvents(dspDrums.snare), hat: streamEvents(dspDrums.hat) };

// (d) ADTOF activations, all five classes, shipping thresholds and a lowered one.
interface AdtofEvent {
	time: number;
	height: number;
	activation: number;
	level: number;
}
const adtofRaw: Partial<Record<AdtofClass, Float32Array>> = {};
const adtof: { ship: Partial<Record<AdtofClass, AdtofEvent[]>>; low: Partial<Record<AdtofClass, AdtofEvent[]>> } = { ship: {}, low: {} };
if (!skipAdtof) {
	console.error('adtof');
	const model = await Adtof.create();
	if (!model) throw new Error('ADTOF model is unavailable (set MV_MODEL_DIR).');
	const probe: { activations?: Float32Array } = {};
	try {
		await model.run(wide.mono, probe);
	} finally {
		await model.close();
	}
	const act = probe.activations!;
	const frames = act.length / ADTOF_CLASSES.length;
	ADTOF_CLASSES.forEach((name, c) => {
		const raw = Float32Array.from({ length: frames }, (_, t) => act[t * ADTOF_CLASSES.length + c]);
		adtofRaw[name] = raw;
		const events = (threshold: number): AdtofEvent[] => {
			const stream = activationStream(raw, threshold);
			return stream.times
				.map((time, i) => {
					const f = Math.round(time * ADTOF_FPS);
					return { time: r(time, 3), height: r(stream.curve[f], 3), activation: r(raw[f], 3), level: r(stream.levels[i], 3) };
				})
				.filter((e) => inSpan(e.time));
		};
		adtof.ship[name] = events(ADTOF_THRESHOLDS[c]);
		adtof.low[name] = events(ADTOF_LOW);
	});
}

// (e) what the cached analysis says about the span.
const barTimes = analysis.tempo.barTimes;
const barOf = (t: number) => {
	let b = 0;
	while (b < barTimes.length - 2 && barTimes[b + 1] <= t) b++;
	return b;
};
const beatsInSpan = analysis.beats
	.map((t, i) => ({ index: i, time: t, energy: analysis.envelopes.energy[i] ?? null }))
	.filter((b) => inSpan(b.time));
const cachedOnsets = Object.fromEntries(
	KIT.map((kind) => [
		kind,
		analysis.onsets[kind].times
			.map((time, i) => ({ time, level: analysis.onsets[kind].levels[i] }))
			.filter((e) => inSpan(e.time))
	])
) as Record<Kit, { time: number; level: number }[]>;
const barsInSpan = barTimes
	.slice(0, -1)
	.map((t, b) => ({ bar: b, start: t, end: barTimes[b + 1] }))
	.filter((b) => b.end > from && b.start < to);
const sectionsInSpan = analysis.sections
	.filter((s) => s.endTime > from && s.startTime < to)
	.map((s) => ({ index: s.index, kind: s.kind, startBar: s.startBar, endBar: s.endBar, startTime: s.startTime, endTime: s.endTime, meanEnergy: s.meanEnergy }));

// (f) 30-band spectral snapshots on the 44.1 kHz mono around the span.
console.error('spectral snapshots');
const snapFrom = Math.max(0, Math.floor((from - 0.3) * ADTOF_FPS));
const snapTo = Math.min(Math.floor(wide.mono.length / SNAP_HOP), Math.ceil((to + 1.5) * ADTOF_FPS));
const snapFrames = Math.max(0, snapTo - snapFrom);
const binHz = SNAP_RATE / SNAP_FFT;
const bins = SNAP_FFT / 2 + 1;
const bandEdges = Array.from({ length: SNAP_BANDS + 1 }, (_, k) => SNAP_LO_HZ * Math.pow(SNAP_HI_HZ / SNAP_LO_HZ, k / SNAP_BANDS));
const bandCentre = Array.from({ length: SNAP_BANDS }, (_, k) => Math.round(Math.sqrt(bandEdges[k] * bandEdges[k + 1])));
const bandOfBin = new Int32Array(bins).fill(-1);
for (let k = 1; k < bins; k++) {
	const hz = k * binHz;
	for (let b = 0; b < SNAP_BANDS; b++) if (hz >= bandEdges[b] && hz < bandEdges[b + 1]) bandOfBin[k] = b;
}
const snapBand = new Float32Array(snapFrames * SNAP_BANDS);
const snapTotal = new Float32Array(snapFrames);
const snapLow = new Float32Array(snapFrames);
const snapMid = new Float32Array(snapFrames);
const snapHigh = new Float32Array(snapFrames);
const snapAir = new Float32Array(snapFrames);
const snapCentroid = new Float32Array(snapFrames);
{
	const fft = new RealFft(SNAP_FFT);
	const window = hannWindow(SNAP_FFT);
	const mags = new Float32Array(fft.bins);
	for (let i = 0; i < snapFrames; i++) {
		const f = snapFrom + i;
		fft.magnitudes(wide.mono, f * SNAP_HOP - SNAP_FFT / 2, window, mags, 2 / SNAP_FFT);
		let total = 0, low = 0, mid = 0, high = 0, air = 0, moment = 0;
		for (let k = 1; k < bins; k++) {
			const p = mags[k] * mags[k];
			const hz = k * binHz;
			total += p;
			moment += p * hz;
			if (hz < LOW_HZ) low += p;
			else if (hz < MID_HZ) mid += p;
			else high += p;
			if (hz >= AIR_HZ) air += p;
			const b = bandOfBin[k];
			if (b >= 0) snapBand[i * SNAP_BANDS + b] += p;
		}
		snapTotal[i] = total;
		snapLow[i] = low;
		snapMid[i] = mid;
		snapHigh[i] = high;
		snapAir[i] = air;
		snapCentroid[i] = total > 0 ? moment / total : 0;
	}
}

function decayFrames(curve: Float32Array, p: number): number | null {
	const limit = dB(curve[p]) - DECAY_DB;
	for (let q = p + 1; q < Math.min(curve.length, p + DECAY_CAP_FRAMES + 1); q++) {
		if (dB(curve[q]) <= limit) return q - p;
	}
	return null;
}

function guessShape(s: Omit<Snapshot, 'guess'>): string {
	if (s.riseDb < 1) return 'none';
	if (s.riseLowFrac > 0.6 && s.riseCentroidHz < 250) return 'kick';
	if (s.riseHighFrac > 0.75 && s.riseCentroidHz > 3000) {
		return s.decayAirMs !== null && s.decayAirMs <= 100 ? 'hat' : 'cymbal';
	}
	if (s.riseLowFrac < 0.5 && s.riseCentroidHz >= 400 && s.riseCentroidHz <= 4000 && s.riseMidDb > 3 && s.riseHighDb > 3) {
		return 'snare-like';
	}
	if (s.riseCentroidHz < 1500) return 'chord/bass';
	return 'other';
}

function snapshot(t: number): Snapshot {
	const f0 = Math.round(t * ADTOF_FPS) - snapFrom;
	let p = Math.max(0, Math.min(snapFrames - 1, f0));
	for (let f = Math.max(0, f0 - 1); f <= Math.min(snapFrames - 1, f0 + 3); f++) if (snapTotal[f] > snapTotal[p]) p = f;
	const before = (curve: Float32Array) => mean(curve, p - RISE_BEFORE[0], p - RISE_BEFORE[1] + 1);
	const bTotal = before(snapTotal), bLow = before(snapLow), bMid = before(snapMid), bHigh = before(snapHigh), bAir = before(snapAir);
	const dLow = Math.max(0, snapLow[p] - bLow), dMid = Math.max(0, snapMid[p] - bMid), dHigh = Math.max(0, snapHigh[p] - bHigh);
	const dTotal = dLow + dMid + dHigh || 1;
	const bandDb: number[] = [], riseBandDb: number[] = [];
	let riseMoment = 0, riseMass = 0;
	for (let b = 0; b < SNAP_BANDS; b++) {
		const now = snapBand[p * SNAP_BANDS + b];
		let prev = 0;
		for (let f = p - RISE_BEFORE[0]; f <= p - RISE_BEFORE[1]; f++) if (f >= 0) prev += snapBand[f * SNAP_BANDS + b];
		prev /= RISE_BEFORE[0] - RISE_BEFORE[1] + 1;
		bandDb.push(r(dB(now), 1));
		riseBandDb.push(r(dB(now) - dB(prev), 1));
		const d = Math.max(0, now - prev);
		riseMoment += d * bandCentre[b];
		riseMass += d;
	}
	const total = snapTotal[p] || 1;
	const partial = {
		peakTime: r((p + snapFrom) / ADTOF_FPS, 3),
		rmsDb: r(rmsDbAt(t), 1),
		momentaryLufs: r(momentaryAt(t + 0.05), 1),
		totalDb: r(dB(snapTotal[p]), 1),
		riseDb: r(dB(snapTotal[p]) - dB(bTotal), 1),
		centroidHz: Math.round(snapCentroid[p]),
		lowFrac: r(snapLow[p] / total),
		midFrac: r(snapMid[p] / total),
		highFrac: r(snapHigh[p] / total),
		airFrac: r(snapAir[p] / total),
		riseLowDb: r(dB(snapLow[p]) - dB(bLow), 1),
		riseMidDb: r(dB(snapMid[p]) - dB(bMid), 1),
		riseHighDb: r(dB(snapHigh[p]) - dB(bHigh), 1),
		riseAirDb: r(dB(snapAir[p]) - dB(bAir), 1),
		riseLowFrac: r(dLow / dTotal),
		riseMidFrac: r(dMid / dTotal),
		riseHighFrac: r(dHigh / dTotal),
		riseCentroidHz: riseMass > 0 ? Math.round(riseMoment / riseMass) : 0,
		decayMs: decayFrames(snapTotal, p) === null ? null : decayFrames(snapTotal, p)! * 10,
		decayHighMs: decayFrames(snapHigh, p) === null ? null : decayFrames(snapHigh, p)! * 10,
		decayAirMs: decayFrames(snapAir, p) === null ? null : decayFrames(snapAir, p)! * 10,
		bandDb,
		riseBandDb
	};
	return { ...partial, guess: guessShape(partial) };
}

// Merge every detector's marks within 20 ms into one attack candidate, then characterise it.
const marks: SourceMark[] = [];
for (const p of odfPeaks) marks.push({ time: p.time, source: 'odf', detail: { height: p.height } });
for (const kind of KIT) for (const e of dspEvents[kind]) marks.push({ time: e.time, source: `dsp:${kind}`, detail: { level: e.level } });
for (const name of ADTOF_CLASSES) {
	const ship = adtof.ship[name] ?? [];
	const low = adtof.low[name] ?? [];
	for (const e of ship) marks.push({ time: e.time, source: `adtof:${name}`, detail: { height: e.height, activation: e.activation, level: e.level } });
	for (const e of low) {
		if (ship.some((s) => Math.abs(s.time - e.time) < 0.015)) continue;
		marks.push({ time: e.time, source: `adtof~${name}`, detail: { height: e.height, activation: e.activation } });
	}
}
for (const kind of KIT) for (const e of cachedOnsets[kind]) marks.push({ time: e.time, source: `cached:${kind}`, detail: { level: e.level } });
marks.sort((a, b) => a.time - b.time);

interface Candidate {
	time: number;
	sources: SourceMark[];
	bar: number;
	beatOffset: number;
	snapshot: Snapshot;
}
const candidates: Candidate[] = [];
let group: SourceMark[] = [];
const flush = () => {
	if (group.length === 0) return;
	const times = group.map((m) => m.time).sort((a, b) => a - b);
	const time = r(times[Math.floor(times.length / 2)], 3);
	const bar = barOf(time);
	const beatPeriod = analysis.tempo.beatPeriod;
	candidates.push({
		time,
		sources: group,
		bar,
		beatOffset: r((time - barTimes[bar]) / beatPeriod, 2),
		snapshot: snapshot(time)
	});
	group = [];
};
for (const m of marks) {
	if (group.length > 0 && (m.time - group[group.length - 1].time > MERGE_SEC || m.time - group[0].time > 2 * MERGE_SEC)) flush();
	group.push(m);
}
flush();

// Timeline curves on the exact 10 ms grid.
const n = Math.round((to - from) * HOP_FPS) + 1;
const gridTime = Array.from({ length: n }, (_, i) => r(from + i * HOP_SEC, 2));
const sampleCurve = (curve: ArrayLike<number> | undefined, fps: number) =>
	curve ? gridTime.map((t) => r(curve[Math.min(curve.length - 1, Math.max(0, Math.round(t * fps)))] ?? 0, 3)) : [];
const curves = {
	fps: HOP_FPS,
	time: gridTime,
	rmsDb: gridTime.map((t) => r(rmsDbAt(t), 1)),
	momentaryLufs: gridTime.map((t) => r(momentaryAt(t), 1)),
	odf: sampleCurve(features.odf, odfFps),
	rawFlux: sampleCurve(features.curves.flux, odfFps),
	dsp: Object.fromEntries(KIT.map((k) => [k, sampleCurve(dspDrums[k].curve, dspDrums[k].fps)])) as Record<Kit, number[]>,
	adtof: Object.fromEntries(ADTOF_CLASSES.map((c) => [c, sampleCurve(adtofRaw[c], ADTOF_FPS)])) as Record<AdtofClass, number[]>
};

// Per beat and per bar loudness so within-bar rises and falls read off directly.
const beatRows = beatsInSpan.map((b, i) => {
	const next = analysis.beats[b.index + 1] ?? b.time + analysis.tempo.beatPeriod;
	const h0 = Math.round(b.time * HOP_FPS), h1 = Math.round(next * HOP_FPS);
	const bar = barOf(b.time);
	const rmsMean = dB(mean(rawPower, h0, h1));
	let rmsMax = -Infinity, rmsMin = Infinity;
	for (let h = h0; h < h1; h++) {
		const v = rmsDbAt(h / HOP_FPS);
		if (v > rmsMax) rmsMax = v;
		if (v < rmsMin) rmsMin = v;
	}
	return {
		beat: b.index,
		bar,
		beatInBar: Math.round((b.time - barTimes[bar]) / analysis.tempo.beatPeriod),
		time: r(b.time, 3),
		rmsMeanDb: r(rmsMean, 1),
		rmsMaxDb: r(rmsMax, 1),
		rmsMinDb: r(rmsMin, 1),
		momentaryLufs: r(momentaryAt(next), 1),
		cachedEnergy: b.energy,
		deltaRmsDb: i > 0 ? r(rmsMean - dB(mean(rawPower, Math.round(beatsInSpan[i - 1].time * HOP_FPS), h0)), 1) : null
	};
});
const barRows = barsInSpan.map((b) => {
	const h0 = Math.round(Math.max(from, b.start) * HOP_FPS), h1 = Math.round(Math.min(to, b.end) * HOP_FPS);
	let rmsMax = -Infinity, rmsMin = Infinity, momMax = -Infinity, momMin = Infinity;
	let rise = 0, fall = 0, low = Infinity, high = -Infinity;
	for (let h = h0; h < h1; h++) {
		const v = rmsDbAt(h / HOP_FPS);
		const m = momentaryAt(h / HOP_FPS);
		if (v > rmsMax) rmsMax = v;
		if (v < rmsMin) rmsMin = v;
		if (m > momMax) momMax = m;
		if (m < momMin) momMin = m;
		if (v - low > rise) rise = v - low;
		if (high - v > fall) fall = high - v;
		if (v < low) low = v;
		if (v > high) high = v;
	}
	const row = analysis.bars[b.bar];
	const count = (kind: Kit) => cachedOnsets[kind].filter((e) => e.time >= b.start && e.time < b.end).length;
	return {
		bar: b.bar,
		start: r(b.start, 3),
		end: r(b.end, 3),
		section: row?.section ?? null,
		cachedEnergy: row?.energy ?? null,
		rmsMeanDb: r(dB(mean(rawPower, h0, h1)), 1),
		rmsMinDb: r(rmsMin, 1),
		rmsMaxDb: r(rmsMax, 1),
		momentaryMinLufs: r(momMin, 1),
		momentaryMaxLufs: r(momMax, 1),
		largestRiseDb: r(rise, 1),
		largestFallDb: r(fall, 1),
		cachedKicks: count('kick'),
		cachedSnares: count('snare'),
		cachedHats: count('hat')
	};
});

const report = {
	id,
	title: analysis.title,
	audio: audioFile,
	span: { from, to },
	rates: { dsp: dsp.sampleRate, adtof: SNAP_RATE, odfFps: r(odfFps, 3), hopFps: HOP_FPS },
	loudness: {
		cachedIntegratedLufs: analysis.integratedLufs,
		measuredIntegratedLufs: r(loudness.integrated, 2),
		dspGain: r(gain, 3),
		rmsWindowSec: (2 * RMS_RADIUS + 1) * HOP_SEC,
		momentaryWindowSec: MOMENTARY_HOPS * HOP_SEC
	},
	grid: { bpm: analysis.tempo.bpm, beatPeriod: analysis.tempo.beatPeriod, beatsPerBar: analysis.tempo.beatsPerBar },
	sections: sectionsInSpan,
	bars: barRows,
	beats: beatRows,
	odfPick: ODF_PICK,
	odfPeaks,
	dsp: dspEvents,
	adtof: { thresholds: Object.fromEntries(ADTOF_CLASSES.map((c, i) => [c, ADTOF_THRESHOLDS[i]])), lowThreshold: ADTOF_LOW, ...adtof },
	cached: { onsets: cachedOnsets, beats: beatsInSpan.map((b) => ({ index: b.index, time: b.time, energy: b.energy })) },
	snapshotBands: { edgesHz: bandEdges.map((h) => Math.round(h)), centreHz: bandCentre, regions: { lowHz: LOW_HZ, midHz: MID_HZ, airHz: AIR_HZ } },
	candidates,
	curves
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${id}.json`), JSON.stringify(report));

// Markdown timeline.
const fmt = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(digits));
const detailOf = (m: SourceMark) => {
	const d = m.detail;
	if (d.height !== undefined && d.activation !== undefined) return `h${d.height.toFixed(2)}/a${d.activation.toFixed(2)}`;
	if (d.height !== undefined) return d.height.toFixed(2);
	return (d.level ?? 0).toFixed(2);
};
const lines: string[] = [];
lines.push(`# ${analysis.title} (${id}) audibility, ${from}-${to} s`);
lines.push('');
lines.push(`Audio ${audioFile}, DSP rate ${dsp.sampleRate} Hz (gain x${gain.toFixed(2)} to -14 LUFS for odf/DSP drums), ADTOF and snapshots at ${SNAP_RATE} Hz.`);
lines.push(`Integrated loudness: cached ${analysis.integratedLufs} LUFS, measured ${loudness.integrated.toFixed(1)} LUFS. Grid ${analysis.tempo.bpm} bpm, beat ${analysis.tempo.beatPeriod} s, ${analysis.tempo.beatsPerBar}/4.`);
lines.push(`RMS: 50 ms centred, dBFS of the raw mono. Momentary: trailing 400 ms K-weighted, LUFS. odf: conditioned SuperFlux (98th percentile = 1). ADTOF columns show raw activation. DSP columns show the detector curves (excess above floor, 0..1).`);
lines.push('');
lines.push('## Sections in span');
lines.push('');
lines.push('| section | kind | bars | time | mean energy |');
lines.push('|---|---|---|---|---|');
for (const s of sectionsInSpan) lines.push(`| ${s.index} | ${s.kind} | ${s.startBar}-${s.endBar} | ${s.startTime.toFixed(2)}-${s.endTime.toFixed(2)} | ${s.meanEnergy} |`);
lines.push('');
lines.push('## Bars');
lines.push('');
lines.push('| bar | section | start-end | rms mean/min/max dB | momentary min/max LUFS | largest rise / fall dB | cached energy | cached k/s/h |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const b of barRows) {
	lines.push(`| ${b.bar} | ${b.section ?? '-'} | ${b.start.toFixed(2)}-${b.end.toFixed(2)} | ${fmt(b.rmsMeanDb)} / ${fmt(b.rmsMinDb)} / ${fmt(b.rmsMaxDb)} | ${fmt(b.momentaryMinLufs)} / ${fmt(b.momentaryMaxLufs)} | ${fmt(b.largestRiseDb)} / ${fmt(b.largestFallDb)} | ${b.cachedEnergy ?? '-'} | ${b.cachedKicks}/${b.cachedSnares}/${b.cachedHats} |`);
}
lines.push('');
lines.push('## Beats');
lines.push('');
lines.push('| beat | bar.beat | t | rms mean dB | rms min/max dB | d rms vs prev beat | momentary at end LUFS | cached energy |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const b of beatRows) {
	lines.push(`| ${b.beat} | ${b.bar}.${b.beatInBar} | ${b.time.toFixed(2)} | ${fmt(b.rmsMeanDb)} | ${fmt(b.rmsMinDb)} / ${fmt(b.rmsMaxDb)} | ${fmt(b.deltaRmsDb)} | ${fmt(b.momentaryLufs)} | ${b.cachedEnergy ?? '-'} |`);
}
lines.push('');
lines.push('## Attack candidates');
lines.push('');
lines.push('One row per merged event (sources within 20 ms). `adtof:` passed the shipping threshold, `adtof~` only the lowered 0.10 one; h = picker height, a = raw activation. Fractions are of linear power at the energy peak; rise columns compare the peak frame with the 30-60 ms before it. Decay is time to -10 dB of the peak (broadband / >2 kHz / >6 kHz), capped at 1000 ms. `guess` is a coarse heuristic, not a verdict.');
lines.push('');
lines.push('| t | bar+beat | sources | rms dB | mom LUFS | rise dB | centroid Hz | low/mid/high % | rise low/mid/high/air dB | rise centroid Hz | decay all/high/air ms | guess |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of candidates) {
	const s = c.snapshot;
	const sources = c.sources.map((m) => `${m.source}(${detailOf(m)})`).join(' ');
	lines.push(`| ${c.time.toFixed(3)} | ${c.bar}+${c.beatOffset.toFixed(2)} | ${sources} | ${fmt(s.rmsDb)} | ${fmt(s.momentaryLufs)} | ${fmt(s.riseDb)} | ${s.centroidHz} | ${Math.round(s.lowFrac * 100)}/${Math.round(s.midFrac * 100)}/${Math.round(s.highFrac * 100)} | ${fmt(s.riseLowDb)}/${fmt(s.riseMidDb)}/${fmt(s.riseHighDb)}/${fmt(s.riseAirDb)} | ${s.riseCentroidHz} | ${s.decayMs ?? '>1000'}/${s.decayHighMs ?? '>1000'}/${s.decayAirMs ?? '>1000'} | ${s.guess} |`);
}
lines.push('');
lines.push('## Timeline, 100 ms bins');
lines.push('');
lines.push('Each bin reports the maximum of its ten 10 ms samples (momentary: value at the bin end). Grid marks: `|Bn` bar n starts, `.` a beat. Events list candidate sources in the bin.');
lines.push('');
lines.push('| t | rms dB | mom LUFS | odf | ADTOF k/s/t/h/c | DSP k/s/h | grid | events |');
lines.push('|---|---|---|---|---|---|---|---|');
const binCount = Math.ceil((to - from) / 0.1);
for (let b = 0; b < binCount; b++) {
	const t0 = from + b * 0.1;
	const t1 = Math.min(to, t0 + 0.1);
	const i0 = Math.round((t0 - from) * HOP_FPS);
	const i1 = Math.min(n, Math.round((t1 - from) * HOP_FPS));
	if (i1 <= i0) continue;
	const max = (arr: number[]) => (arr.length ? Math.max(...arr.slice(i0, i1)) : NaN);
	const grid: string[] = [];
	for (const bar of barsInSpan) if (bar.start >= t0 && bar.start < t1) grid.push(`|B${bar.bar}`);
	for (const beat of beatsInSpan) if (beat.time >= t0 && beat.time < t1 && !barsInSpan.some((bar) => Math.abs(bar.start - beat.time) < 0.005)) grid.push('.');
	const events = candidates
		.filter((c) => c.time >= t0 && c.time < t1)
		.map((c) => `${c.time.toFixed(2)}: ${c.sources.map((m) => `${m.source}(${detailOf(m)})`).join(' ')}`)
		.join('; ');
	const a = ADTOF_CLASSES.map((c) => (curves.adtof[c].length ? fmt(max(curves.adtof[c]), 2) : '-')).join('/');
	const d = KIT.map((k) => fmt(max(curves.dsp[k]), 2)).join('/');
	lines.push(`| ${t0.toFixed(1)} | ${fmt(max(curves.rmsDb))} | ${fmt(curves.momentaryLufs[i1 - 1])} | ${fmt(max(curves.odf), 2)} | ${a} | ${d} | ${grid.join(' ')} | ${events} |`);
}
lines.push('');
writeFileSync(join(outDir, `${id}.md`), lines.join('\n'));
console.error(`wrote ${join(outDir, id)}.{json,md}: ${candidates.length} candidates`);
