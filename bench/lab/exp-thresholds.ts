// node bench/lab/exp-thresholds.ts [--tracks=Rock,Disco] [--no-model]
// Experiment A: ADTOF peak thresholds on the MDB full mixes at the model stage. Fixed sweeps per
// class, per-track relative thresholds, DSP-corroborated rescue of sub-threshold peaks, input
// gain variants and test-time augmentation. --no-model skips the sections that need inference.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { activationStream } from '../../packages/analysis/src/adtof.ts';
import type { DrumStream } from '../../packages/analysis/src/drums.ts';
import { snapTimesToOnsets } from '../../packages/analysis/src/drums.ts';
import { measureLoudness } from '../../packages/analysis/src/loudness.ts';
import { quantiseOnsets } from '../../packages/analysis/src/quantise.ts';
import {
	ADTOF_RATE, CHANNEL, KIT, MODEL_FPS, THRESHOLDS, activationRecord, classCurve, closeModels,
	corpus, decodeMix, dirs, div, fmt, loadLabels, mean, nearestDistance, quantileOf, quantiseInputs,
	round3, score, shipRound, signed, writeJson,
	type ClassName, type Kind, type Labels, type QuantiseInputs
} from './mdb.ts';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--tracks='))?.slice(9).split(',').filter(Boolean) ?? [];
const useModel = !args.includes('--no-model');

const ALL: readonly ClassName[] = ['kick', 'snare', 'hat', 'tom', 'cymbal'];
const SWEEP = Array.from({ length: 22 }, (_, i) => round3(0.08 + 0.02 * i));
const LOW = 0.08;
const DRUMLESS_S = 0.5;
const HATLESS = ['MusicDelta_80sRock', 'MusicDelta_Beatles', 'MusicDelta_Shadows'];
const ship = (cls: ClassName) => THRESHOLDS[CHANNEL[cls]];

interface TrackData {
	name: string;
	labels: Labels;
	q: QuantiseInputs;
	acts: Record<string, Float32Array>;
	nativeLufs: number;
}

const peakStream = (act: Float32Array, cls: ClassName, t: number): DrumStream =>
	activationStream(classCurve(act, CHANNEL[cls]), t);
const frameOf = (t: number) => Math.round(t * MODEL_FPS);

interface Agg {
	ref: number;
	est: number;
	tp: number;
	p: number;
	r: number;
	f: number;
	tmF: number;
	tracks: number;
	fpDrumless: number;
	perTrack: Record<string, { ref: number; est: number; tp: number; f: number }>;
}
function aggregate(data: readonly TrackData[], cls: ClassName, est: (d: TrackData) => readonly number[]): Agg {
	let ref = 0;
	let n = 0;
	let tp = 0;
	let fpDrumless = 0;
	const fs: number[] = [];
	const perTrack: Agg['perTrack'] = {};
	for (const d of data) {
		const times = [...est(d)].sort((a, b) => a - b);
		const s = score(d.labels[cls], times);
		ref += s.ref;
		n += s.est;
		tp += s.tp;
		for (let j = 0; j < times.length; j++) {
			if (!s.matched[j] && nearestDistance(d.labels.all, times[j]) > DRUMLESS_S) fpDrumless++;
		}
		if (s.ref > 0) fs.push(s.f);
		perTrack[d.name] = { ref: s.ref, est: s.est, tp: s.tp, f: s.f };
	}
	const p = div(tp, n);
	const r = div(tp, ref);
	return { ref, est: n, tp, p, r, f: div(2 * p * r, p + r), tmF: mean(fs), tracks: fs.length, fpDrumless, perTrack };
}
const prf = (a: Agg) => `${fmt(a.p)}/${fmt(a.r)}/${fmt(a.f)}`;

type Sweep = Record<ClassName, { t: number; agg: Agg }[]>;
function sweep(data: readonly TrackData[], variant: string, classes: readonly ClassName[] = ALL): Sweep {
	const out = {} as Sweep;
	for (const cls of classes) {
		out[cls] = SWEEP.map((t) => ({ t, agg: aggregate(data, cls, (d) => peakStream(d.acts[variant], cls, t).times) }));
	}
	return out;
}
function best(rows: { t: number; agg: Agg }[]): { t: number; agg: Agg } {
	return rows.reduce((a, b) => (b.agg.f > a.agg.f ? b : a));
}
const at = (rows: { t: number; agg: Agg }[], t: number) => rows.find((r) => Math.abs(r.t - t) < 1e-9)!;

