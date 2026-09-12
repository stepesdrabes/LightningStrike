// node bench/lab/exp-hatgate.ts [--tracks=Rock] [--no-library]
// Model hat peaks gated by the DSP hat flux (a real hi-hat has an air transient; a sidechain
// swell does not), plus cymbal peaks folded into the hat stream, scored on MDB and counted on
// library spans where the spot checks found false model hats.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DrumStream } from '../../packages/analysis/src/drums.ts';
import { detectDrums, snapTimesToOnsets } from '../../packages/analysis/src/drums.ts';
import { extractFeatures } from '../../packages/analysis/src/features.ts';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import { quantiseOnsets } from '../../packages/analysis/src/quantise.ts';
import { benchmarkCache } from '../cache.ts';
import {
	CHANNEL, activations, evaluate, loadLabels, modelStream, normalised, quantiseInputs, score,
	readF32, fmt, type QuantiseInputs
} from './mdb.ts';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--tracks='))?.slice(9).split(',').filter(Boolean) ?? [];

/** Keep peaks whose DSP hat curve shows a local flux of at least `gate` within 30 ms. */
function gated(stream: DrumStream, dsp: DrumStream, fps: number, gate: number): DrumStream {
	const radius = Math.round(0.03 * fps);
	const keep: number[] = [];
	for (let i = 0; i < stream.times.length; i++) {
		const c = Math.round(stream.times[i] * fps);
		let best = 0;
		for (let k = Math.max(0, c - radius); k <= Math.min(dsp.curve.length - 1, c + radius); k++) {
			if (dsp.curve[k] > best) best = dsp.curve[k];
		}
		if (best >= gate) keep.push(i);
	}
	return { ...stream, times: keep.map((i) => stream.times[i]), levels: keep.map((i) => stream.levels[i]) };
}

/** Union of two streams; a peak within 30 ms of a stronger one in the other stream is dropped. */
function merged(a: DrumStream, b: DrumStream): DrumStream {
	const all = [...a.times.map((t, i) => ({ t, l: a.levels[i] })), ...b.times.map((t, i) => ({ t, l: b.levels[i] }))]
		.sort((x, y) => x.t - y.t);
	const out: { t: number; l: number }[] = [];
	for (const hit of all) {
		const last = out[out.length - 1];
		if (last && hit.t - last.t < 0.03) {
			if (hit.l > last.l) out[out.length - 1] = hit;
			continue;
		}
		out.push(hit);
	}
	return { ...a, times: out.map((h) => h.t), levels: out.map((h) => h.l) };
}

const finalOf = (s: DrumStream, q: QuantiseInputs) =>
	quantiseOnsets({ ...s, times: snapTimesToOnsets(s.times, q.odf, q.fps, q.snapRadius) }, q).times;

const union: Record<string, { tp: number; fp: number; fn: number }> = {};
await evaluate('hatgate', async (track, labels) => {
	const act = await activations(track.name);
	const q = await quantiseInputs(track.name);
	const h22 = modelStream(act, 'hat', 0.22);
	const h15 = modelStream(act, 'hat', 0.15);
	const cym = modelStream(act, 'cymbal', 0.30);
	const stages: Record<string, { hat: number[] }> = {
		'm22': { hat: finalOf(h22, q) },
		'm15': { hat: finalOf(h15, q) },
		'm15-g02': { hat: finalOf(gated(h15, q.dsp.hat, q.fps, 0.02), q) },
		'm15-g05': { hat: finalOf(gated(h15, q.dsp.hat, q.fps, 0.05), q) },
		'm15-g10': { hat: finalOf(gated(h15, q.dsp.hat, q.fps, 0.10), q) },
		'm22-g05': { hat: finalOf(gated(h22, q.dsp.hat, q.fps, 0.05), q) },
		'm15-g05+cym': { hat: finalOf(merged(gated(h15, q.dsp.hat, q.fps, 0.05), cym), q) },
		'm15+cym': { hat: finalOf(merged(h15, cym), q) }
	};
	const both = [...labels.hat, ...labels.cymbal].sort((a, b) => a - b);
	for (const [stage, times] of Object.entries(stages)) {
		const s = score(both, [...times.hat].sort((a, b) => a - b));
		const u = (union[stage] ??= { tp: 0, fp: 0, fn: 0 });
		u.tp += s.tp; u.fp += s.fp; u.fn += s.fn;
	}
	return stages;
}, { only, notes: ['All stages snap to the odf and quantise on the cached grid; hat class scored vs HH labels.'] });
console.log('\nPooled vs HH+CY labels (hats and cymbals together):');
for (const [stage, u] of Object.entries(union)) {
	const p = u.tp / Math.max(1, u.tp + u.fp), r = u.tp / Math.max(1, u.tp + u.fn);
	console.log(`  ${stage.padEnd(12)} P ${fmt(p)} R ${fmt(r)} F ${fmt(2 * p * r / Math.max(1e-9, p + r))}`);
}

if (!args.includes('--no-library')) {
	const cache = benchmarkCache();
	const spans: [string, number, number][] = [
		['UARSiWU8eoo', 25, 60], ['bEgS_KJCxTU', 95, 130], ['-5XxjPOedc0', 60, 90],
		['NQbkGDoD7B0', 0, 45], ['XqoanTj5pNY', 0, 285], ['9vWNauaZAgg', 0, 32], ['IxJjY5T9yag', 0, 40]
	];
	console.log('\nLibrary spans: model hats kept by the DSP gate (counts in span)');
	for (const [id, from, to] of spans) {
		const act = readF32(join('bench/reports/audio-reliability/library-activations', `${id}.f32`));
		const a = JSON.parse(readFileSync(join(cache, `${id}.analysis.json`), 'utf8'));
		const decoded = await decodeAudio(join(cache, `${id}.m4a`));
		const features = extractFeatures(normalised(decoded.mono, decoded.sampleRate), decoded.sampleRate);
		const dsp = detectDrums(features.spec, { beatPeriod: a.tempo.beatPeriod, odf: features.odf });
		const inSpan = (s: DrumStream) => s.times.filter((t) => t >= from && t < to).length;
		const h15 = modelStream(act, 'hat', 0.15);
		const h22 = modelStream(act, 'hat', 0.22);
		const cym = modelStream(act, 'cymbal', 0.30);
		const shipped = a.onsets.hat.times.filter((t: number) => t >= from && t < to).length;
		console.log(`  ${id} ${a.title.slice(0, 22).padEnd(22)} ${from}-${to}s shipped ${shipped} dsp ${inSpan(dsp.hat)}`
			+ ` m22 ${inSpan(h22)} m15 ${inSpan(h15)} m15-g02 ${inSpan(gated(h15, dsp.hat, features.curves.fps, 0.02))}`
			+ ` m15-g05 ${inSpan(gated(h15, dsp.hat, features.curves.fps, 0.05))} m22-g05 ${inSpan(gated(h22, dsp.hat, features.curves.fps, 0.05))}`
			+ ` cym ${inSpan(cym)} beats ${a.beats.filter((t: number) => t >= from && t < to).length}`);
	}
}
