// node bench/lab/exp-snare.ts [--tracks=Rock,Disco] [--skip-library]
// Experiment C: weak-snare veto rules, activation peak-picking variants and odf snapping
// variants on the MDB mixes, plus the AC/DC count-in check on library track 9vWNauaZAgg.
// Writes bench/reports/audio-reliability/lab/snare-*.{json,md} and snare-summary.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeTrack } from '../../packages/analysis/src/analyze.ts';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import { detectDrums, snapTimesToOnsets, type DrumStream } from '../../packages/analysis/src/drums.ts';
import { refinePeakTime } from '../../packages/analysis/src/onsets.ts';
import { quantiseOnsets } from '../../packages/analysis/src/quantise.ts';
import { benchmarkCache } from '../cache.ts';
import {
	CHANNEL, CLASSES, KIT, MODEL_FPS, THRESHOLDS, activations, beats, classCurve, dirs, evaluate,
	featuresOf, fmt, loadLabels, modelStreams, nearestDistance, quantiseInputs, read, readF32, runAdtof,
	score, shipRound, signed, summarise, writeF32, writeJson,
	type Kind, type QuantiseInputs, type StageSummary, type Times, type TrackResult
} from './mdb.ts';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--tracks='))?.slice(9).split(',').filter(Boolean) ?? [];
const skipLibrary = args.includes('--skip-library');
const DENSE = ['SpeedMetal', 'Punk', 'BebopJazz', 'FreeJazz'];
const LIBRARY_ID = '9vWNauaZAgg';
const COUNT_IN_END = 5.8;
const summary: string[] = ['# snare experiment summary', ''];
const say = (...lines: string[]) => {
	summary.push(...lines);
	for (const line of lines) console.log(line);
};