function peakHeights(act: Float32Array, cls: ClassName): number[] {
	const s = peakStream(act, cls, LOW);
	return s.times.map((t) => s.curve[frameOf(t)]);
}
function relativeThreshold(act: Float32Array, cls: ClassName, qp: number, k: number, floor: number): number {
	return Math.max(floor, k * quantileOf(peakHeights(act, cls), qp));
}

function dspLocalMax(curve: Float32Array, centre: number, radius: number): number {
	let top = 0;
	for (let i = Math.max(1, centre - radius); i <= Math.min(curve.length - 2, centre + radius); i++) {
		if (curve[i] >= curve[i - 1] && curve[i] >= curve[i + 1] && curve[i] > top) top = curve[i];
	}
	return top;
}
interface Rescue {
	stream: DrumStream;
	candidates: number;
	accepted: number;
}
function rescue(d: TrackData, cls: Kind, low: number, c: number, variant = 'base'): Rescue {
	const act = d.acts[variant];
	const shipped = peakStream(act, cls, ship(cls));
	const lo = peakStream(act, cls, low);
	const have = new Set(shipped.times.map(frameOf));
	const dsp = d.q.dsp[cls].curve;
	const radius = Math.round(0.03 * d.q.fps);
	const times = [...shipped.times];
	let candidates = 0;
	let accepted = 0;
	for (const t of lo.times) {
		const frame = frameOf(t);
		if (have.has(frame) || lo.curve[frame] >= ship(cls)) continue;
		candidates++;
		if (dspLocalMax(dsp, Math.round(t * d.q.fps), radius) >= c) {
			accepted++;
			times.push(t);
		}
	}
	times.sort((a, b) => a - b);
	const levels = times.map((t) => shipped.levelCurve![frameOf(t)]);
	return { stream: { ...shipped, times, levels }, candidates, accepted };
}

function finalTimes(d: TrackData, stream: DrumStream): number[] {
	const snapped = { ...stream, times: snapTimesToOnsets(stream.times, d.q.odf, d.q.fps, d.q.snapRadius) };
	return shipRound(quantiseOnsets(snapped, d.q).times);
}

const dbGain = (db: number) => (pcm: Float32Array) => Float32Array.from(pcm, (v) => v * Math.pow(10, db / 20));
const toLufs = (target: number) => (pcm: Float32Array, sampleRate: number) => {
	const gain = Math.pow(10, (target - measureLoudness(pcm, sampleRate).integrated) / 20);
	const g = Number.isFinite(gain) ? Math.min(gain, 40) : 1;
	return Float32Array.from(pcm, (v) => v * g);
};
const HALF_HOP = 220;
const lag = (pcm: Float32Array) => {
	const out = new Float32Array(pcm.length + HALF_HOP);
	out.set(pcm, HALF_HOP);
	return out;
};
const lead = (pcm: Float32Array) => pcm.slice(HALF_HOP);
const VARIANTS: Record<string, (pcm: Float32Array, sampleRate: number) => Float32Array> = {
	lufs14: toLufs(-14), lufs11: toLufs(-11), lufs17: toLufs(-17),
	gainm3db: dbGain(-3), gainp3db: dbGain(3), lag220: lag, lead220: lead
};
/** Element-wise mean aligned by frame index; a half-hop shift rounds to the same frame. */
function averageActs(acts: readonly Float32Array[]): Float32Array {
	const n = acts[0].length;
	const out = new Float32Array(n);
	for (const act of acts) for (let i = 0; i < n; i++) out[i] += (act[i] ?? 0) / acts.length;
	return out;
}

const table = (header: readonly string[], rows: readonly (readonly (string | number)[])[]): string[] => [
	`| ${header.join(' | ')} |`,
	`|${header.map((h, i) => (i === 0 ? '---' : '---:')).join('|')}|`,
	...rows.map((r) => `| ${r.join(' | ')} |`)
];

