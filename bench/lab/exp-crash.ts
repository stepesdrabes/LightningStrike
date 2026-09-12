// node bench/lab/exp-crash.ts [--tracks=Rock] [--no-library]
// Experiment E: a crash stream from the model's cymbal class. Scores cymbal peaks against CY
// and crash-only labels, fits crash-vs-ride rules on the MIREX 2017 train split, compares
// bar-level crash events with the shipped air-band heuristic and lists library detections.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyzeTrack } from '../../packages/analysis/src/analyze.ts';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import type { Spectrogram } from '../../packages/analysis/src/dsp/spectrogram.ts';
import { benchmarkCache } from '../cache.ts';
import {
	ADTOF_RATE, CHANNEL, activations, beats, classCurve, closeModels, corpus, decodeMix, dirs, div,
	featuresOf, fmt, loadLabels, modelStream, modelStreams, nearestDistance, quantileOf, quantiseInputs,
	read, readF32, runAdtof, score, sha256, writeF32, writeJson, type Labels
} from './mdb.ts';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--tracks='))?.slice(9).split(',').filter(Boolean) ?? [];
const skipLibrary = args.includes('--no-library');

const TRAIN = new Set([
	'MusicDelta_80sRock', 'MusicDelta_BebopJazz', 'MusicDelta_Britpop', 'MusicDelta_CoolJazz',
	'MusicDelta_Disco', 'MusicDelta_FunkJazz', 'MusicDelta_FusionJazz', 'MusicDelta_Reggae',
	'MusicDelta_Rock', 'MusicDelta_Rockabilly', 'MusicDelta_Shadows', 'MusicDelta_Zepplin'
]);
const CRASH_SUBS = new Set(['CRC', 'CHC', 'SPC']);
const RIDE_SUBS = new Set(['RDC', 'RDB']);
const AIR_HZ = 2600;
const SIZZLE_HZ = 6000;
const WINDOW = 0.05;
const COINCIDE = 0.03;
/** Candidate peaks are picked low; the shipped cymbal threshold is 0.30. */
const PICK = 0.2;
const SHIPPED_CYMBAL = 0.3;
const THRESHOLDS = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
const DECAY_CAP_MS = 3000;
const LIBRARY = [
	{ id: '9vWNauaZAgg', title: 'Back in Black' },
	{ id: 'CHIWNDAwTqQ', title: 'Enter Sandman' },
	{ id: 'UARSiWU8eoo', title: 'Desire' }
];
const libraryDir = join(dirs.out, '..', 'library-activations');
const barsDir = join(dirs.lab, 'crash-bars');

const FEATURES = [
	'height', 'raw', 'actWidthMs', 'riseBroadDb', 'riseAirDb', 'airFrac', 'sizzleDb', 'decay10Ms',
	'decay20Ms', 'e300AirDb', 'e300BroadDb', 'sustain200Db', 'sustain500Db', 'kick', 'snare', 'hat',
	'gapBeats', 'gapNext', 'isolation', 'periodicity', 'density', 'onDownbeat', 'beatDist'
] as const;
type FeatureName = typeof FEATURES[number];
type PeakFeatures = Record<FeatureName, number> & { t: number };
interface Peak extends PeakFeatures {
	track: string;
	split: 'train' | 'test';
	label: 'crash' | 'ride' | 'none';
}
interface Curves {
	fps: number;
	air: Float32Array;
	broad: Float32Array;
	airLin: Float32Array;
	broadLin: Float32Array;
	/** 2.6..6 kHz and above 6 kHz, dB. */
	low: Float32Array;
	high: Float32Array;
}
interface Grid {
	beats: ArrayLike<number>;
	bars: ArrayLike<number>;
	period: number;
}
interface Kit {
	kick: readonly number[];
	snare: readonly number[];
	hat: readonly number[];
}
const dB = (x: number) => 20 * Math.log10(Math.max(x, 1e-7));
const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

function bandCurves(spec: Spectrogram): Curves {
	let lo = 0;
	while (lo < spec.bands && spec.centreHz[lo] < AIR_HZ) lo++;
	let mid = lo;
	while (mid < spec.bands && spec.centreHz[mid] < SIZZLE_HZ) mid++;
	const air = new Float32Array(spec.frames);
	const broad = new Float32Array(spec.frames);
	const airLin = new Float32Array(spec.frames);
	const broadLin = new Float32Array(spec.frames);
	const low = new Float32Array(spec.frames);
	const high = new Float32Array(spec.frames);
	for (let f = 0; f < spec.frames; f++) {
		let a = 0;
		let b = 0;
		let h = 0;
		const row = f * spec.bands;
		for (let j = 0; j < spec.bands; j++) {
			const m = spec.mag[row + j];
			b += m;
			if (j >= lo) a += m;
			if (j >= mid) h += m;
		}
		airLin[f] = a;
		broadLin[f] = b;
		air[f] = dB(a);
		broad[f] = dB(b);
		low[f] = dB(a - h);
		high[f] = dB(h);
	}
	return { fps: spec.fps, air, broad, airLin, broadLin, low, high };
}
function nearestIn(sorted: ArrayLike<number>, t: number): number {
	if (sorted.length === 0) return Infinity;
	let lo = 0;
	let hi = sorted.length - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] <= t) lo = mid;
		else hi = mid;
	}
	return Math.min(Math.abs(sorted[lo] - t), Math.abs(sorted[hi] - t));
}

