// node bench/lab/exp-hats.ts [--tracks=Rock,Disco] [--no-library] [--library-only]
// Hat source experiment: the shipped DSP hats against the ADTOF hat class, alone and combined,
// scored on the MDB full mixes; hats per beat for the planner's subdivision pick; and the model
// hat rate over the whole app library against the cached DSP bar counts.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Adtof } from '../../packages/analysis/src/adtof.ts';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import { separate } from '../../packages/analysis/src/dsp/hpss.ts';
import type { Spectrogram } from '../../packages/analysis/src/dsp/spectrogram.ts';
import { quantile, smooth } from '../../packages/analysis/src/dsp/stats.ts';
import { snapTimesToOnsets, type DrumStream } from '../../packages/analysis/src/drums.ts';
import { pickPeaks, refinePeakTime, type Peak } from '../../packages/analysis/src/onsets.ts';
import { MODEL_DIR } from '../../packages/analysis/src/paths.ts';
import { quantiseOnsets } from '../../packages/analysis/src/quantise.ts';
import { benchmarkCache } from '../cache.ts';
import {
	CHANNEL, CLASSES, MODEL_FPS, ROOT, WINDOW, activations, classCurve, dirs, evaluate, features,
	fmt, loadLabels, matchEvents, mean, modelStream, nearestDistance, quantileOf, quantiseInputs,
	read, readF32, sha256, shipRound, writeF32, writeJson, type Labels
} from './mdb.ts';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--tracks='))?.slice(9).split(',').filter(Boolean) ?? [];
const runMdb = !args.includes('--library-only');
const runLibrary = !args.includes('--no-library');

const DRUMLESS_S = 0.5;
const MERGE_S = 0.03;
const GATE_ACT = 0.1;
const HAT_HZ = [6000, 20000] as const;
const SWEEP = [0.1, 0.12, 0.15, 0.18, 0.2, 0.22, 0.25, 0.3, 0.35];
const HATLESS = ['MusicDelta_80sRock', 'MusicDelta_Beatles', 'MusicDelta_Shadows'];
const PHH_TRACKS = ['MusicDelta_ModalJazz', 'MusicDelta_CoolJazz', 'MusicDelta_BebopJazz', 'MusicDelta_SwingJazz'];
/** plan.ts paramsFor: perBeat 4 / 2 / 1 and cycleBeats 4 / 8 from hats per beat. */
const perBeatOf = (hpb: number) => (hpb >= 3 ? 4 : hpb >= 1.5 ? 2 : 1);
const cycleBeatsOf = (hpb: number) => (hpb >= 1.5 ? 4 : 8);