const started = performance.now();
const data: TrackData[] = [];
const inference: Record<string, number> = {};
try {
	for (const t of corpus(only)) {
		const labels = loadLabels(t.name);
		const q = await quantiseInputs(t.name);
		const acts: Record<string, Float32Array> = {};
		let nativeLufs = NaN;
		if (useModel) {
			const wide = await decodeMix(t.name, ADTOF_RATE);
			nativeLufs = measureLoudness(wide.mono, ADTOF_RATE).integrated;
			const base = await activationRecord(t.name, { wide });
			acts.base = base.act;
			const ran: string[] = [];
			for (const [variant, transform] of Object.entries(VARIANTS)) {
				const rec = await activationRecord(t.name, { variant, transform, wide });
				acts[variant] = rec.act;
				inference[variant] = (inference[variant] ?? 0) + (rec.cached ? 0 : rec.meta.inferenceMs);
				if (!rec.cached) ran.push(variant);
			}
			acts['tta-gain'] = averageActs([acts.base, acts.gainm3db, acts.gainp3db]);
			acts['tta-shift'] = averageActs([acts.base, acts.lag220, acts.lead220]);
			acts['tta-all'] = averageActs([acts.base, acts.gainm3db, acts.gainp3db, acts.lag220, acts.lead220]);
			console.log(`${t.name}: ${fmt(nativeLufs, 1)} LUFS, base ${base.cached ? 'cached' : 'ran'}`
				+ `${ran.length ? `, ran ${ran.join(' ')}` : ', variants cached'}`);
		} else {
			acts.base = (await activationRecord(t.name)).act;
		}
		data.push({ name: t.name, labels, q, acts, nativeLufs });
	}
} finally {
	await closeModels();
}
console.log(`loaded ${data.length} tracks in ${((performance.now() - started) / 1000).toFixed(1)} s`);

const md: string[] = [];
const json: Record<string, unknown> = { created: new Date().toISOString(), tracks: data.map((d) => d.name) };
md.push('# thresholds', '', `${data.length} MDB full mixes, model stage (ADTOF peaks, no snap or quantise unless `
	+ 'stated). Window +-50 ms, Hopcroft-Karp. FPdl = false positives more than 0.5 s from any annotated onset.', '');

// 1. Fixed sweep.
const base = sweep(data, 'base');
md.push('## 1. Fixed threshold sweep (P/R/F pooled)', '');
md.push(...table(['t', ...ALL], SWEEP.map((t) => [fmt(t, 2), ...ALL.map((cls) => {
	const row = at(base[cls], t);
	const mark = row === best(base[cls]) ? ' *' : Math.abs(t - ship(cls)) < 1e-9 ? ' (ship)' : '';
	return prf(row.agg) + mark;
})])), '');
md.push('Track-mean F and FPdl:', '');
md.push(...table(['t', ...ALL.map((c) => `${c} tmF`), ...ALL.map((c) => `${c} FPdl`)], SWEEP.map((t) =>
	[fmt(t, 2), ...ALL.map((cls) => fmt(at(base[cls], t).agg.tmF)), ...ALL.map((cls) => at(base[cls], t).agg.fpDrumless)])), '');
md.push('F-optimal per class:', '');
md.push(...table(['class', 'ship t', 'F@ship', 'best t', 'F@best', 'delta F', 'P/R@best', 'tmF@best', 'FPdl ship -> best'],
	ALL.map((cls) => {
		const s = at(base[cls], ship(cls));
		const b = best(base[cls]);
		return [cls, fmt(ship(cls), 2), fmt(s.agg.f), fmt(b.t, 2), fmt(b.agg.f), signed(b.agg.f - s.agg.f),
			`${fmt(b.agg.p)}/${fmt(b.agg.r)}`, fmt(b.agg.tmF), `${s.agg.fpDrumless} -> ${b.agg.fpDrumless}`];
	})), '');
json.sweep = Object.fromEntries(ALL.map((cls) => [cls, base[cls].map(({ t, agg }) => {
	const { perTrack, ...rest } = agg;
	return { t, ...rest };
})]));

