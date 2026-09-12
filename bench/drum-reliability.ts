// node bench/drum-reliability.ts ID ... --out=bench/reports/audio-reliability/run
// --replay reuses captured quantisation inputs without audio decoding or model inference.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { OnsetStream, TrackAnalysis, TrackContext } from '@mv/core';
import { gridTrust } from '@mv/core';
import { Adtof, type AdtofOnsets } from '../packages/analysis/src/adtof.ts';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { decodeAudio } from '../packages/analysis/src/decode.ts';
import type { DrumStream } from '../packages/analysis/src/drums.ts';
import { publishedLevel } from '../packages/analysis/src/ingest.ts';
import { quantiseOnsets } from '../packages/analysis/src/quantise.ts';
import { benchmarkCache } from './cache.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const cache = resolve(benchmarkCache(flag('cache')));
const metadata = resolve(flag('metadata') ?? cache);
const out = resolve(flag('out') ?? 'bench/reports/audio-reliability/run');
const beforeRoot = resolve(flag('before') ?? 'bench/reports/audio-reliability/baseline-source/packages/analysis/src');
const modelEvidence = resolve(flag('evidence') ?? 'bench/reports/audio-reliability/model-evidence');
const importEvidence = flag('import-evidence');
const replay = args.includes('--replay');
const captureOnly = args.includes('--capture-only');
const all = args.includes('--all');
const ids = all
	? readdirSync(metadata).filter((f) => f.endsWith('.analysis.json')).map((f) => f.slice(0, -14))
	: args.filter((a) => !a.startsWith('--'));
if (!ids.length || ids.some((id) => !/^[\w-]+$/.test(id))) throw new Error('Pass cached track ids or --all.');
for (const target of [out, modelEvidence]) {
	if (target === cache || target.startsWith(cache + '\\') || target.startsWith(cache + '/')) {
		throw new Error('Diagnostic output must be outside the live audio cache.');
	}
}
mkdirSync(out, { recursive: true });
mkdirSync(modelEvidence, { recursive: true });
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const json = (value: unknown) => JSON.stringify(value, (_key, item) => ArrayBuffer.isView(item)
	? Array.from(item as unknown as ArrayLike<number>) : item);