// detectDrums' hat path, copied so the kick veto can be switched off; with the veto the times
// equal the shipped stream exactly (asserted per track).
function bandFlux(
	mag: Float32Array, original: Float32Array, frames: number, bands: number, centreHz: Float32Array,
	loHz: number, hiHz: number, lag: number
): Float32Array {
	let lo = 0;
	let hi = bands;
	while (lo < bands && centreHz[lo] < loHz) lo++;
	while (hi > lo && centreHz[hi - 1] > hiHz) hi--;
	if (hi <= lo) hi = Math.min(bands, lo + 1);
	const out = new Float32Array(frames);
	const width = hi - lo;
	for (let f = lag; f < frames; f++) {
		let acc = 0;
		for (let b = lo; b < hi; b++) {
			const cur = Math.log10(1 + mag[f * bands + b]);
			const prev = Math.log10(1 + mag[(f - lag) * bands + b]);
			const rise = Math.log10(1 + original[f * bands + b]) - Math.log10(1 + original[(f - lag) * bands + b]);
			if (cur > prev && rise > 0) acc += Math.min(cur - prev, rise);
		}
		out[f] = acc / width;
	}
	return out;
}
function normaliseCurve(curve: Float32Array): Float32Array {
	const sorted = Float32Array.from(curve).sort();
	const top = sorted[Math.floor(sorted.length * 0.995)] || 1;
	const out = new Float32Array(curve.length);
	for (let i = 0; i < curve.length; i++) out[i] = curve[i] / top;
	return out;
}
function placeOnOnset(curve: Float32Array, peaks: readonly Peak[], odf: Float32Array, fps: number, radiusSec: number): number[] {
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
function levelsOf(curve: Float32Array, peaks: readonly Peak[], fps: number, movingMeanSec: number) {
	const floor = smooth(curve, Math.max(1, Math.round(movingMeanSec * fps)));
	const excess = new Float32Array(curve.length);
	for (let i = 0; i < curve.length; i++) excess[i] = Math.max(0, curve[i] - floor[i]);
	const top = peaks.length > 0 ? quantile(peaks.map((p) => p.strength), 0.9) : 0;
	const scale = top > 1e-9 ? 1 / top : 0;
	for (let i = 0; i < excess.length; i++) excess[i] = Math.min(1, excess[i] * scale);
	return { levels: peaks.map((p) => Math.min(1, p.strength * scale)), curve: excess, fps };
}
function dspHatUnvetoed(spec: Spectrogram, odf: Float32Array, beatPeriod: number): DrumStream {
	const { percussive } = separate(spec.mag, spec.frames, spec.bands);
	const hatCurve = normaliseCurve(bandFlux(percussive, spec.mag, spec.frames, spec.bands, spec.centreHz, HAT_HZ[0], HAT_HZ[1], 2));
	const peaks = pickPeaks(hatCurve, spec.fps, {
		localMaxSec: 0.02, movingMeanSec: 0.08, delta: 0.05, refractorySec: Math.max(0.04, beatPeriod * 0.2)
	});
	const radius = Math.min(0.05, beatPeriod / 8);
	return { times: placeOnOnset(hatCurve, peaks, odf, spec.fps, radius), ...levelsOf(hatCurve, peaks, spec.fps, 0.08) };
}

const ascending = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);
function maxWithin(curve: Float32Array, t: number, radiusSec: number, fps: number): number {
	let m = 0;
	const from = Math.max(0, Math.round((t - radiusSec) * fps));
	const to = Math.min(curve.length - 1, Math.round((t + radiusSec) * fps));
	for (let i = from; i <= to; i++) if (curve[i] > m) m = curve[i];
	return m;
}
/** Model hits plus the DSP hits with no model hit within MERGE_S that pass `accept`. */
function merge(model: DrumStream, dsp: DrumStream, accept: (t: number) => boolean): DrumStream {
	const sortedModel = ascending(model.times);
	const hits = model.times.map((t, i) => ({ t, level: model.levels[i] }));
	dsp.times.forEach((t, i) => {
		if (nearestDistance(sortedModel, t) > MERGE_S && accept(t)) hits.push({ t, level: dsp.levels[i] });
	});
	hits.sort((a, b) => a.t - b.t);
	return {
		times: hits.map((h) => h.t), levels: hits.map((h) => h.level),
		curve: model.curve, levelCurve: model.levelCurve, fps: model.fps
	};
}
const hatsPerBeat = (times: readonly number[], beats: Float64Array): number => {
	const first = beats[0];
	const last = beats[beats.length - 1];
	let n = 0;
	for (const t of times) if (t >= first && t <= last) n++;
	return n / Math.max(1, beats.length - 1);
};

interface Extra {
	est: number;
	tp: number;
	fpDrumless: number;
	phhMatched: number;
	phhTotal: number;
}
function extra(labels: Labels, est: readonly number[]): Extra {
	const sorted = ascending(est);
	const pairs = matchEvents(labels.hat, sorted, WINDOW);
	const matched = new Set<number>();
	for (let i = 0; i < pairs.length; i++) if (pairs[i] >= 0) matched.add(pairs[i]);
	let fpDrumless = 0;
	sorted.forEach((t, j) => {
		if (!matched.has(j) && nearestDistance(labels.all, t) > DRUMLESS_S) fpDrumless++;
	});
	const used = new Set<number>();
	let phhTotal = 0;
	let phhMatched = 0;
	for (const row of labels.subclass) {
		if (row.sub !== 'PHH') continue;
		phhTotal++;
		const i = labels.hat.findIndex((t, k) => !used.has(k) && Math.abs(t - row.time) < 1e-6);
		if (i < 0) continue;
		used.add(i);
		if (pairs[i] >= 0) phhMatched++;
	}
	return { est: est.length, tp: matched.size, fpDrumless, phhMatched, phhTotal };
}