// 2. Per-track relative thresholds.
md.push('## 2. Per-track relative thresholds t = max(floor, k * q) (kit classes)', '');
md.push('q = quantile of peak heights at a 0.08 threshold; t range across tracks in brackets. hatless = model hat '
	+ 'peaks on 80sRock, Beatles and Shadows (no HH labels; all are false positives).', '');
interface RelRow {
	qp: number;
	k: number;
	floor: number;
	perClass: Record<Kind, { agg: Agg; tMin: number; tMax: number }>;
	hatless: number;
}
const relRows: RelRow[] = [];
for (const qp of [0.9, 0.75]) {
	for (const k of [0.3, 0.4, 0.5, 0.6]) {
		for (const floor of [0.1, 0.14, 0.18]) {
			const perClass = {} as RelRow['perClass'];
			for (const cls of KIT) {
				const ts = new Map(data.map((d) => [d.name, relativeThreshold(d.acts.base, cls, qp, k, floor)]));
				const agg = aggregate(data, cls, (d) => peakStream(d.acts.base, cls, ts.get(d.name)!).times);
				perClass[cls] = { agg, tMin: Math.min(...ts.values()), tMax: Math.max(...ts.values()) };
			}
			const hatless = HATLESS.reduce((n, name) => n + (perClass.hat.agg.perTrack[name]?.est ?? 0), 0);
			relRows.push({ qp, k, floor, perClass, hatless });
		}
	}
}
const hatlessOf = (agg: Agg) => HATLESS.reduce((n, name) => n + (agg.perTrack[name]?.est ?? 0), 0);
const fixedRow = (label: string, pick: (cls: Kind) => { t: number; agg: Agg }) => [label, ...KIT.map((cls) => {
	const r = pick(cls);
	return `${prf(r.agg)} [${fmt(r.t, 2)}] tm ${fmt(r.agg.tmF)} dl ${r.agg.fpDrumless}`;
}), hatlessOf(pick('hat').agg)];
md.push(...table(['config', ...KIT.map((c) => `${c} P/R/F [t] tm dl`), 'hatless'], [
	fixedRow('fixed ship', (cls) => at(base[cls], ship(cls))),
	fixedRow('fixed best', (cls) => best(base[cls])),
	...relRows.map((r) => [`q${r.qp} k${r.k} f${r.floor}`, ...KIT.map((cls) => {
		const c = r.perClass[cls];
		return `${prf(c.agg)} [${fmt(c.tMin, 2)}..${fmt(c.tMax, 2)}] tm ${fmt(c.agg.tmF)} dl ${c.agg.fpDrumless}`;
	}), r.hatless])
]), '');
md.push('Hat peaks per hat-less track (fixed ship / fixed best / best relative per class-mean F):', '');
const bestRel = relRows.reduce((a, b) => (mean(KIT.map((c) => b.perClass[c].agg.f)) > mean(KIT.map((c) => a.perClass[c].agg.f)) ? b : a));
md.push(...table(['track', 'ship', 'best fixed', `q${bestRel.qp} k${bestRel.k} f${bestRel.floor}`], HATLESS.map((name) => [
	name.replace('MusicDelta_', ''), at(base.hat, ship('hat')).agg.perTrack[name]?.est ?? '-',
	best(base.hat).agg.perTrack[name]?.est ?? '-', bestRel.perClass.hat.agg.perTrack[name]?.est ?? '-'
])), '');
json.relative = relRows.map((r) => ({
	qp: r.qp, k: r.k, floor: r.floor, hatless: r.hatless,
	perClass: Object.fromEntries(KIT.map((cls) => {
		const { perTrack, ...rest } = r.perClass[cls].agg;
		return [cls, { ...rest, tMin: r.perClass[cls].tMin, tMax: r.perClass[cls].tMax }];
	}))
}));

// 3. DSP-corroborated rescue.
md.push('## 3. DSP-corroborated rescue of peaks between a low threshold and the shipping one', '');
md.push('Accept a sub-threshold model peak when the cached DSP curve of the same class has a local max >= c '
	+ 'within 30 ms. cand/acc = candidate peaks and accepted ones over the corpus.', '');