function beatSlot(t: number, grid: ArrayLike<number>, period: number): number {
	let k = -1;
	let lo = 0;
	let hi = grid.length - 1;
	if (grid.length > 0 && grid[0] <= t) {
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (grid[mid] <= t) lo = mid;
			else hi = mid;
		}
		k = grid[hi] <= t ? hi : lo;
	}
	const start = k >= 0 ? grid[k] : grid.length > 0 ? grid[0] : 0;
	const interval = k >= 0 && k + 1 < grid.length ? grid[k + 1] - grid[k] : period;
	const phase = ((t - start) / interval) % 1;
	return Math.round((phase < 0 ? phase + 1 : phase) * 4) % 4;
}

function peakFeatures(
	times: readonly number[],
	heights: readonly number[],
	raws: readonly number[],
	rawCurve: Float32Array,
	c: Curves,
	grid: Grid,
	kit: Kit
): PeakFeatures[] {
	const n = c.air.length;
	const period = grid.period;
	const slots = times.map((t) => beatSlot(t, grid.beats, period));
	const widthMs = (t: number) => {
		const f0 = Math.round(t * 100);
		const half = 0.5 * rawCurve[f0];
		let a = f0;
		let b = f0;
		while (a > 0 && rawCurve[a - 1] >= half) a--;
		while (b + 1 < rawCurve.length && rawCurve[b + 1] >= half) b++;
		return (b - a + 1) * 10;
	};
	const capFrames = Math.round((DECAY_CAP_MS / 1000) * c.fps);
	const decayMs = (p: number, drop: number) => {
		const limit = c.air[p] - drop;
		for (let q = p + 1; q < Math.min(n, p + capFrames + 1); q++) {
			if (c.air[q] <= limit) return ((q - p) / c.fps) * 1000;
		}
		return DECAY_CAP_MS;
	};
	return times.map((t, i) => {
		const p0 = Math.round(t * c.fps);
		let p = Math.max(0, Math.min(n - 1, p0));
		for (let f = Math.max(0, p0 - 1); f <= Math.min(n - 1, p0 + 3); f++) if (c.air[f] > c.air[p]) p = f;
		let airB = 0;
		let broadB = 0;
		let airLinB = 0;
		let broadLinB = 0;
		let lowB = 0;
		let highB = 0;
		let count = 0;
		for (let f = Math.max(0, p - 6); f <= Math.max(0, p - 3); f++) {
			airB += c.air[f];
			broadB += c.broad[f];
			airLinB += c.airLin[f];
			broadLinB += c.broadLin[f];
			lowB += c.low[f];
			highB += c.high[f];
			count++;
		}
		airB /= count;
		broadB /= count;
		airLinB /= count;
		broadLinB /= count;
		lowB /= count;
		highB /= count;
		const at200 = Math.min(n - 1, p + Math.round(0.2 * c.fps));
		const at500 = Math.min(n - 1, p + Math.round(0.5 * c.fps));
		const gapNext = i + 1 < times.length ? Math.min(8, (times[i + 1] - t) / period) : 8;
		const gapPrev = i > 0 ? Math.min(8, (t - times[i - 1]) / period) : 8;
		const broadRise = c.broadLin[p] - broadLinB;
		const at300 = Math.min(n - 1, p + Math.round(0.3 * c.fps));
		let same = 0;
		let previous = 0;
		for (let j = Math.max(0, i - 8); j < i; j++) {
			previous++;
			if (slots[j] === slots[i]) same++;
		}
		let density = 0;
		for (let j = i - 1; j >= 0 && t - times[j] <= 2 * period; j--) density++;
		return {
			t,
			height: heights[i],
			raw: raws[i],
			actWidthMs: widthMs(t),
			riseBroadDb: c.broad[p] - broadB,
			riseAirDb: c.air[p] - airB,
			airFrac: broadRise > 0 ? Math.min(1, Math.max(0, c.airLin[p] - airLinB) / broadRise) : 0,
			sizzleDb: (c.high[p] - highB) - (c.low[p] - lowB),
			decay10Ms: decayMs(p, 10),
			decay20Ms: decayMs(p, 20),
			e300AirDb: c.air[at300] - c.air[p],
			e300BroadDb: c.broad[at300] - c.broad[p],
			sustain200Db: c.air[at200] - airB,
			sustain500Db: c.air[at500] - airB,
			kick: nearestDistance(kit.kick, t) <= COINCIDE ? 1 : 0,
			snare: nearestDistance(kit.snare, t) <= COINCIDE ? 1 : 0,
			hat: nearestDistance(kit.hat, t) <= COINCIDE ? 1 : 0,
			gapBeats: gapPrev,
			gapNext,
			isolation: Math.min(gapPrev, gapNext),
			periodicity: previous > 0 ? same / previous : 0,
			density,
			onDownbeat: nearestIn(grid.bars, t) <= period / 8 ? 1 : 0,
			beatDist: Math.min(0.5, nearestIn(grid.beats, t) / period)
		};
	});
}

function cymbalPeaks(act: Float32Array, threshold: number) {
	const stream = modelStream(act, 'cymbal', threshold);
	const raw = classCurve(act, CHANNEL.cymbal);
	const frames = stream.times.map((t) => Math.round(t * stream.fps));
	return {
		times: stream.times,
		heights: frames.map((f) => stream.curve[f]),
		raws: frames.map((f) => raw[f])
	};
}