interface PerBeatRow {
	name: string;
	beats: number;
	labels: number;
	dsp: number;
	dspFinal: number;
	model: number;
	modelSnap: number;
	modelFinal: number;
	/** Hats plus cymbals: the top-kit subdivision the planner is really after. */
	labelsTop: number;
	modelTop: number;
}
interface SweepCell {
	ref: number;
	est: number;
	tp: number;
	f: number;
}

async function mdb(): Promise<void> {
	const extras: Record<string, Record<string, Extra>> = {};
	const perBeat: PerBeatRow[] = [];
	const sweep: Record<string, Record<string, SweepCell>> = {};
	const vetoRemoved: Record<string, number> = {};
	const out = await evaluate('hats', async (track, labels) => {
		const name = track.name;
		const act = await activations(name);
		const q = await quantiseInputs(name);
		const hatAct = classCurve(act, CHANNEL.hat);
		const model = modelStream(act, 'hat');
		const snapped: DrumStream = { ...model, times: snapTimesToOnsets(model.times, q.odf, q.fps, q.snapRadius) };
		const final = (s: DrumStream) => shipRound(quantiseOnsets(s, q).times);
		const dsp = q.dsp.hat;
		const union = merge(model, dsp, () => true);
		const gated = merge(model, dsp, (t) => maxWithin(hatAct, t, MERGE_S, MODEL_FPS) >= GATE_ACT);
		const gatedSnap = merge(snapped, dsp, (t) => maxWithin(hatAct, t, MERGE_S, MODEL_FPS) >= GATE_ACT);
		const feats = await features(name);
		const unvetoed = dspHatUnvetoed(feats.spec, feats.odf, q.beatPeriod);
		const have = new Set(unvetoed.times);
		for (const t of dsp.times) {
			if (!have.has(t)) throw new Error(`${name}: shipped DSP hat ${t} is not in the unvetoed hat stream.`);
		}
		vetoRemoved[name] = unvetoed.times.length - dsp.times.length;
		const modelFinal = final(snapped);
		const dspFinal = final(dsp);
		const low = modelStream(act, 'hat', 0.15);
		const lowSnapped: DrumStream = { ...low, times: snapTimesToOnsets(low.times, q.odf, q.fps, q.snapRadius) };
		const gateFinal = (gate: number) =>
			final(merge(snapped, dsp, (t) => maxWithin(hatAct, t, MERGE_S, MODEL_FPS) >= gate));
		const stages: Record<string, number[]> = {
			'a-dsp': dsp.times,
			'a-dsp-final': dspFinal,
			'b-model': model.times,
			'c-model-snap': snapped.times,
			'd-model-final': modelFinal,
			'd-model-final-0.15': final(lowSnapped),
			'e-union': union.times,
			'f-gated': gated.times,
			'f-gated-final': final(gatedSnap),
			'f-gate-0.05-final': gateFinal(0.05),
			'f-gate-0.15-final': gateFinal(0.15),
			'f-gate-0.20-final': gateFinal(0.2),
			'g-dsp-noveto': unvetoed.times,
			'g-dsp-noveto-final': final(unvetoed)
		};
		extras[name] = Object.fromEntries(Object.entries(stages).map(([stage, times]) => [stage, extra(labels, times)]));
		perBeat.push({
			name, beats: q.beats.length,
			labels: hatsPerBeat(labels.hat, q.beats),
			dsp: hatsPerBeat(dsp.times, q.beats), dspFinal: hatsPerBeat(dspFinal, q.beats),
			model: hatsPerBeat(model.times, q.beats), modelSnap: hatsPerBeat(snapped.times, q.beats),
			modelFinal: hatsPerBeat(modelFinal, q.beats),
			labelsTop: hatsPerBeat([...labels.hat, ...labels.cymbal], q.beats),
			modelTop: hatsPerBeat([...model.times, ...modelStream(act, 'cymbal').times], q.beats)
		});
		sweep[name] = {};
		for (const th of SWEEP) {
			const est = modelStream(act, 'hat', th).times;
			const pairs = matchEvents(labels.hat, est, WINDOW);
			let tp = 0;
			for (let i = 0; i < pairs.length; i++) if (pairs[i] >= 0) tp++;
			const p = est.length ? tp / est.length : 0;
			const r = labels.hat.length ? tp / labels.hat.length : 0;
			sweep[name][String(th)] = { ref: labels.hat.length, est: est.length, tp, f: p + r > 0 ? (2 * p * r) / (p + r) : 0 };
		}
		return Object.fromEntries(Object.entries(stages).map(([stage, hat]) => [stage, { hat }]));
	}, {
		only,
		notes: [
			'Hat class only. a: shipped DSP hat detector (raw, and quantised = shipped final).',
			'b: model hat class peaks at 0.22. c: b snapped to the odf within min(50 ms, beat/8).',
			'd: c through quantiseOnsets on the cached shipped bar grid, ms-rounded (the kick/snare path); d-0.15 the same from a 0.15 peak threshold.',
			'f-gate-x-final: as f-final with the DSP admission gate at activation x.',
			`e: b plus DSP hats with no model hit within ${MERGE_S * 1000} ms. f: e, DSP-only hats admitted only where the model hat activation reaches ${GATE_ACT} within ${MERGE_S * 1000} ms; f-final snaps and quantises it.`,
			'g: the DSP detector without the 20 ms kick veto (raw, and quantised).'
		]
	});

	const names = out.rows.map((row) => row.name);
	const stages = Object.keys(out.summary);
	const lines: string[] = [];
	lines.push('', '## Hat extras per stage', '');
	lines.push(`FP drumless: unmatched hits further than ${DRUMLESS_S} s from any annotated onset of any class. Hat-less: every hit on ${HATLESS.map((n) => n.replace('MusicDelta_', '')).join(', ')} (no HH labels). PHH: MDB pedal hi-hat subclass labels matched within +-50 ms.`, '');
	lines.push(`| Stage | est | tp | P | R | F | F track-mean | FP drumless | hat-less FPs (${HATLESS.map((n) => n.replace('MusicDelta_', '')).join('/')}) | ${PHH_TRACKS.map((n) => `PHH ${n.replace('MusicDelta_', '')}`).join(' | ')} |`);
	lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|---|${PHH_TRACKS.map(() => '---').join('|')}|`);
	const extraJson: Record<string, unknown> = {};
	for (const stage of stages) {
		const c = out.summary[stage].classes.hat!;
		const rows = names.map((n) => extras[n][stage]);
		const fpDrumless = rows.reduce((s, e) => s + e.fpDrumless, 0);
		const hatless = HATLESS.filter((n) => extras[n]).map((n) => extras[n][stage].est);
		const phh = PHH_TRACKS.filter((n) => extras[n]).map((n) => extras[n][stage]);
		extraJson[stage] = {
			est: c.est, tp: c.tp, p: c.pooled.p, r: c.pooled.r, f: c.pooled.f, trackMeanF: c.trackMean.f, fpDrumless,
			hatless: Object.fromEntries(HATLESS.filter((n) => extras[n]).map((n) => [n, extras[n][stage].est])),
			phh: Object.fromEntries(PHH_TRACKS.filter((n) => extras[n]).map((n) => [n, { matched: extras[n][stage].phhMatched, total: extras[n][stage].phhTotal }]))
		};
		lines.push(`| ${stage} | ${c.est} | ${c.tp} | ${fmt(c.pooled.p)} | ${fmt(c.pooled.r)} | ${fmt(c.pooled.f)} | ${fmt(c.trackMean.f)} | ${fpDrumless} `
			+ `| ${hatless.join(' / ')} (${hatless.reduce((a, b) => a + b, 0)}) | ${phh.map((e) => `${e.phhMatched}/${e.phhTotal} (${fmt(e.phhTotal ? e.phhMatched / e.phhTotal : 0, 2)})`).join(' | ')} |`);
	}
	lines.push('', `Kick veto removed ${Object.values(vetoRemoved).reduce((a, b) => a + b, 0)} DSP hat candidates over ${names.length} tracks (per track: ${names.map((n) => `${n.replace('MusicDelta_', '')} ${vetoRemoved[n]}`).join(', ')}).`);

	lines.push('', '## Model hat threshold sweep (raw peaks, pooled)', '');
	lines.push('| threshold | est | tp | P | R | F | F track-mean |', '|---|---:|---:|---:|---:|---:|---:|');
	const sweepJson: Record<string, unknown> = {};
	for (const th of SWEEP) {
		const cells = names.map((n) => sweep[n][String(th)]);
		const ref = cells.reduce((s, c) => s + c.ref, 0);
		const est = cells.reduce((s, c) => s + c.est, 0);
		const tp = cells.reduce((s, c) => s + c.tp, 0);
		const p = est ? tp / est : 0;
		const r = ref ? tp / ref : 0;
		const f = p + r > 0 ? (2 * p * r) / (p + r) : 0;
		const tm = mean(cells.filter((c) => c.ref > 0).map((c) => c.f));
		sweepJson[String(th)] = { ref, est, tp, p, r, f, trackMeanF: tm };
		lines.push(`| ${th} | ${est} | ${tp} | ${fmt(p)} | ${fmt(r)} | ${fmt(f)} | ${fmt(tm)} |`);
	}

	lines.push('', '## Hats per beat (grid beats from the cached analysis)', '');
	lines.push('Counts inside [first beat, last beat] over the beat count. Ratio columns divide by the label rate; hat-less tracks show absolute rates only. Buckets are plan.ts perBeat (1/2/4 at 1.5 and 3 hats per beat).', '');
	lines.push('| Track | beats | labels | dsp | dsp-final | model | model-snap | model-final | dsp/labels | dsp-final/labels | model/labels | model-final/labels | bucket labels/dsp-final/model-final | top labels | top model | top model/labels |');
	lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|');
	const ratio = (a: number, b: number) => (b > 0 ? fmt(a / b, 2) : '-');
	for (const row of perBeat) {
		lines.push(`| ${row.name.replace('MusicDelta_', '')} | ${row.beats} | ${fmt(row.labels, 2)} | ${fmt(row.dsp, 2)} | ${fmt(row.dspFinal, 2)} | ${fmt(row.model, 2)} | ${fmt(row.modelSnap, 2)} | ${fmt(row.modelFinal, 2)} `
			+ `| ${ratio(row.dsp, row.labels)} | ${ratio(row.dspFinal, row.labels)} | ${ratio(row.model, row.labels)} | ${ratio(row.modelFinal, row.labels)} `
			+ `| ${row.labels > 0 ? `${perBeatOf(row.labels)}/${perBeatOf(row.dspFinal)}/${perBeatOf(row.modelFinal)}` : `-/${perBeatOf(row.dspFinal)}/${perBeatOf(row.modelFinal)}`} `
			+ `| ${fmt(row.labelsTop, 2)} | ${fmt(row.modelTop, 2)} | ${ratio(row.modelTop, row.labelsTop)} |`);
	}
	const withLabels = perBeat.filter((r) => r.labels > 0);
	const dist = (pick: (r: PerBeatRow) => number) => {
		const xs = withLabels.map((r) => pick(r) / r.labels);
		return {
			n: xs.length, min: Math.min(...xs), p10: quantileOf(xs, 0.1), median: quantileOf(xs, 0.5), p90: quantileOf(xs, 0.9), max: Math.max(...xs),
			within08to125: xs.filter((x) => x >= 0.8 && x <= 1.25).length,
			sameBucket: withLabels.filter((r) => perBeatOf(pick(r)) === perBeatOf(r.labels)).length,
			sameCycle: withLabels.filter((r) => cycleBeatsOf(pick(r)) === cycleBeatsOf(r.labels)).length
		};
	};
	const dists = {
		dsp: dist((r) => r.dsp), dspFinal: dist((r) => r.dspFinal),
		model: dist((r) => r.model), modelSnap: dist((r) => r.modelSnap), modelFinal: dist((r) => r.modelFinal)
	};
	lines.push('', `| source/labels | n | min | p10 | median | p90 | max | within 0.8..1.25 | same perBeat bucket | same cycleBeats |`, '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
	for (const [k, d] of Object.entries(dists)) {
		lines.push(`| ${k} | ${d.n} | ${fmt(d.min, 2)} | ${fmt(d.p10, 2)} | ${fmt(d.median, 2)} | ${fmt(d.p90, 2)} | ${fmt(d.max, 2)} | ${d.within08to125} | ${d.sameBucket} | ${d.sameCycle} |`);
	}
	const hatlessRows = perBeat.filter((r) => r.labels === 0);
	if (hatlessRows.length) {
		lines.push('', `Hat-less tracks, hats per beat: ${hatlessRows.map((r) => `${r.name.replace('MusicDelta_', '')} dsp-final ${fmt(r.dspFinal, 2)} model-final ${fmt(r.modelFinal, 2)}`).join('; ')}.`);
	}
	const md = out.md + lines.join('\n') + '\n';
	writeJson(join(dirs.lab, 'hats-extra.json'), { created: new Date().toISOString(), stages: extraJson, vetoRemoved, sweep: sweepJson, perBeat, perBeatDistribution: dists, perTrack: extras });
	const { writeFileSync } = await import('node:fs');
	writeFileSync(out.mdPath, md);
	console.log(lines.join('\n'));
}

interface LibraryAnalysis {
	title: string;
	duration: number;
	tempo: { bpm: number; beatsPerBar: number; barTimes: number[] };
	bars: { hats: number }[];
	beats: number[];
	onsets: { hat: { times: number[]; levels: number[] } };
}
interface Evidence {
	hash: string;
	drums?: { hat?: { times: number[] } };
	provenance?: { inferenceMs?: number };
}
interface LibraryRow {
	id: string;
	title: string;
	genre: string;
	bpm: number;
	bars: number;
	dspHats: number;
	modelHats: number;
	modelCymbals: number;
	/** Hat peaks at a 0.10 threshold: whether a low rate is a weak class or an absent one. */
	modelHatsLow: number;
	/** Share of the shipped DSP hats with hat activation >= GATE_ACT within MERGE_S, and the
	 * mean activation there over the mean at every sixteenth slot: what the model sees at them. */
	dspGatePass: number;
	dspLift: number;
	beats: number;
	dspHpb: number;
	modelHpb: number;
	ratio: number;
	flag: boolean;
	source: string;
	evidenceHats: number | null;
	seconds: number;
}

async function library(): Promise<void> {
	const cacheDir = benchmarkCache();
	const libDir = join(ROOT, 'bench', 'reports', 'audio-reliability', 'library-activations');
	const evidenceDir = join(ROOT, 'bench', 'reports', 'audio-reliability', 'model-evidence');
	const adtofSha = sha256(join(MODEL_DIR, 'adtof_frame_rnn.onnx'));
	const ids = readdirSync(cacheDir).filter((f) => f.endsWith('.analysis.json')).map((f) => f.slice(0, -14))
		.filter((id) => only.length === 0 || only.some((part) => id.includes(part))).sort();
	let model: Adtof | null = null;
	const rows: LibraryRow[] = [];
	const started = performance.now();
	try {
		for (const id of ids) {
			const at = performance.now();
			const analysis = read<LibraryAnalysis>(join(cacheDir, `${id}.analysis.json`));
			const contextPath = join(cacheDir, `${id}.context.json`);
			const genre = existsSync(contextPath) ? read<{ genreFamily?: string | null }>(contextPath).genreFamily ?? '' : '';
			const f32 = join(libDir, `${id}.f32`);
			const metaPath = join(libDir, `${id}.json`);
			const evidencePath = join(evidenceDir, `${id}.json`);
			const evidence = existsSync(evidencePath) ? read<Evidence>(evidencePath) : null;
			let act: Float32Array;
			let source: string;
			// Another pass may have written the same cache with its own metadata: trust a file
			// only with this schema's hash, else decode and check the frame count before reuse.
			const meta = existsSync(f32) && existsSync(metaPath) ? read<{ hash?: string; frames?: number; source?: string }>(metaPath) : null;
			if (meta?.hash && meta.frames && readF32(f32).length === meta.frames * CLASSES) {
				act = readF32(f32);
				source = `cached ${meta.source ?? '?'}`;
			} else {
				const decoded = await decodeAudio(join(cacheDir, `${id}.m4a`), 44100);
				const frames = 1 + Math.floor(decoded.mono.length / 441);
				const evidenceF32 = join(evidenceDir, `${id}.activations.f32`);
				let inferenceMs = 0;
				if (evidence && existsSync(evidenceF32) && evidence.hash === decoded.hash) {
					act = readF32(evidenceF32);
					source = 'model-evidence';
					inferenceMs = evidence.provenance?.inferenceMs ?? 0;
				} else {
					model ??= await Adtof.create();
					if (!model) throw new Error('ADTOF model unavailable.');
					const probe: { activations?: Float32Array } = {};
					const t0 = performance.now();
					await model.run(decoded.mono, probe);
					inferenceMs = performance.now() - t0;
					act = probe.activations!;
					source = 'inference';
				}
				if (act.length !== frames * CLASSES) throw new Error(`${id}: ${act.length / CLASSES} frames for ${frames} expected.`);
				writeF32(f32, act);
				const foreign = meta ? { foreign: meta } : {};
				writeJson(metaPath, {
					...foreign, frames, hash: decoded.hash, title: analysis.title, adtofSha,
					classes: CLASSES, fps: MODEL_FPS, source, inferenceMs, duration: decoded.duration,
					created: new Date().toISOString()
				});
			}
			const hat = modelStream(act, 'hat').times;
			const bars = analysis.bars.length;
			const barTimes = analysis.tempo.barTimes;
			const from = barTimes[0];
			const to = barTimes[Math.min(bars, barTimes.length - 1)];
			let modelHats = 0;
			for (const t of hat) if (t >= from && t < to) modelHats++;
			let modelCymbals = 0;
			for (const t of modelStream(act, 'cymbal').times) if (t >= from && t < to) modelCymbals++;
			let modelHatsLow = 0;
			for (const t of modelStream(act, 'hat', 0.1).times) if (t >= from && t < to) modelHatsLow++;
			const hatAct = classCurve(act, CHANNEL.hat);
			const dspTimes = analysis.onsets.hat.times.filter((t) => t >= from && t < to);
			const atDsp = dspTimes.map((t) => maxWithin(hatAct, t, MERGE_S, MODEL_FPS));
			const slots: number[] = [];
			for (let b = 0; b + 1 < analysis.beats.length; b++) {
				for (let k = 0; k < 4; k++) slots.push(analysis.beats[b] + (analysis.beats[b + 1] - analysis.beats[b]) * k / 4);
			}
			const atSlots = mean(slots.filter((t) => t >= from && t < to).map((t) => maxWithin(hatAct, t, MERGE_S, MODEL_FPS)));
			const dspGatePass = atDsp.length ? atDsp.filter((a) => a >= GATE_ACT).length / atDsp.length : 0;
			const dspLift = atSlots > 0 ? mean(atDsp) / atSlots : 0;
			const dspHats = analysis.bars.reduce((s, b) => s + b.hats, 0);
			const beats = bars * Math.max(1, analysis.tempo.beatsPerBar);
			const dspHpb = dspHats / beats;
			const modelHpb = modelHats / beats;
			const ratio = dspHpb > 0 ? modelHpb / dspHpb : Infinity;
			let evidenceHats: number | null = null;
			if (evidence?.drums?.hat) {
				evidenceHats = evidence.drums.hat.times.filter((t) => t >= from && t < to).length;
			}
			const seconds = (performance.now() - at) / 1000;
			rows.push({
				id, title: analysis.title, genre, bpm: analysis.tempo.bpm, bars, dspHats, modelHats, modelCymbals, modelHatsLow, dspGatePass, dspLift, beats, dspHpb, modelHpb, ratio,
				flag: !(ratio >= 0.6 && ratio <= 1.6), source, evidenceHats, seconds
			});
			console.log(`${id} ${JSON.stringify(analysis.title).slice(0, 32)} ${genre || '-'}: dsp ${fmt(dspHpb, 2)} model ${fmt(modelHpb, 2)} ratio ${fmt(ratio, 2)}${!(ratio >= 0.6 && ratio <= 1.6) ? ' FLAG' : ''} (${source}, ${seconds.toFixed(1)}s)`);
		}
	} finally {
		await model?.close();
	}
	const seconds = (performance.now() - started) / 1000;
	const ratios = rows.map((r) => r.ratio).filter(Number.isFinite);
	const flagged = rows.filter((r) => r.flag);
	const byDisagreement = [...rows].sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));
	const genres = [...new Set(rows.map((r) => r.genre || '(none)'))].sort();
	const cell = (r: LibraryRow) => `| ${r.id} | ${r.title.replace(/\|/g, '/').slice(0, 40)} | ${r.genre || '-'} | ${fmt(r.bpm, 1)} | ${r.bars} | ${fmt(r.dspHpb, 2)} | ${fmt(r.modelHpb, 2)} | ${fmt(r.modelCymbals / r.beats, 2)} | ${fmt(r.modelHatsLow / r.beats, 2)} | ${fmt(r.dspGatePass, 2)} | ${fmt(r.dspLift, 1)} | ${Number.isFinite(r.ratio) ? fmt(r.ratio, 2) : 'inf'} | ${fmt(r.dspHpb > 0 ? (r.modelHats + r.modelCymbals) / r.beats / r.dspHpb : 0, 2)} | ${r.flag ? 'flag' : ''} | ${perBeatOf(r.dspHpb)}/${perBeatOf(r.modelHpb)} | ${cycleBeatsOf(r.dspHpb)}/${cycleBeatsOf(r.modelHpb)} | ${r.evidenceHats === null ? '-' : r.evidenceHats === r.modelHats ? 'same' : `${r.evidenceHats} vs ${r.modelHats}`} |`;
	const header = ['| id | title | genre | bpm | bars | DSP hats/beat | model hats/beat | model cymbals/beat | model hats/beat @0.10 | DSP hats passing 0.10 gate | act lift at DSP hats | model/DSP | (hats+cym)/DSP | flag | perBeat DSP/model | cycleBeats DSP/model | evidence hats |', '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|'];
	const lines: string[] = [];
	lines.push('# hats-library', '');
	lines.push(`${rows.length} library tracks, ${new Date().toISOString()}, ${seconds.toFixed(0)} s. DSP hats per beat = sum of the cached analysis bars[].hats over bars x beatsPerBar (the planner's input); model hats per beat = ADTOF hat peaks at 0.22 inside the same bar span over the same beats. Flag: ratio outside 0.6..1.6.`, '');
	lines.push(`Ratio model/DSP: n ${ratios.length}, min ${fmt(Math.min(...ratios), 2)}, p10 ${fmt(quantileOf(ratios, 0.1), 2)}, median ${fmt(quantileOf(ratios, 0.5), 2)}, p90 ${fmt(quantileOf(ratios, 0.9), 2)}, max ${fmt(Math.max(...ratios), 2)}. Flagged ${flagged.length} (${flagged.filter((r) => r.ratio < 0.6).length} below 0.6, ${flagged.filter((r) => r.ratio > 1.6).length} above 1.6). perBeat bucket differs on ${rows.filter((r) => perBeatOf(r.dspHpb) !== perBeatOf(r.modelHpb)).length}, cycleBeats on ${rows.filter((r) => cycleBeatsOf(r.dspHpb) !== cycleBeatsOf(r.modelHpb)).length}. Shipped DSP hats passing the ${GATE_ACT} activation gate: pooled ${fmt(rows.reduce((s, r) => s + r.dspGatePass * r.dspHats, 0) / Math.max(1, rows.reduce((s, r) => s + r.dspHats, 0)), 2)}, track median ${fmt(quantileOf(rows.map((r) => r.dspGatePass), 0.5), 2)}; activation lift at DSP hats track median ${fmt(quantileOf(rows.map((r) => r.dspLift), 0.5), 1)}.`, '');
	lines.push('## Per genre', '', '| genre | n | median DSP hpb | median model hpb | median ratio | flagged |', '|---|---:|---:|---:|---:|---:|');
	for (const g of genres) {
		const rs = rows.filter((r) => (r.genre || '(none)') === g);
		lines.push(`| ${g} | ${rs.length} | ${fmt(quantileOf(rs.map((r) => r.dspHpb), 0.5), 2)} | ${fmt(quantileOf(rs.map((r) => r.modelHpb), 0.5), 2)} | ${fmt(quantileOf(rs.map((r) => r.ratio).filter(Number.isFinite), 0.5), 2)} | ${rs.filter((r) => r.flag).length} |`);
	}
	lines.push('', '## Ten largest disagreements', '', ...header, ...byDisagreement.slice(0, 10).map(cell));
	lines.push('', '## All tracks by ratio', '', ...header, ...[...rows].sort((a, b) => a.ratio - b.ratio).map(cell));
	const md = lines.join('\n') + '\n';
	const { writeFileSync } = await import('node:fs');
	writeFileSync(join(dirs.lab, 'hats-library.md'), md);
	writeJson(join(dirs.lab, 'hats-library.json'), { created: new Date().toISOString(), seconds, adtofSha, rows });
	console.log(md.slice(0, md.indexOf('## All tracks')));
}

if (runMdb) await mdb();
if (runLibrary) await library();