interface RescueRow {
	low: number;
	c: number;
	perClass: Record<Kind, { agg: Agg; candidates: number; accepted: number }>;
}
const rescueRows: RescueRow[] = [];
for (const low of [0.1, 0.12, 0.14]) {
	for (const c of [0.15, 0.25, 0.35]) {
		const perClass = {} as RescueRow['perClass'];
		for (const cls of KIT) {
			let candidates = 0;
			let accepted = 0;
			const agg = aggregate(data, cls, (d) => {
				const r = rescue(d, cls, low, c);
				candidates += r.candidates;
				accepted += r.accepted;
				return r.stream.times;
			});
			perClass[cls] = { agg, candidates, accepted };
		}
		rescueRows.push({ low, c, perClass });
	}
}
md.push(...table(['low / c', ...KIT.map((c) => `${c} P/R/F dF cand/acc dl`)], [
	['ship', ...KIT.map((cls) => `${prf(at(base[cls], ship(cls)).agg)} +0.000 - dl ${at(base[cls], ship(cls)).agg.fpDrumless}`)],
	...rescueRows.map((r) => [`${fmt(r.low, 2)} / ${fmt(r.c, 2)}`, ...KIT.map((cls) => {
		const c = r.perClass[cls];
		return `${prf(c.agg)} ${signed(c.agg.f - at(base[cls], ship(cls)).agg.f)} ${c.candidates}/${c.accepted} dl ${c.agg.fpDrumless}`;
	})])
]), '');
json.rescue = rescueRows.map((r) => ({
	low: r.low, c: r.c,
	perClass: Object.fromEntries(KIT.map((cls) => {
		const { perTrack, ...rest } = r.perClass[cls].agg;
		return [cls, { ...rest, candidates: r.perClass[cls].candidates, accepted: r.perClass[cls].accepted }];
	}))
}));

// 4 and 5. Input gain and test-time augmentation.
const variantSweeps: Record<string, Sweep> = { base };
if (useModel) {
	md.push('## 4. Input gain (ADTOF re-run on rescaled 44.1 kHz mono)', '');
	const lufs = data.map((d) => d.nativeLufs);
	md.push(`Native integrated loudness of the mixes: min ${fmt(Math.min(...lufs), 1)}, p25 ${fmt(quantileOf(lufs, 0.25), 1)}, `
		+ `median ${fmt(quantileOf(lufs, 0.5), 1)}, p75 ${fmt(quantileOf(lufs, 0.75), 1)}, max ${fmt(Math.max(...lufs), 1)} LUFS `
		+ `(mean ${fmt(mean(lufs), 1)}). Per track: ${data.map((d) => `${d.name.replace('MusicDelta_', '')} ${fmt(d.nativeLufs, 1)}`).join(', ')}.`, '');
	for (const v of ['lufs14', 'lufs11', 'lufs17', 'gainm3db', 'gainp3db', 'lag220', 'lead220', 'tta-gain', 'tta-shift', 'tta-all']) {
		variantSweeps[v] = sweep(data, v);
	}
	const variantTable = (variants: readonly string[]) => table(
		['variant', ...ALL.map((c) => `${c} F@ship (P/R) ; best t F@best`)],
		variants.map((v) => [v, ...ALL.map((cls) => {
			const s = at(variantSweeps[v][cls], ship(cls));
			const b = best(variantSweeps[v][cls]);
			const ref = at(base[cls], ship(cls)).agg.f;
			return `${fmt(s.agg.f)} ${signed(s.agg.f - ref)} (${fmt(s.agg.p)}/${fmt(s.agg.r)}) ; ${fmt(b.t, 2)} ${fmt(b.agg.f)} ${signed(b.agg.f - ref)}`;
		})])
	);
	md.push('Deltas are against base at the shipping threshold. Inference was `'
		+ `${Object.entries(inference).filter(([, ms]) => ms > 0).map(([v, ms]) => `${v} ${(ms / 1000).toFixed(0)} s`).join(', ') || 'all cached'}\`.`, '');
	md.push(...variantTable(['base', 'lufs14', 'lufs11', 'lufs17']), '');
	md.push('## 5. Test-time augmentation (activations averaged per frame)', '');
	md.push('tta-gain = mean of base, -3 dB, +3 dB; tta-shift = mean of base and the PCM shifted by a half hop each way '
		+ '(220 samples, frames aligned by index); tta-all = all five.', '');
	md.push(...variantTable(['base', 'gainm3db', 'gainp3db', 'tta-gain', 'lag220', 'lead220', 'tta-shift', 'tta-all']), '');
	json.variants = Object.fromEntries(Object.entries(variantSweeps).map(([v, sw]) => [v, Object.fromEntries(ALL.map((cls) => {
		const s = at(sw[cls], ship(cls));
		const b = best(sw[cls]);
		return [cls, { fShip: s.agg.f, pShip: s.agg.p, rShip: s.agg.r, fpDrumlessShip: s.agg.fpDrumless, bestT: b.t, fBest: b.agg.f, tmFBest: b.agg.tmF }];
	}))]));
	json.nativeLufs = Object.fromEntries(data.map((d) => [d.name, d.nativeLufs]));
}