function subclassTimes(labels: Labels, subs: Set<string>): number[] {
	return labels.subclass.filter((row) => subs.has(row.sub)).map((row) => row.time).sort((a, b) => a - b);
}

interface Pool {
	tp: number;
	est: number;
	ref: number;
}
const pool = (): Pool => ({ tp: 0, est: 0, ref: 0 });
const add = (into: Pool, s: { tp: number; est: number; ref: number }) => {
	into.tp += s.tp;
	into.est += s.est;
	into.ref += s.ref;
};
const prfOf = (s: Pool) => {
	const p = div(s.tp, s.est);
	const rr = div(s.tp, s.ref);
	return { p, r: rr, f: div(2 * p * rr, p + rr) };
};
const prfText = (s: Pool) => {
	const x = prfOf(s);
	return `${fmt(x.p)} / ${fmt(x.r)} / ${fmt(x.f)}`;
};

/** Peak-level precision/recall/F on the peak labels, for fast rule search. */
function peakPrf(pred: readonly boolean[], peaks: readonly Peak[], refCount: number) {
	let tp = 0;
	let est = 0;
	for (let i = 0; i < pred.length; i++) {
		if (!pred[i]) continue;
		est++;
		if (peaks[i].label === 'crash') tp++;
	}
	return prfOf({ tp, est, ref: refCount });
}

interface Clause {
	feature: FeatureName;
	dir: '>=' | '<=';
	cut: number;
}
const clauseText = (c: Clause) => `${c.feature} ${c.dir} ${r(c.cut, c.feature.endsWith('Ms') ? 0 : 2)}`;
const passes = (p: PeakFeatures, rule: readonly Clause[]) =>
	rule.every((c) => (c.dir === '>=' ? p[c.feature] >= c.cut : p[c.feature] <= c.cut));
function quantiles(xs: readonly number[], n: number): number[] {
	const s = [...xs].sort((a, b) => a - b);
	const out = new Set<number>();
	for (let i = 1; i < n; i++) out.add(s[Math.floor((i / n) * (s.length - 1))]);
	return [...out];
}

interface Logistic {
	names: readonly FeatureName[];
	mean: number[];
	std: number[];
	w: number[];
	b: number;
}
function fitLogistic(names: readonly FeatureName[], peaks: readonly PeakFeatures[], y: readonly number[], l2 = 1e-3, iters = 5000, lr = 0.05): Logistic {
	const rows = peaks.map((p) => names.map((f) => p[f]));
	const d = names.length;
	const mu = new Array<number>(d).fill(0);
	const sd = new Array<number>(d).fill(0);
	for (const row of rows) for (let k = 0; k < d; k++) mu[k] += row[k] / rows.length;
	for (const row of rows) for (let k = 0; k < d; k++) sd[k] += (row[k] - mu[k]) ** 2 / rows.length;
	for (let k = 0; k < d; k++) sd[k] = Math.sqrt(sd[k]) || 1;
	const z = rows.map((row) => row.map((v, k) => (v - mu[k]) / sd[k]));
	const w = new Array<number>(d).fill(0);
	let b = 0;
	const gw = new Array<number>(d);
	for (let it = 0; it < iters; it++) {
		gw.fill(0);
		let gb = 0;
		for (let i = 0; i < z.length; i++) {
			let s = b;
			for (let k = 0; k < d; k++) s += w[k] * z[i][k];
			const err = 1 / (1 + Math.exp(-s)) - y[i];
			for (let k = 0; k < d; k++) gw[k] += err * z[i][k];
			gb += err;
		}
		for (let k = 0; k < d; k++) w[k] -= lr * (gw[k] / z.length + l2 * w[k]);
		b -= lr * (gb / z.length);
	}
	return { names, mean: mu, std: sd, w, b };
}
function probability(model: Logistic, p: PeakFeatures): number {
	let s = model.b;
	model.names.forEach((f, k) => { s += model.w[k] * ((p[f] - model.mean[k]) / model.std[k]); });
	return 1 / (1 + Math.exp(-s));
}
/** Probability cuts on a training set: best peak-level F, and best recall at P >= 0.8. */
function chooseCuts(probs: readonly number[], peaks: readonly Peak[], refCount: number): { best: number; precise: number } {
	let best = 0.5;
	let bestF = -1;
	let precise = 1;
	let bestR = -1;
	for (const cut of quantiles(probs, 200)) {
		const x = peakPrf(probs.map((v) => v >= cut), peaks, refCount);
		if (x.f > bestF) {
			bestF = x.f;
			best = cut;
		}
		if (x.p >= 0.8 && x.r > bestR) {
			bestR = x.r;
			precise = cut;
		}
	}
	return { best, precise };
}
/** A-priori compact set: spectral sustain, kit coincidence and pattern context, no window-relative gaps. */
const COMPACT: readonly FeatureName[] = ['raw', 'riseAirDb', 'sustain200Db', 'e300AirDb', 'sizzleDb', 'kick', 'hat', 'density', 'onDownbeat'];
const COMPACT_L2 = 1e-2;