interface PickOptions {
	preAvg: number;
	postAvg: number;
	preMax: number;
	postMax: number;
	combine: number;
	/** Zero-padded edges, local max on the thresholded raw activation, combine keeps the earlier peak. */
	madmom?: boolean;
	/** Parabolic sub-frame refinement on the raw activation. */
	refine?: boolean;
}
const PORT: PickOptions = { preAvg: 0.1, postAvg: 0.01, preMax: 0.02, postMax: 0.01, combine: 0.02 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function pick(act: Float32Array, threshold: number, o: PickOptions): { frames: number[]; times: number[]; proc: Float32Array } {
	const n = act.length;
	const preAvg = Math.round(o.preAvg * MODEL_FPS);
	const postAvg = Math.round(o.postAvg * MODEL_FPS);
	const preMax = Math.round(o.preMax * MODEL_FPS);
	const postMax = Math.round(o.postMax * MODEL_FPS);
	const combine = Math.max(1, Math.round(o.combine * MODEL_FPS));
	const win = preAvg + 1 + postAvg;
	const proc = new Float32Array(n);
	const det = o.madmom ? new Float32Array(n) : proc;
	for (let i = 0; i < n; i++) {
		let acc = 0;
		for (let k = -preAvg; k <= postAvg; k++) {
			const j = i + k;
			if (o.madmom) acc += j >= 0 && j < n ? act[j] : 0;
			else acc += act[Math.min(n - 1, Math.max(0, j))];
		}
		proc[i] = Math.max(0, act[i] - acc / win);
		if (o.madmom) det[i] = act[i] - acc / win >= threshold ? act[i] : 0;
	}
	const peaks: number[] = [];
	for (let i = 0; i < n; i++) {
		if (o.madmom ? det[i] <= 0 : proc[i] < threshold) continue;
		let max = -Infinity;
		for (let k = -preMax; k <= postMax; k++) {
			const j = i + k;
			const v = o.madmom ? (j >= 0 && j < n ? det[j] : 0) : det[Math.min(n - 1, Math.max(0, j))];
			if (v > max) max = v;
		}
		if (det[i] >= max) peaks.push(i);
	}
	const kept: number[] = [];
	if (o.madmom) {
		let left = -Infinity;
		for (const idx of peaks) {
			if (idx - left <= combine) continue;
			kept.push(idx);
			left = idx;
		}
	} else {
		let group: number[] = [];
		const flush = () => {
			if (group.length) kept.push(group.reduce((a, b) => (proc[b] > proc[a] ? b : a)));
		};
		for (const idx of peaks) {
			if (group.length === 0 || idx - group[group.length - 1] <= combine) group.push(idx);
			else {
				flush();
				group = [idx];
			}
		}
		flush();
	}
	const times = kept.map((i) => (o.refine ? refinePeakTime(act, i, MODEL_FPS) : i / MODEL_FPS));
	return { frames: kept, times, proc };
}
const pickKit = (act: Float32Array, o: PickOptions, thr: readonly number[] = THRESHOLDS): Times => ({
	kick: pick(classCurve(act, CHANNEL.kick), thr[CHANNEL.kick], o).times,
	snare: pick(classCurve(act, CHANNEL.snare), thr[CHANNEL.snare], o).times,
	hat: pick(classCurve(act, CHANNEL.hat), thr[CHANNEL.hat], o).times
});
const sameTimes = (a: readonly number[], b: readonly number[]) =>
	a.length === b.length && a.every((t, i) => Math.abs(t - b[i]) < 1e-9);

interface Rule {
	name: string;
	a: number;
	/** Hat-over-snare factor; null skips the hat condition (DSP corroboration only). */
	h: number | null;
	/** DSP snare curve max within 30 ms must be below this; Infinity skips the DSP condition. */
	d: number;
	/** Alternatively below this fraction of the DSP hat curve max within 30 ms. */
	rel?: number;
}
const RULES: Rule[] = [];
for (const a of [0.4, 0.45, 0.5]) {
	for (const h of [1, 1.5]) {
		for (const d of [0.1, 0.2, 0.3]) RULES.push({ name: `a${a * 100}-h${h * 10}-d${d * 100}`, a, h, d });
		RULES.push({ name: `a${a * 100}-h${h * 10}-nodsp`, a, h, d: Infinity });
		RULES.push({ name: `a${a * 100}-h${h * 10}-rel50`, a, h, d: Infinity, rel: 0.5 });
	}
}
for (const d of [0.1, 0.2, 0.3]) RULES.push({ name: `dsp-a40-d${d * 100}`, a: 0.4, h: null, d });

interface Evidence {
	act: number;
	hat: number;
	dsp: number;
	dspHat: number;
}
function evidenceAt(act: Float32Array, frame: number, q: Pick<QuantiseInputs, 'dsp' | 'fps'>): Evidence {
	const n = act.length / CLASSES;
	let hat = 0;
	for (let j = Math.max(0, frame - 1); j <= Math.min(n - 1, frame + 1); j++) {
		hat = Math.max(hat, act[j * CLASSES + CHANNEL.hat]);
	}
	const c = Math.round((frame / MODEL_FPS) * q.fps);
	const r = Math.max(1, Math.round(0.03 * q.fps));
	const localMax = (curve: Float32Array) => {
		let m = 0;
		for (let j = Math.max(0, c - r); j <= Math.min(curve.length - 1, c + r); j++) m = Math.max(m, curve[j]);
		return m;
	};
	return { act: act[frame * CLASSES + CHANNEL.snare], hat, dsp: localMax(q.dsp.snare.curve), dspHat: localMax(q.dsp.hat.curve) };
}
const vetoed = (e: Evidence, rule: Rule) =>
	e.act < rule.a && (rule.h === null || e.hat > rule.h * e.act)
	&& (rule.rel !== undefined ? e.dsp < rule.rel * e.dspHat : e.dsp < rule.d);

function mergeHat(hat: readonly number[], extra: readonly number[]): number[] {
	const all = [...hat, ...extra].sort((a, b) => a - b);
	const out: number[] = [];
	for (const t of all) if (out.length === 0 || t - out[out.length - 1] > 0.02) out.push(t);
	return out;
}
function filterStream(s: DrumStream, keep: readonly boolean[]): DrumStream {
	return { ...s, times: s.times.filter((_, i) => keep[i]), levels: s.levels.filter((_, i) => keep[i]) };
}
const snapQ = (times: readonly number[], q: QuantiseInputs) => snapTimesToOnsets(times, q.odf, q.fps, q.snapRadius);
function snapLargest(times: readonly number[], odf: Float32Array, fps: number, radiusSec: number): number[] {
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

interface VetoCount {
	vetoed: number;
	lostTrue: number;
	lostGhost: number;
	removedFalse: number;
	nearHat: number;
}
const counts: Record<string, VetoCount> = Object.fromEntries(RULES.map((r) =>
	[r.name, { vetoed: 0, lostTrue: 0, lostGhost: 0, removedFalse: 0, nearHat: 0 }]));
const DETAIL_RULES = ['a40-h15-d30', 'a40-h15-nodsp', 'a40-h15-rel50', 'a50-h15-nodsp'];
const detail: string[] = [
	'| Rule | Track | t (s) | snare act | hat act | DSP snare | DSP hat | matched | nearest SD label ms | nearest HH label ms | subclass within 50 ms |',
	'|---|---|---:|---:|---:|---:|---:|---|---:|---:|---|'
];

function classTable(stages: Record<string, StageSummary>, kinds: readonly Kind[] = KIT, base?: string): string[] {
	const lines = [
		'| Stage | Class | ref | est | tp | P | R | F | dF | signed med / p90 ms | abs med / p90 ms |',
		'|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
	];
	for (const [stage, s] of Object.entries(stages)) {
		for (const kind of kinds) {
			const c = s.classes[kind];
			if (!c) continue;
			const b = base ? stages[base]?.classes[kind] : undefined;
			lines.push(`| ${stage} | ${kind} | ${c.ref} | ${c.est} | ${c.tp} | ${fmt(c.pooled.p)} | ${fmt(c.pooled.r)} | ${fmt(c.pooled.f)} `
				+ `| ${b ? signed(c.pooled.f - b.pooled.f) : ''} | ${fmt(c.timing.signedMedianMs, 1)} / ${fmt(c.timing.signedP90Ms, 1)} `
				+ `| ${fmt(c.timing.absMedianMs, 1)} / ${fmt(c.timing.absP90Ms, 1)} |`);
		}
	}
	return lines;
}
const denseRows = (rows: readonly TrackResult[]) => rows.filter((r) => DENSE.some((n) => r.name.includes(n)));

async function runVeto() {
	const snapped = await evaluate('snare-veto', async (track, labels) => {
		const act = await activations(track.name);
		const q = await quantiseInputs(track.name);
		const model = modelStreams(act);
		const frames = model.snare.times.map((t) => Math.round(t * MODEL_FPS));
		const evidence = frames.map((f) => evidenceAt(act, f, q));
		const baseTimes = snapQ(model.snare.times, q);
		const order = baseTimes.map((_, i) => i).sort((x, y) => baseTimes[x] - baseTimes[y]);
		const scored = score(labels.snare, order.map((i) => baseTimes[i]));
		const matched = new Array<boolean>(baseTimes.length).fill(false);
		order.forEach((i, k) => (matched[i] = scored.matched[k]));
		const ghosts = labels.subclass.filter((s) => s.sub === 'SDG').map((s) => s.time).sort((a, b) => a - b);
		const hatSnap = snapQ(model.hat.times, q);
		const out: Record<string, Partial<Times>> = {
			snap: { kick: q.detected.kick, snare: baseTimes, hat: hatSnap }
		};
		for (const rule of RULES) {
			const drop = evidence.map((e) => vetoed(e, rule));
			const c = counts[rule.name];
			drop.forEach((d, i) => {
				if (!d) return;
				if (DETAIL_RULES.includes(rule.name)) {
					const t = model.snare.times[i];
					const subs = labels.subclass.filter((s) => Math.abs(s.time - t) <= 0.05).map((s) => s.sub);
					const ms = (ref: number[]) => (Number.isFinite(nearestDistance(ref, t)) ? (nearestDistance(ref, t) * 1000).toFixed(0) : '-');
					detail.push(`| ${rule.name} | ${track.name.replace('MusicDelta_', '')} | ${t.toFixed(2)} | ${fmt(evidence[i].act)} | ${fmt(evidence[i].hat)} `
						+ `| ${fmt(evidence[i].dsp)} | ${fmt(evidence[i].dspHat)} | ${matched[i] ? 'true' : 'false'} | ${ms(labels.snare)} | ${ms(labels.hat)} | ${subs.join(' ') || '-'} |`);
				}
				c.vetoed++;
				if (matched[i]) {
					c.lostTrue++;
					if (nearestDistance(ghosts, baseTimes[i]) <= 0.05) c.lostGhost++;
				} else c.removedFalse++;
				if (nearestDistance(labels.hat, model.snare.times[i]) <= 0.05) c.nearHat++;
			});
			const kept = model.snare.times.filter((_, i) => !drop[i]);
			const extra = model.snare.times.filter((_, i) => drop[i]);
			out[`snap:${rule.name}`] = { snare: snapQ(kept, q), hat: snapQ(mergeHat(model.hat.times, extra), q) };
		}
		return out;
	}, {
		only, quiet: true,
		notes: [
			'snap = shipped model peaks snapped to the odf (kick/snare identical to model-snapped; hat is the snapped model hat).',
			'snap:<rule> drops a snare peak when raw snare act < a, hat act (+-1 frame) > h x snare act, and the DSP snare curve max within 30 ms < d; nodsp skips the DSP condition, rel50 requires DSP snare < 0.5 x DSP hat max within 30 ms, dsp-* rules skip the hat condition.',
			'hat in a rule stage is the snapped model hat with the vetoed snare peaks merged in (20 ms dedupe), to show whether vetoed peaks read as hats.'
		]
	});
	const final = await evaluate('snare-veto-final', async (track) => {
		const act = await activations(track.name);
		const q = await quantiseInputs(track.name);
		const model = modelStreams(act);
		const frames = model.snare.times.map((t) => Math.round(t * MODEL_FPS));
		const evidence = frames.map((f) => evidenceAt(act, f, q));
		const finalOf = (s: DrumStream) => shipRound(quantiseOnsets({ ...s, times: snapQ(s.times, q) }, q).times);
		const out: Record<string, Partial<Times>> = { final: { snare: finalOf(model.snare) } };
		for (const rule of RULES) {
			const keep = evidence.map((e) => !vetoed(e, rule));
			out[`final:${rule.name}`] = { snare: finalOf(filterStream(model.snare, keep)) };
		}
		return out;
	}, {
		only, quiet: true,
		notes: ['final = snap, quantise on the cached shipped bar grid, round to the ms (equals worktree final snare).']
	});
	say('## 1. Weak-snare veto rules (model-snapped stage, 23 mixes)', '');
	say('| Rule | snare P | R | F | dF | tp | vetoed | true lost | of them SDG ghost | false removed | vetoed near labelled hat | hat+vetoed F (dF) | final snare F (dF) |',
		'|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
	const base = snapped.summary.snap.classes.snare!;
	const baseHat = snapped.summary.snap.classes.hat!;
	const baseFinal = final.summary.final.classes.snare!;
	say(`| none | ${fmt(base.pooled.p)} | ${fmt(base.pooled.r)} | ${fmt(base.pooled.f)} | | ${base.tp} | 0 | 0 | 0 | 0 | 0 | ${fmt(baseHat.pooled.f)} | ${fmt(baseFinal.pooled.f)} |`);
	for (const rule of RULES) {
		const c = snapped.summary[`snap:${rule.name}`].classes.snare!;
		const h = snapped.summary[`snap:${rule.name}`].classes.hat!;
		const f = final.summary[`final:${rule.name}`].classes.snare!;
		const n = counts[rule.name];
		say(`| ${rule.name} | ${fmt(c.pooled.p)} | ${fmt(c.pooled.r)} | ${fmt(c.pooled.f)} | ${signed(c.pooled.f - base.pooled.f)} | ${c.tp} `
			+ `| ${n.vetoed} | ${n.lostTrue} | ${n.lostGhost} | ${n.removedFalse} | ${n.nearHat} `
			+ `| ${fmt(h.pooled.f)} (${signed(h.pooled.f - baseHat.pooled.f)}) | ${fmt(f.pooled.f)} (${signed(f.pooled.f - baseFinal.pooled.f)}) |`);
	}
	say('');
	writeJson(join(dirs.lab, 'snare-veto-counts.json'), counts);
	writeFileSync(join(dirs.lab, 'snare-veto-detail.md'), detail.join('\n') + '\n');
	say(`Vetoed peaks for ${DETAIL_RULES.join(', ')}:`, '', ...detail, '');
	return { snapped, final };
}

async function runPeaks() {
	const variants: Record<string, (ibi: number) => PickOptions> = {
		'a-port': () => PORT,
		'b-pre50': () => ({ ...PORT, preAvg: 0.05 }),
		'c-pre30': () => ({ ...PORT, preAvg: 0.03 }),
		'd-madmom': () => ({ ...PORT, madmom: true }),
		'e-tempo': (ibi) => ({ ...PORT, preAvg: clamp(0.5 * ibi, 0.03, 0.1) }),
		'f-parabolic': () => ({ ...PORT, refine: true }),
		'g-combine10': () => ({ ...PORT, combine: 0.01 }),
		'h-thr075': () => PORT
	};
	const scaled = THRESHOLDS.map((t) => t * 0.75);
	const tempoWindows: Record<string, number> = {};
	const result = await evaluate('snare-peaks', async (track) => {
		const act = await activations(track.name);
		const q = await quantiseInputs(track.name);
		const tracked = await beats(track.name);
		const ibis = (tracked?.beats ?? []).slice(1).map((b, i) => b - tracked!.beats[i]).sort((a, b) => a - b);
		const ibi = ibis.length ? ibis[ibis.length >> 1] : q.beatPeriod;
		tempoWindows[track.name] = clamp(0.5 * ibi, 0.03, 0.1);
		const shipped = modelStreams(act);
		const out: Record<string, Partial<Times>> = {};
		for (const [name, make] of Object.entries(variants)) {
			const times = pickKit(act, make(ibi), name === 'h-thr075' ? scaled : THRESHOLDS);
			if (name === 'a-port') {
				for (const kind of KIT) {
					if (!sameTimes(times[kind], shipped[kind].times)) throw new Error(`${track.name}: lab picker differs from activationStream for ${kind}.`);
				}
			}
			out[name] = times;
			out[`${name}+snap`] = { kick: snapQ(times.kick, q), snare: snapQ(times.snare, q), hat: snapQ(times.hat, q) };
		}
		return out;
	}, {
		only, quiet: true,
		notes: [
			'Raw stages are unsnapped peaks of the cached activations at the shipped thresholds; +snap stages snap every class to the odf with the shipped radius.',
			'a-port is asserted identical to activationStream on every track.',
			'e-tempo pre_avg = clamp(0.5 x median Beat This inter-beat interval, 30, 100 ms).',
			'g-combine10 keeps the port picker with a 10 ms combine window; h-thr075 is the port picker at 0.75 x the shipped thresholds.'
		]
	});
	say('## 2. Peak-picking variants (raw activations, shipped thresholds)', '');
	say('Overall, 23 mixes:', '', ...classTable(result.summary, KIT, 'a-port'), '');
	const dense = summarise(denseRows(result.rows));
	say(`Dense tracks (${DENSE.join(', ')}):`, '', ...classTable(dense, KIT, 'a-port'), '');
	say('e-tempo windows (ms): ' + Object.entries(tempoWindows).map(([n, w]) => `${n.replace('MusicDelta_', '')} ${Math.round(w * 1000)}`).join(', '), '');
	writeJson(join(dirs.lab, 'snare-peaks-dense.json'), dense);
	return result;
}

async function runSnap() {
	const variant = async (track: { name: string }) => {
		const act = await activations(track.name);
		const q = await quantiseInputs(track.name);
		const shipped = modelStreams(act);
		const raw = { kick: shipped.kick.times, snare: shipped.snare.times, hat: shipped.hat.times };
		const each = (f: (t: number[]) => number[]): Times => ({ kick: f(raw.kick), snare: f(raw.snare), hat: f(raw.hat) });
		const parabolic = pickKit(act, { ...PORT, refine: true });
		return {
			none: raw,
			nearest: each((t) => snapQ(t, q)),
			largest: each((t) => snapLargest(t, q.odf, q.fps, q.snapRadius)),
			'nearest-r25': each((t) => snapTimesToOnsets(t, q.odf, q.fps, 0.025)),
			'largest-r25': each((t) => snapLargest(t, q.odf, q.fps, 0.025)),
			parabolic,
			'parabolic+nearest': { kick: snapQ(parabolic.kick, q), snare: snapQ(parabolic.snare, q), hat: snapQ(parabolic.hat, q) },
			'none+10ms': each((t) => t.map((x) => x + 0.01)),
			'nearest+6ms': each((t) => snapQ(t, q).map((x) => x + 0.006))
		};
	};
	const notes = [
		'Shipped model peaks (all three classes, model hat included) placed by each rule; nearest = shipped snapTimesToOnsets within min(50 ms, beat/8).',
		'largest = strongest odf local max within the radius (DSP placeOnOnset rule); r25 = 25 ms radius; parabolic = sub-frame activation peak, no snap.',
		'+10ms / +6ms add a constant delay to probe the systematic early bias against the MDB labels.'
	];
	const w50 = await evaluate('snare-snap-50', variant, { only, quiet: true, notes });
	const w25 = await evaluate('snare-snap-25', variant, { only, quiet: true, notes: [...notes, 'Scored with a +-25 ms window.'], window: 0.025 });
	say('## 3. Snapping variants (shipped model peaks)', '');
	say('Window +-50 ms:', '', ...classTable(w50.summary, KIT, 'nearest'), '');
	say('Window +-25 ms:', '', ...classTable(w25.summary, KIT, 'nearest'), '');
	return { w50, w25 };
}

async function runLibrary() {
	const cache = benchmarkCache();
	const audio = join(cache, `${LIBRARY_ID}.m4a`);
	const analysis = read<{ hash: string; tempo: { beatPeriod: number; bpm: number }; heard: { beats: number[]; downbeats: number[] };
		onsets: Record<Kind, { times: number[]; levels: number[] }> }>(join(cache, `${LIBRARY_ID}.analysis.json`));
	const actPath = join(dirs.lab, '..', 'library-activations', `${LIBRARY_ID}.f32`);
	let act: Float32Array;
	if (existsSync(actPath)) act = readF32(actPath);
	else {
		const wide = await decodeAudio(audio, 44100);
		const run = await runAdtof(wide.mono);
		act = run.act;
		writeF32(actPath, act);
		writeJson(`${actPath.slice(0, -4)}.json`, {
			id: LIBRARY_ID, pcmHash: run.hash, decodeHash: wide.hash, frames: act.length / CLASSES, classes: CLASSES,
			fps: MODEL_FPS, inferenceMs: run.inferenceMs, created: new Date().toISOString()
		});
	}
	const evidencePath = join(dirs.lab, '..', 'model-evidence', `${LIBRARY_ID}.activations.f32`);
	let evidenceNote = 'no model-evidence activations to compare';
	if (existsSync(evidencePath)) {
		const other = readF32(evidencePath);
		let maxDiff = other.length === act.length ? 0 : Infinity;
		if (other.length === act.length) for (let i = 0; i < act.length; i++) maxDiff = Math.max(maxDiff, Math.abs(act[i] - other[i]));
		evidenceNote = `max |diff| vs model-evidence activations ${maxDiff.toExponential(2)} (${other.length / CLASSES} vs ${act.length / CLASSES} frames)`;
	}
	const decoded = await decodeAudio(audio);
	const feats = featuresOf(decoded);
	const model = modelStreams(act);
	const probe: NonNullable<Parameters<typeof analyzeTrack>[0]['probe']> = {};
	const context = read<Parameters<typeof analyzeTrack>[0]['context']>(join(cache, `${LIBRARY_ID}.context.json`));
	const result = analyzeTrack({
		mono: decoded.mono, left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate,
		duration: decoded.duration, hash: decoded.hash, trackId: LIBRARY_ID, title: 'Back In Black',
		beats: analysis.heard.beats, downbeats: analysis.heard.downbeats, drums: model, context, probe
	});
	const captured = probe.drums!;
	const beatPeriod = result.tempo.beatPeriod;
	const dsp = detectDrums(feats.spec, { beatPeriod, odf: feats.odf });
	const fps = feats.curves.fps;
	const radius = Math.min(0.05, beatPeriod / 8);
	const frames = model.snare.times.map((t) => Math.round(t * MODEL_FPS));
	const evidence = frames.map((f) => evidenceAt(act, f, { dsp, fps }));
	const heights = pick(classCurve(act, CHANNEL.snare), THRESHOLDS[CHANNEL.snare], PORT).proc;
	const shippedSnare = result.onsets.snare.times;
	const sameAsCache = sameTimes(shippedSnare.slice(0, 20), analysis.onsets.snare.times.slice(0, 20));
	const lines: string[] = [];
	lines.push('## 4. Library confirmation: 9vWNauaZAgg (AC/DC Back In Black)', '');
	lines.push(`- activations ${act.length / CLASSES} frames from ${actPath}; ${evidenceNote}.`);
	lines.push(`- analyzeTrack rerun: bpm ${result.tempo.bpm} (cached ${analysis.tempo.bpm}), beatPeriod ${beatPeriod}; first 20 shipped snare times ${sameAsCache ? 'equal' : 'differ from'} the library analysis.`);
	lines.push(`- cached library snare (first 8): ${analysis.onsets.snare.times.slice(0, 8).map((t, i) => `${t.toFixed(3)}@${analysis.onsets.snare.levels[i].toFixed(2)}`).join(' ')}`);
	lines.push(`- rerun shipped snare (first 8): ${shippedSnare.slice(0, 8).map((t, i) => `${t.toFixed(3)}@${result.onsets.snare.levels[i].toFixed(2)}`).join(' ')}`);
	lines.push(`- DSP snare peaks below 6 s (time@level): ${dsp.snare.times.filter((t) => t < 6).map((t, i) => `${t.toFixed(3)}@${dsp.snare.levels[i].toFixed(3)}`).join(' ')}`);
	lines.push('', `Model snare peaks below 13 s (count-in ends ${COUNT_IN_END} s):`, '');
	lines.push('| t (s) | raw act | proc height | hat act +-1 | DSP snare max 30 ms | DSP hat max 30 ms | level | vetoed by |', '|---:|---:|---:|---:|---:|---:|---:|---|');
	const vetoedBy = (e: Evidence) => RULES.filter((r) => vetoed(e, r)).map((r) => r.name);
	for (let i = 0; i < frames.length && model.snare.times[i] < 13; i++) {
		const e = evidence[i];
		const by = vetoedBy(e);
		lines.push(`| ${model.snare.times[i].toFixed(2)} | ${fmt(e.act)} | ${fmt(heights[frames[i]])} | ${fmt(e.hat)} | ${fmt(e.dsp, 4)} | ${fmt(e.dspHat)} | ${fmt(model.snare.levels[i], 2)} | ${by.length === RULES.length ? 'all' : by.length === 0 ? 'none' : by.join(' ')} |`);
	}
	lines.push('', '| Rule | count-in peaks vetoed / total | peaks vetoed 5.8-60 s / total | vetoed in whole track / total | final snare < 5.8 s (shipped path) | final snare 5.8-13 s |', '|---|---:|---:|---:|---|---|');
	const countIn = frames.filter((_, i) => model.snare.times[i] < COUNT_IN_END).length;
	const early = frames.filter((_, i) => model.snare.times[i] >= COUNT_IN_END && model.snare.times[i] < 60).length;
	const finalOf = (s: DrumStream) => shipRound(quantiseOnsets({ ...s, times: snapTimesToOnsets(s.times, feats.odf, fps, radius) }, captured.quantiseOptions).times);
	const describe = (times: number[]) => {
		const a = times.filter((t) => t < COUNT_IN_END);
		const b = times.filter((t) => t >= COUNT_IN_END && t < 13);
		return `${a.length ? a.map((t) => t.toFixed(2)).join(' ') : 'none'} | ${b.length}: ${b.map((t) => t.toFixed(2)).join(' ')}`;
	};
	lines.push(`| none | 0 / ${countIn} | 0 / ${early} | 0 / ${frames.length} | ${describe(finalOf(model.snare))} |`);
	for (const rule of RULES) {
		const drop = evidence.map((e) => vetoed(e, rule));
		const n = (from: number, to: number) => drop.filter((d, i) => d && model.snare.times[i] >= from && model.snare.times[i] < to).length;
		const kept = filterStream(model.snare, drop.map((d) => !d));
		lines.push(`| ${rule.name} | ${n(0, COUNT_IN_END)} / ${countIn} | ${n(COUNT_IN_END, 60)} / ${early} | ${n(0, Infinity)} / ${frames.length} | ${describe(finalOf(kept))} |`);
	}
	lines.push('');
	writeFileSync(join(dirs.lab, 'snare-library.md'), lines.join('\n') + '\n');
	say(...lines);
}

const started = performance.now();
const veto = await runVeto();
const peaks = await runPeaks();
const snap = await runSnap();
if (!skipLibrary) await runLibrary();
say(`Total ${((performance.now() - started) / 1000).toFixed(1)} s. Reports: ${[veto.snapped, veto.final, peaks, snap.w50, snap.w25].map((r) => r.mdPath).join(', ')}`);
writeFileSync(join(dirs.lab, 'snare-summary.md'), summary.join('\n') + '\n');