// Final stage (snap + quantise on cached shipped inputs) for the candidate configurations.
md.push('## Final stage for candidate configurations (kick/snare snapped and quantised, ms-rounded)', '');
md.push('The shipped hat is the DSP hat and does not change with these variants; base ship must equal '
	+ 'results-worktree final (kick .834, snare .698).', '');
const bestRescue = (cls: Kind) => rescueRows.reduce((a, b) => (b.perClass[cls].agg.f > a.perClass[cls].agg.f ? b : a));
const finalConfigs: { label: string; est: (d: TrackData, cls: Kind) => number[] }[] = [
	{ label: 'base ship', est: (d, cls) => finalTimes(d, peakStream(d.acts.base, cls, ship(cls))) },
	{ label: 'fixed best', est: (d, cls) => finalTimes(d, peakStream(d.acts.base, cls, best(base[cls]).t)) },
	{
		label: `relative q${bestRel.qp} k${bestRel.k} f${bestRel.floor}`,
		est: (d, cls) => finalTimes(d, peakStream(d.acts.base, cls, relativeThreshold(d.acts.base, cls, bestRel.qp, bestRel.k, bestRel.floor)))
	},
	{
		label: 'rescue best per class',
		est: (d, cls) => finalTimes(d, rescue(d, cls, bestRescue(cls).low, bestRescue(cls).c).stream)
	}
];
if (useModel) {
	for (const v of ['lufs14', 'tta-gain', 'tta-all']) {
		finalConfigs.push({ label: `${v} ship t`, est: (d, cls) => finalTimes(d, peakStream(d.acts[v], cls, ship(cls))) });
		finalConfigs.push({ label: `${v} best t`, est: (d, cls) => finalTimes(d, peakStream(d.acts[v], cls, best(variantSweeps[v][cls]).t)) });
	}
}
const finalRows = finalConfigs.map((cfg) => ({
	label: cfg.label,
	perClass: Object.fromEntries((['kick', 'snare'] as const).map((cls) => [cls, aggregate(data, cls, (d) => cfg.est(d, cls))]))
}));
md.push(...table(['config', 'kick P/R/F tmF dl', 'snare P/R/F tmF dl'], finalRows.map((r) => [r.label,
	...(['kick', 'snare'] as const).map((cls) => `${prf(r.perClass[cls])} ${fmt(r.perClass[cls].tmF)} ${r.perClass[cls].fpDrumless}`)])), '');
json.final = finalRows.map((r) => ({
	label: r.label,
	perClass: Object.fromEntries(Object.entries(r.perClass).map(([cls, agg]) => {
		const { perTrack, ...rest } = agg;
		return [cls, rest];
	}))
}));

const seconds = (performance.now() - started) / 1000;
md.push(`Total ${seconds.toFixed(1)} s.`, '');
const mdPath = join(dirs.lab, 'thresholds.md');
writeJson(join(dirs.lab, 'thresholds.json'), json);
writeFileSync(mdPath, md.join('\n'));
console.log(md.join('\n'));
console.log(`Wrote ${mdPath} and .json`);