interface BarCache {
	barTimes: number[];
	duration: number;
	events: string[][];
}
async function shippedBars(name: string): Promise<BarCache> {
	const path = join(barsDir, `${name}.json`);
	if (existsSync(path)) return read<BarCache>(path);
	const decoded = await decodeMix(name);
	const tracked = await beats(name, { decoded });
	const model = modelStreams(await activations(name));
	const analysis = analyzeTrack({
		mono: decoded.mono, left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate,
		duration: decoded.duration, hash: decoded.hash, trackId: name, title: name,
		beats: tracked?.beats, downbeats: tracked?.downbeats, drums: model
	});
	const cache: BarCache = {
		barTimes: analysis.bars.map((bar) => bar.t), duration: decoded.duration,
		events: analysis.bars.map((bar) => [...bar.events])
	};
	writeJson(path, cache, false);
	return cache;
}
function barsOf(times: readonly number[], barTimes: readonly number[]): Set<number> {
	const out = new Set<number>();
	for (const t of times) {
		let b = -1;
		for (let k = 0; k < barTimes.length && barTimes[k] <= t; k++) b = k;
		if (b >= 0) out.add(b);
	}
	return out;
}

interface TrackData {
	name: string;
	split: 'train' | 'test';
	labels: Labels;
	crashRefs: number[];
	rideRefs: number[];
	act: Float32Array;
	peaks: Peak[];
	bars: BarCache;
}

const started = performance.now();
const tracks: TrackData[] = [];
const md: string[] = [];
const out: Record<string, unknown> = {};

for (const t of corpus(only)) {
	const at = performance.now();
	const labels = loadLabels(t.name);
	const crashRefs = subclassTimes(labels, CRASH_SUBS);
	const rideRefs = subclassTimes(labels, RIDE_SUBS);
	const act = await activations(t.name);
	const q = await quantiseInputs(t.name);
	const feats = featuresOf(await decodeMix(t.name));
	const curves = bandCurves(feats.spec);
	const kit = modelStreams(act);
	const picked = cymbalPeaks(act, PICK);
	const split = TRAIN.has(t.name) ? 'train' : 'test';
	const peaks = peakFeatures(picked.times, picked.heights, picked.raws, classCurve(act, CHANNEL.cymbal), curves,
		{ beats: q.beats, bars: q.barTimes, period: q.beatPeriod },
		{ kick: kit.kick.times, snare: kit.snare.times, hat: kit.hat.times }).map((p): Peak => ({
		...p, track: t.name, split,
		label: nearestDistance(crashRefs, p.t) <= WINDOW ? 'crash'
			: nearestDistance(rideRefs, p.t) <= WINDOW ? 'ride' : 'none'
	}));
	const bars = await shippedBars(t.name);
	tracks.push({ name: t.name, split, labels, crashRefs, rideRefs, act, peaks, bars });
	console.log(`${t.name} (${split}): ${peaks.length} peaks at ${PICK}, CY ${labels.cymbal.length}, crash ${crashRefs.length}, ride ${rideRefs.length}, ${((performance.now() - at) / 1000).toFixed(1)}s`);
}

md.push('# crash', '', `${tracks.length} tracks, ${new Date().toISOString()}. Window +-${WINDOW * 1000} ms, Hopcroft-Karp matching. Crash-like labels: CRC, CHC, SPC; ride-like: RDC, RDB.`, '');

// 1. Model cymbal peaks against every CY label and against crash-only labels.
md.push('## 1. Model cymbal peaks by threshold', '', '| threshold | peaks | on ride | vs CY P / R / F | vs crash P / R / F (all) | vs crash P / R / F (test) | crash P / R / F (train) |', '|---:|---:|---:|---|---|---|---|');
const thresholdRows: Record<string, unknown>[] = [];
for (const thr of THRESHOLDS) {
	const cy = pool();
	const crash = pool();
	const crashTest = pool();
	const crashTrain = pool();
	let est = 0;
	let onRide = 0;
	for (const tr of tracks) {
		const times = modelStream(tr.act, 'cymbal', thr).times;
		est += times.length;
		onRide += score(tr.rideRefs, times, WINDOW).tp;
		add(cy, score(tr.labels.cymbal, times, WINDOW));
		const s = score(tr.crashRefs, times, WINDOW);
		add(crash, s);
		add(tr.split === 'test' ? crashTest : crashTrain, s);
	}
	md.push(`| ${thr.toFixed(2)} | ${est} | ${onRide} | ${prfText(cy)} | ${prfText(crash)} | ${prfText(crashTest)} | ${prfText(crashTrain)} |`);
	thresholdRows.push({ threshold: thr, peaks: est, onRide, cy: prfOf(cy), crash: prfOf(crash), crashTest: prfOf(crashTest), crashTrain: prfOf(crashTrain) });
}
out.thresholds = thresholdRows;
md.push('');

// 2. Crash-vs-ride features and rules.
const all = tracks.flatMap((tr) => tr.peaks);
const train = all.filter((p) => p.split === 'train');
const test = all.filter((p) => p.split === 'test');
const refs = (split: 'train' | 'test' | 'all') => tracks
	.filter((tr) => split === 'all' || tr.split === split)
	.reduce((n, tr) => n + tr.crashRefs.length, 0);