const save = (path: string, value: unknown) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, json(value));
};
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const kit = ['kick', 'snare', 'hat'] as const;
type Kind = typeof kit[number];
type QuantiseInput = Parameters<typeof quantiseOnsets>[1] & { barTimes?: Float64Array };
type Quantised = ReturnType<typeof quantiseOnsets>;
interface Capture {
	dsp: Record<Kind, DrumStream>;
	detected: Record<Kind, DrumStream>;
	quantiseOptions: QuantiseInput;
	final: Record<Kind, Quantised>;
}
interface Evidence {
	hash: string;
	tracked: { beats: number[]; downbeats: number[] };
	drums: AdtofOnsets;
	provenance?: Record<string, unknown>;
	activationFile?: string;
}
function restoreStreams(streams: Record<Kind, DrumStream>): void {
	for (const kind of kit) {
		streams[kind].curve = Float32Array.from(streams[kind].curve);
		if (streams[kind].levelCurve) streams[kind].levelCurve = Float32Array.from(streams[kind].levelCurve);
	}
}
function calibrateLegacyModel(streams: Record<Kind, DrumStream>): void {
	for (const kind of kit) {
		const stream = streams[kind];
		if (stream.levelCurve) continue;
		const heights = stream.times.map((t) => stream.curve[Math.round(t * stream.fps)]).sort((a, b) => a - b);
		const top = Math.max(0.6, heights[Math.floor(heights.length * 0.9)] ?? 0);
		stream.levelCurve = Float32Array.from(stream.curve, (height) => Math.min(1, height / top) * Math.min(1, height / 0.6));
		if (stream.times.some((t, i) => Math.abs(stream.levelCurve![Math.round(t * stream.fps)] - stream.levels[i]) > 1e-6)) {
			throw new Error(`Legacy ${kind} stream does not use the frozen absolute-strength mapping.`);
		}
	}
}
function restoreCapture(probe: Capture): void {
	restoreStreams(probe.dsp);
	restoreStreams(probe.detected);
	probe.quantiseOptions.beats = Float64Array.from(probe.quantiseOptions.beats);
	if (probe.quantiseOptions.barGroup) probe.quantiseOptions.barGroup = Int32Array.from(probe.quantiseOptions.barGroup);
	if (probe.quantiseOptions.barTimes) probe.quantiseOptions.barTimes = Float64Array.from(probe.quantiseOptions.barTimes);
}
function changes(before: OnsetStream, after: OnsetStream) {
	const prior = new Set(before.times.map((t) => Math.round(t * 1000)));
	const next = new Set(after.times.map((t) => Math.round(t * 1000)));
	return {
		before: before.times.length,
		after: after.times.length,
		removed: before.times.filter((t) => !next.has(Math.round(t * 1000))),
		added: after.times.filter((t) => !prior.has(Math.round(t * 1000)))
	};
}
function stats(stream: Quantised, raw: DrumStream, duration: number) {
	const rawTimes = new Set(raw.times);
	return {
		detected: raw.times.length,
		final: stream.times.length,
		completed: stream.invented.filter(Boolean).length,
		retainedDetections: stream.times.filter((time, i) => !stream.invented[i] && rawTimes.has(time)).length,
		inventedLevelMax: Math.max(0, ...stream.levels.filter((_level, i) => stream.invented[i])),
		invalid: stream.times.filter((t, i) => !Number.isFinite(t) || t < 0 || t >= duration
			|| !Number.isFinite(stream.levels[i]) || stream.levels[i] < 0 || stream.levels[i] > 1).length,
		outOfOrder: stream.times.filter((t, i) => i > 0 && t < stream.times[i - 1]).length
	};
}
const frozen = await import(pathToFileURL(join(beforeRoot, 'analyze.ts')).href) as { analyzeTrack: typeof analyzeTrack };
const frozenQuantise = await import(pathToFileURL(join(beforeRoot, 'quantise.ts')).href) as { quantiseOnsets: typeof quantiseOnsets };
const run: Record<string, unknown> = {
	created: new Date().toISOString(),
	head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
	node: process.version,
	cache, metadata, beforeRoot, modelEvidence, replay,
	sourceHashes: Object.fromEntries(['analyze', 'quantise', 'adtof'].map((name) => [name,
		sha(join(import.meta.dirname, '../packages/analysis/src', name + '.ts'))])),
	limitations: ['Counts and output differences are not labelled accuracy.',
		'Fresh analysis omits listener section maps so labels are not copied into an evaluation.',
		'Raw stored Beat This! timings are reused; this run does not evaluate a new beat model.'],
	tracks: []
};
const rows = run.tracks as Record<string, unknown>[];
let model: Adtof | null = null;
try {
	for (const id of ids) {
		const at = performance.now();
		const cached = read<TrackAnalysis>(join(metadata, `${id}.analysis.json`));
		const contextPath = join(metadata, `${id}.context.json`);
		const context = existsSync(contextPath) ? read<TrackContext>(contextPath) : undefined;
		const probePath = join(out, `${id}.probe.json`);
		let captured: Capture;
		let row: Record<string, unknown> = { id, title: cached.title, genre: context?.genreFamily ?? null, duration: cached.duration };
		if (replay) {
			captured = read<Capture>(probePath);
			restoreCapture(captured);
		} else {
			const file = readdirSync(cache).find((f) => f.startsWith(id + '.') && /\.(m4a|mp3|wav|flac|ogg|opus|webm|aac|mp4|mka)$/i.test(f));
			if (!file) throw new Error(`Audio missing: ${id}`);
			const audio = join(cache, file);
			const decodeAt = performance.now();
			const decoded = await decodeAudio(audio);
			const decodeMs = performance.now() - decodeAt;
			const evidencePath = join(modelEvidence, `${id}.json`);
			let evidence: Evidence;
			let inferenceMs = 0;
			const imported = importEvidence ? join(importEvidence, `${id}.json`) : '';
			if (existsSync(evidencePath)) {
				evidence = read<Evidence>(evidencePath);
			} else if (imported && existsSync(imported)) {
				evidence = read<Evidence>(imported);
				evidence.provenance = { importedFrom: resolve(imported), sourceSha256: sha(imported), modelPreprocessing: 'frozen v33 evidence' };
				if (evidence.hash !== decoded.hash) throw new Error(`Imported evidence PCM hash mismatch: ${id}`);
				save(evidencePath, evidence);
			} else {
				if (!cached.heard?.beats.length) throw new Error(`Raw beat evidence missing: ${id}`);
				console.log(`${cached.title}: ADTOF inference`);
				model ??= await Adtof.create();
				if (!model) throw new Error('ADTOF model unavailable.');
				const wide = await decodeAudio(audio, 44100);
				const activation: { activations?: Float32Array } = {};
				const inferAt = performance.now();
				const drums = await model.run(wide.mono, activation);
				inferenceMs = performance.now() - inferAt;
				const activationFile = join(modelEvidence, `${id}.activations.f32`);
				if (activation.activations) writeFileSync(activationFile, Buffer.from(activation.activations.buffer,
					activation.activations.byteOffset, activation.activations.byteLength));
				evidence = {
					hash: decoded.hash, tracked: cached.heard, drums, activationFile,
					provenance: { created: new Date().toISOString(), audioSha256: sha(audio),
						adtofSourceSha256: sha(join(import.meta.dirname, '../packages/analysis/src/adtof.ts')),
						inferenceMs, beatSource: 'frozen cached heard beats/downbeats', activationShape: [activation.activations!.length / 5, 5], activationFps: 100 }
				};
				save(evidencePath, evidence);
			}
			if (evidence.hash !== decoded.hash) throw new Error(`Evidence PCM hash mismatch: ${id}`);
			restoreStreams(evidence.drums);
			calibrateLegacyModel(evidence.drums);
			if (captureOnly) {
				rows.push({ ...row, evidencePath, decodeMs, inferenceMs, totalMs: performance.now() - at });
				save(join(out, 'results.json'), run);
				console.log(`${cached.title}: raw evidence cached`);
				continue;
			}
			const metricalLevel = context?.publishedBpm ? publishedLevel(evidence.tracked.beats,
				context.publishedBpm, context.genreFamily, { downbeats: evidence.tracked.downbeats, snares: evidence.drums.snare.times }) ?? undefined : undefined;
			const input = { ...decoded, trackId: id, title: cached.title, context,
				beats: evidence.tracked.beats, downbeats: evidence.tracked.downbeats, drums: evidence.drums, metricalLevel };
			const beforeAt = performance.now();
			const before = frozen.analyzeTrack(input);
			const beforeMs = performance.now() - beforeAt;
			const probe: NonNullable<Parameters<typeof analyzeTrack>[0]['probe']> & { drums?: Capture } = {};
			const afterAt = performance.now();
			const after = analyzeTrack({ ...input, probe });
			const afterMs = performance.now() - afterAt;
			if (!probe.drums) throw new Error('Analyzer probe.drums is required for exact-path diagnostics.');
			captured = probe.drums;
			save(probePath, captured);
			save(join(out, `${id}.before.analysis.json`), before);
			save(join(out, `${id}.after.analysis.json`), after);
			row = { ...row, audioHash: decoded.hash, metricalLevel, decodeMs, inferenceMs, beforeMs, afterMs,
				beatsUnchanged: json(before.beats) === json(after.beats),
				barTimesUnchanged: json(before.tempo.barTimes) === json(after.tempo.barTimes),
				sectionsUnchanged: json(before.sections) === json(after.sections),
				beforeSections: before.sections.map((s) => `${s.kind}@${s.startBar}`),
				afterSections: after.sections.map((s) => `${s.kind}@${s.startBar}`),
				trustBefore: gridTrust(before, context?.publishedBpm), trustAfter: gridTrust(after, context?.publishedBpm),
				fullAnalysisDrums: Object.fromEntries(kit.map((kind) => [kind, changes(before.onsets[kind], after.onsets[kind])]))
			};
		}
		const diagnostics = Object.fromEntries(kit.map((kind) => {
			const stream = captured.detected[kind];
			const before = frozenQuantise.quantiseOnsets(stream, captured.quantiseOptions);
			const after = quantiseOnsets(stream, captured.quantiseOptions);
			return [kind, { before: stats(before, stream, cached.duration), after: stats(after, stream, cached.duration),
				changes: changes(before, after), matchesCaptured: json(after) === json(captured.final[kind]) }];
		}));
		rows.push({ ...row, quantise: diagnostics, totalMs: performance.now() - at });
		save(join(out, replay ? 'replay-results.json' : 'results.json'), run);
		console.log(`${cached.title}: ${kit.map((kind) => `${kind} ${diagnostics[kind].before.final}->${diagnostics[kind].after.final}`).join(', ')}; ${((performance.now() - at) / 1000).toFixed(1)}s`);
	}
} finally {
	await model?.close();
}