const countBy = (peaks: readonly Peak[]) => ({
	crash: peaks.filter((p) => p.label === 'crash').length,
	ride: peaks.filter((p) => p.label === 'ride').length,
	none: peaks.filter((p) => p.label === 'none').length
});
md.push('## 2. Crash-vs-ride features', '',
	`Candidate peaks at ${PICK}: train ${train.length} (${JSON.stringify(countBy(train))}, crash labels ${refs('train')}), `
	+ `test ${test.length} (${JSON.stringify(countBy(test))}, crash labels ${refs('test')}).`, '',
	'Feature medians (train), with the 10th and 90th percentiles:', '',
	'| feature | crash | ride | none |', '|---|---|---|---|');
const q = (xs: number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0;
};
for (const f of FEATURES) {
	const cell = (label: Peak['label']) => {
		const xs = train.filter((p) => p.label === label).map((p) => p[f]);
		return `${r(q(xs, 0.5), 2)} (${r(q(xs, 0.1), 2)} .. ${r(q(xs, 0.9), 2)})`;
	};
	md.push(`| ${f} | ${cell('crash')} | ${cell('ride')} | ${cell('none')} |`);
}
md.push('');

/** Matched (50 ms) crash P/R/F of the peaks a predicate keeps, pooled per split. */
function matchedPrf(keep: (p: Peak) => boolean) {
	const pools = { train: pool(), test: pool(), all: pool() };
	for (const tr of tracks) {
		const times = tr.peaks.filter(keep).map((p) => p.t);
		const s = score(tr.crashRefs, times, WINDOW);
		add(pools[tr.split], s);
		add(pools.all, s);
	}
	return { train: prfOf(pools.train), test: prfOf(pools.test), all: prfOf(pools.all) };
}
const prfLine = (x: { p: number; r: number; f: number }) => `${fmt(x.p)} / ${fmt(x.r)} / ${fmt(x.f)}`;

const trainRefs = refs('train');
const rules: { name: string; clauses: Clause[]; trainF: number }[] = [];
for (const f of FEATURES) {
	const cuts = quantiles(train.map((p) => p[f]), 40);
	for (const dir of ['>=', '<='] as const) {
		let best: { f: number; cut: number } | null = null;
		for (const cut of cuts) {
			const rule: Clause[] = [{ feature: f, dir, cut }];
			const x = peakPrf(train.map((p) => passes(p, rule)), train, trainRefs);
			if (!best || x.f > best.f) best = { f: x.f, cut };
		}
		if (best) rules.push({ name: `${f} ${dir}`, clauses: [{ feature: f, dir, cut: best.cut }], trainF: best.f });
	}
}
rules.sort((a, b) => b.trainF - a.trainF);
md.push('Best single-feature cut per feature (train peak-level F), matched P / R / F:', '', '| rule | train | test |', '|---|---|---|');
for (const rule of rules.slice(0, 10)) {
	const x = matchedPrf((p) => passes(p, rule.clauses));
	md.push(`| ${rule.clauses.map(clauseText).join(' and ')} | ${prfLine(x.train)} | ${prfLine(x.test)} |`);
}
md.push('');

let pairs: { clauses: Clause[]; trainF: number; trainP: number; trainR: number }[] = [];
const cutsOf = Object.fromEntries(FEATURES.map((f) => [f, quantiles(train.map((p) => p[f]), 24)])) as Record<FeatureName, number[]>;
const trainCols = Object.fromEntries(FEATURES.map((f) => [f, train.map((p) => p[f])])) as Record<FeatureName, number[]>;
const trainCrash = train.map((p) => p.label === 'crash');
for (let a = 0; a < FEATURES.length; a++) {
	for (let b = a + 1; b < FEATURES.length; b++) {
		const fa = FEATURES[a];
		const fb = FEATURES[b];
		for (const da of ['>=', '<='] as const) {
			for (const db of ['>=', '<='] as const) {
				for (const ca of cutsOf[fa]) {
					const maskA = trainCols[fa].map((v) => (da === '>=' ? v >= ca : v <= ca));
					for (const cb of cutsOf[fb]) {
						let tp = 0;
						let est = 0;
						for (let i = 0; i < train.length; i++) {
							if (!maskA[i]) continue;
							const v = trainCols[fb][i];
							if (db === '>=' ? v >= cb : v <= cb) {
								est++;
								if (trainCrash[i]) tp++;
							}
						}
						const p = div(tp, est);
						const rr = div(tp, trainRefs);
						const f = div(2 * p * rr, p + rr);
						pairs.push({ clauses: [{ feature: fa, dir: da, cut: ca }, { feature: fb, dir: db, cut: cb }], trainF: f, trainP: p, trainR: rr });
					}
				}
			}
		}
	}
}
pairs.sort((a, b) => b.trainF - a.trainF);
const seen = new Set<string>();
const unique = pairs.filter((x) => {
	const key = x.clauses.map(clauseText).join('|');
	if (seen.has(key)) return false;
	seen.add(key);
	return true;
});
pairs = unique;
md.push('Best two-clause rules (train peak-level F), matched P / R / F:', '', '| rule | train | test |', '|---|---|---|');
for (const rule of pairs.slice(0, 8)) {
	const x = matchedPrf((p) => passes(p, rule.clauses));
	md.push(`| ${rule.clauses.map(clauseText).join(' and ')} | ${prfLine(x.train)} | ${prfLine(x.test)} |`);
}
const precise = pairs.filter((x) => x.trainP >= 0.8).sort((a, b) => b.trainR - a.trainR);
md.push('', 'Two-clause rules with train P >= 0.8, by train recall:', '', '| rule | train | test |', '|---|---|---|');
for (const rule of precise.slice(0, 5)) {
	const x = matchedPrf((p) => passes(p, rule.clauses));
	md.push(`| ${rule.clauses.map(clauseText).join(' and ')} | ${prfLine(x.train)} | ${prfLine(x.test)} |`);
}
md.push('');

const isCrash = (p: Peak) => (p.label === 'crash' ? 1 : 0);
const model = fitLogistic(FEATURES, train, train.map(isCrash));
const trainProb = train.map((p) => probability(model, p));
const cuts = chooseCuts(trainProb, train, trainRefs);
const lrCut = cuts.best;
const lrCutPrecise = cuts.precise;
md.push(`Logistic regression on all ${FEATURES.length} standardised features (train), gradient descent, L2 1e-3:`, '',
	'| feature | weight (z) | weight per unit |', '|---|---:|---:|');
FEATURES.forEach((f, k) => md.push(`| ${f} | ${r(model.w[k], 3)} | ${r(model.w[k] / model.std[k], 4)} |`));
md.push(`| bias | ${r(model.b, 3)} | |`, '', '| probability cut | train | test | all |', '|---|---|---|---|');
for (const [name, cut] of [['0.5', 0.5], [`best train F ${r(lrCut, 3)}`, lrCut], [`train P >= 0.8 ${r(lrCutPrecise, 3)}`, lrCutPrecise]] as const) {
	const x = matchedPrf((p) => probability(model, p) >= cut);
	md.push(`| ${name} | ${prfLine(x.train)} | ${prfLine(x.test)} | ${prfLine(x.all)} |`);
}
md.push('');
const ruleKeep = (p: PeakFeatures) => probability(model, p) >= lrCut;
const simpleRule = pairs[0].clauses;

// Compact model: the MIREX split, then leave-one-track-out over all 23 so every track is scored out of fold.
const compact = fitLogistic(COMPACT, train, train.map(isCrash), COMPACT_L2);
const compactCuts = chooseCuts(train.map((p) => probability(compact, p)), train, trainRefs);
md.push(`Compact logistic regression (${COMPACT.join(', ')}), L2 ${COMPACT_L2}, fitted on the train split:`, '',
	'| feature | weight (z) | weight per unit |', '|---|---:|---:|');
COMPACT.forEach((f, k) => md.push(`| ${f} | ${r(compact.w[k], 3)} | ${r(compact.w[k] / compact.std[k], 4)} |`));
md.push(`| bias | ${r(compact.b, 3)} | |`, '', '| probability cut | train | test | all |', '|---|---|---|---|');
for (const [name, cut] of [['0.5', 0.5], [`best train F ${r(compactCuts.best, 3)}`, compactCuts.best], [`train P >= 0.8 ${r(compactCuts.precise, 3)}`, compactCuts.precise]] as const) {
	const x = matchedPrf((p) => probability(compact, p) >= cut);
	md.push(`| ${name} | ${prfLine(x.train)} | ${prfLine(x.test)} | ${prfLine(x.all)} |`);
}
const oof = new Map<Peak, number>();
const oofCut = new Map<string, { best: number; precise: number }>();
for (const held of tracks) {
	const fold = all.filter((p) => p.track !== held.name);
	const foldRefs = tracks.filter((tr) => tr.name !== held.name).reduce((n, tr) => n + tr.crashRefs.length, 0);
	const m = fitLogistic(COMPACT, fold, fold.map(isCrash), COMPACT_L2);
	oofCut.set(held.name, chooseCuts(fold.map((p) => probability(m, p)), fold, foldRefs));
	for (const p of held.peaks) oof.set(p, probability(m, p));
}
const oofKeep = (which: 'best' | 'precise') => (p: Peak) => (oof.get(p) ?? 0) >= oofCut.get(p.track)![which];
md.push('', 'Leave-one-track-out over all 23 tracks (compact set; cut chosen on the 22 training tracks each fold):', '',
	'| cut | train tracks | test tracks | all |', '|---|---|---|---|');
for (const which of ['best', 'precise'] as const) {
	const x = matchedPrf(oofKeep(which));
	md.push(`| ${which === 'best' ? 'best fold F' : 'fold P >= 0.8'} | ${prfLine(x.train)} | ${prfLine(x.test)} | ${prfLine(x.all)} |`);
}
md.push(`Fold cuts: best ${r(quantileOf([...oofCut.values()].map((c) => c.best), 0.5), 3)} median, precise ${r(quantileOf([...oofCut.values()].map((c) => c.precise), 0.5), 3)} median.`, '');
const compactAll = fitLogistic(COMPACT, all, all.map(isCrash), COMPACT_L2);
const compactAllCut = quantileOf([...oofCut.values()].map((c) => c.best), 0.5);
const compactKeep = (p: PeakFeatures) => probability(compactAll, p) >= compactAllCut;
out.logistic = { ...model, cut: lrCut, cutPrecise: lrCutPrecise };
out.compact = { split: { ...compact, cuts: compactCuts }, all: { ...compactAll, cut: compactAllCut }, folds: Object.fromEntries(oofCut) };
out.simpleRule = simpleRule;
out.rulePrf = {
	logistic: matchedPrf(ruleKeep), simple: matchedPrf((p) => passes(p, simpleRule)),
	compactSplit: matchedPrf((p) => probability(compact, p) >= compactCuts.best),
	compactLoto: matchedPrf(oofKeep('best')), compactLotoPrecise: matchedPrf(oofKeep('precise'))
};

const composition = (keep: (p: Peak) => boolean) => (['train', 'test'] as const).map((split) => {
	const kept = all.filter((p) => p.split === split && keep(p));
	const c = countBy(kept);
	return `${split} kept ${kept.length}: crash ${c.crash}, ride ${c.ride}, none ${c.none}`;
}).join('; ');
md.push(`Kept-peak composition, logistic at best train cut: ${composition(ruleKeep)}.`,
	`Kept-peak composition, compact leave-one-out at best fold cut: ${composition(oofKeep('best'))}.`,
	`Kept-peak composition, every peak at 0.30: ${composition((p) => p.height >= SHIPPED_CYMBAL)}.`, '');
md.push('Per-track crash matched P / R / F: full logistic at its best train cut, and compact leave-one-out at the fold cut:', '', '| track | split | crash refs | peaks | kept full | full P / R / F | kept loto | loto P / R / F |', '|---|---|---:|---:|---:|---|---:|---|');
for (const tr of tracks) {
	const kept = tr.peaks.filter(ruleKeep).map((p) => p.t);
	const s = score(tr.crashRefs, kept, WINDOW);
	const keptLoto = tr.peaks.filter(oofKeep('best')).map((p) => p.t);
	const sl = score(tr.crashRefs, keptLoto, WINDOW);
	md.push(`| ${tr.name.replace('MusicDelta_', '')} | ${tr.split} | ${tr.crashRefs.length} | ${tr.peaks.length} | ${kept.length} | ${tr.crashRefs.length ? prfLine(s) : '-'} | ${keptLoto.length} | ${tr.crashRefs.length ? prfLine(sl) : '-'} |`);
}
md.push('');

// 3. Bar level: label bars vs shipped 'crash' events vs rule detections.
md.push('## 3. Bar-level crash events', '', 'A bar counts when it holds a crash-like label, a shipped `crash` event (analyzeTrack with model drums), any model cymbal peak at 0.30, or a rule-kept peak.', '',
	'| source | split | bars | label bars | hit | P | R |', '|---|---|---:|---:|---:|---:|---:|');
const barPools: Record<string, Record<'train' | 'test' | 'all', { est: number; ref: number; tp: number; bars: number }>> = {};
const sources = ['shipped crash event', 'any cymbal peak 0.30', 'logistic rule', 'simple rule', 'compact loto', 'compact loto P>=0.8'] as const;
for (const src of sources) barPools[src] = { train: { est: 0, ref: 0, tp: 0, bars: 0 }, test: { est: 0, ref: 0, tp: 0, bars: 0 }, all: { est: 0, ref: 0, tp: 0, bars: 0 } };
const barDetail: Record<string, unknown>[] = [];
for (const tr of tracks) {
	const bt = tr.bars.barTimes;
	const label = barsOf(tr.crashRefs, bt);
	const shipped = new Set(tr.bars.events.flatMap((ev, b) => (ev.includes('crash') ? [b] : [])));
	const any = barsOf(modelStream(tr.act, 'cymbal', SHIPPED_CYMBAL).times, bt);
	const logistic = barsOf(tr.peaks.filter(ruleKeep).map((p) => p.t), bt);
	const simple = barsOf(tr.peaks.filter((p) => passes(p, simpleRule)).map((p) => p.t), bt);
	const loto = barsOf(tr.peaks.filter(oofKeep('best')).map((p) => p.t), bt);
	const lotoPrecise = barsOf(tr.peaks.filter(oofKeep('precise')).map((p) => p.t), bt);
	const sets = { 'shipped crash event': shipped, 'any cymbal peak 0.30': any, 'logistic rule': logistic, 'simple rule': simple, 'compact loto': loto, 'compact loto P>=0.8': lotoPrecise };
	for (const src of sources) {
		const est = sets[src];
		const tp = [...est].filter((b) => label.has(b)).length;
		for (const split of [tr.split, 'all'] as const) {
			const pl = barPools[src][split];
			pl.est += est.size;
			pl.ref += label.size;
			pl.tp += tp;
			pl.bars += bt.length;
		}
	}
	barDetail.push({ name: tr.name, bars: bt.length, label: [...label], shipped: [...shipped], logistic: [...logistic], simple: [...simple] });
}
for (const src of sources) {
	for (const split of ['train', 'test', 'all'] as const) {
		const pl = barPools[src][split];
		md.push(`| ${src} | ${split} | ${pl.bars} | ${pl.ref} | ${pl.tp} | ${fmt(div(pl.tp, pl.est))} (${pl.tp}/${pl.est}) | ${fmt(div(pl.tp, pl.ref))} |`);
	}
}
out.bars = { pools: barPools, tracks: barDetail };
md.push('', 'Per track bars (label / shipped / logistic):', '', '| track | bars | label | shipped | logistic |', '|---|---:|---|---|---|');
for (const d of barDetail) {
	md.push(`| ${(d.name as string).replace('MusicDelta_', '')} | ${d.bars} | ${(d.label as number[]).join(' ')} | ${(d.shipped as number[]).join(' ')} | ${(d.logistic as number[]).join(' ')} |`);
}
md.push('');

// 4. Library sanity.
interface LibraryAnalysis {
	title: string;
	duration: number;
	tempo: { beatPeriod: number };
	beats: number[];
	bars: { bar: number; t: number; section: string; events: string[] }[];
	sections: { kind: string; startTime: number }[];
}
async function libraryActivations(id: string, audio: string): Promise<Float32Array> {
	const path = join(libraryDir, `${id}.f32`);
	const metaPath = join(libraryDir, `${id}.json`);
	const audioSha256 = sha256(audio);
	if (existsSync(path) && existsSync(metaPath) && read<{ audioSha256: string }>(metaPath).audioSha256 === audioSha256) {
		return readF32(path);
	}
	const evidence = join(dirs.out, '..', 'model-evidence', `${id}.json`);
	if (existsSync(evidence)) {
		const ev = read<{ activationFile?: string; provenance: { audioSha256?: string; activationFps?: number } }>(evidence);
		if (ev.activationFile && existsSync(ev.activationFile) && ev.provenance.audioSha256 === audioSha256) {
			copyFileSync(ev.activationFile, path);
			writeJson(metaPath, { audioSha256, source: ev.activationFile, fps: ev.provenance.activationFps });
			return readF32(path);
		}
	}
	const wide = await decodeAudio(audio, ADTOF_RATE);
	const run = await runAdtof(wide.mono);
	writeF32(path, run.act);
	writeJson(metaPath, { audioSha256, pcmHash: run.hash, frames: run.act.length / 5, fps: 100, inferenceMs: run.inferenceMs, source: 'adtof' });
	return run.act;
}
if (!skipLibrary) {
	const cache = benchmarkCache();
	md.push('## 4. Library tracks, first 60 s', '');
	const libraryOut: Record<string, unknown> = {};
	for (const { id, title } of LIBRARY) {
		const audio = join(cache, `${id}.m4a`);
		const analysis = read<LibraryAnalysis>(join(cache, `${id}.analysis.json`));
		const act = await libraryActivations(id, audio);
		const decoded = await decodeAudio(audio);
		const curves = bandCurves(featuresOf(decoded).spec);
		const kit = modelStreams(act);
		const picked = cymbalPeaks(act, PICK);
		const feats = peakFeatures(picked.times, picked.heights, picked.raws, classCurve(act, CHANNEL.cymbal), curves,
			{ beats: analysis.beats, bars: analysis.bars.map((b) => b.t), period: analysis.tempo.beatPeriod },
			{ kick: kit.kick.times, snare: kit.snare.times, hat: kit.hat.times });
		const shippedCrash = analysis.bars.filter((b) => b.events.includes('crash')).map((b) => `${b.bar}@${b.t.toFixed(1)}`);
		const sections = analysis.sections.map((s) => `${s.kind}@${s.startTime.toFixed(1)}`);
		const kept = feats.filter(compactKeep);
		md.push(`### ${title} (${id})`, '', `${picked.times.length} cymbal peaks at ${PICK}, ${modelStream(act, 'cymbal', SHIPPED_CYMBAL).times.length} at 0.30, ${kept.length} kept by the compact rule (all-track fit, cut ${r(compactAllCut, 2)}) over ${r(analysis.duration, 0)} s. `
			+ `Shipped crash bars: ${shippedCrash.join(' ') || 'none'}. Sections: ${sections.join(' ')}.`, '',
			'| t | height | raw | width | riseBroad | riseAir | sizzle | decay10 | e300Air | sus200 | sus500 | k/s/h | gap | next | dbeat | full prob | compact prob | kept |',
			'|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|');
		for (const p of feats) {
			if (p.t > 60) break;
			const prob = probability(model, p);
			md.push(`| ${p.t.toFixed(2)} | ${r(p.height, 2)} | ${r(p.raw, 2)} | ${p.actWidthMs} | ${r(p.riseBroadDb, 1)} | ${r(p.riseAirDb, 1)} | ${r(p.sizzleDb, 1)} | ${r(p.decay10Ms, 0)} | ${r(p.e300AirDb, 1)} | ${r(p.sustain200Db, 1)} | ${r(p.sustain500Db, 1)} | ${p.kick}/${p.snare}/${p.hat} | ${r(p.gapBeats, 2)} | ${r(p.gapNext, 2)} | ${p.onDownbeat} | ${r(prob, 2)} | ${r(probability(compactAll, p), 2)} | ${compactKeep(p) ? 'yes' : ''} |`);
		}
		md.push('', `Compact-kept crash times over the whole track: ${kept.map((p) => p.t.toFixed(2)).join(' ') || 'none'}.`, '');
		libraryOut[id] = { title, peaks: feats.map((p) => ({ ...p, prob: r(probability(model, p)), compactProb: r(probability(compactAll, p)), kept: compactKeep(p) })), shippedCrash, sections, kept: kept.map((p) => p.t) };
	}
	out.library = libraryOut;
}

await closeModels();
const seconds = (performance.now() - started) / 1000;
md.push(`Runtime ${seconds.toFixed(1)} s.`, '');
out.peaks = all.map((p) => ({ ...p, prob: r(probability(model, p)), oof: r(oof.get(p) ?? 0) }));
writeJson(join(dirs.lab, 'crash.json'), out);
writeFileSync(join(dirs.lab, 'crash.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
