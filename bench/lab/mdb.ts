// Shared MDB Drums lab: corpus, labels, cached model outputs and mir_eval-style scoring, so a
// drum experiment scores a variant without re-running Beat This or ADTOF.
//   node bench/lab/mdb.ts [--stems] [--tracks=Rock,Disco] [--rebuild]   warms every cache
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Adtof, activationStream } from '../../packages/analysis/src/adtof.ts';
import { analyzeTrack } from '../../packages/analysis/src/analyze.ts';
import { BeatThis } from '../../packages/analysis/src/beatthis.ts';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import { detectDrums, snapTimesToOnsets, type DrumStream } from '../../packages/analysis/src/drums.ts';
import { extractFeatures } from '../../packages/analysis/src/features.ts';
import { measureLoudness } from '../../packages/analysis/src/loudness.ts';
import { MODEL_DIR } from '../../packages/analysis/src/paths.ts';
import { quantiseOnsets } from '../../packages/analysis/src/quantise.ts';

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const dirs = {
	corpus: join(ROOT, 'bench', 'corpus', 'mdb-drums'),
	out: join(ROOT, 'bench', 'reports', 'audio-reliability', 'mdb'),
	lab: join(ROOT, 'bench', 'reports', 'audio-reliability', 'lab')
};
export function configure(overrides: Partial<typeof dirs>): void {
	Object.assign(dirs, overrides);
}

export const WINDOW = 0.05;
/** Shipping per-class peak thresholds (adtof.ts THRESHOLDS): kick, snare, tom, hat, cymbal. */
export const THRESHOLDS = [0.22, 0.24, 0.32, 0.22, 0.3] as const;
export const CHANNEL = { kick: 0, snare: 1, tom: 2, hat: 3, cymbal: 4 } as const;
export const CLASSES = 5;
/** The model is exactly 100 fps at 44.1 kHz; analysis features run at 22050 / 221 = 99.77 fps. */
export const MODEL_FPS = 100;
export const ADTOF_RATE = 44100;
export const TARGET_LUFS = -14;
export const KIT = ['kick', 'snare', 'hat'] as const;
export type Kind = typeof KIT[number];
export type ClassName = keyof typeof CHANNEL;
export type Times = Record<Kind, number[]>;

export const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
export const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const pcmHash = (pcm: Float32Array) => createHash('sha256')
	.update(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)).digest('hex').slice(0, 16);
export const div = (a: number, b: number) => (b > 0 ? a / b : 0);
export const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const fmt = (v: number, d = 3) => v.toFixed(d);
export const signed = (v: number, d = 3) => (v >= 0 ? '+' : '') + v.toFixed(d);
export function quantileOf(xs: readonly number[], q: number): number {
	if (xs.length === 0) return 0;
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}
export function readF32(path: string): Float32Array {
	const raw = readFileSync(path);
	return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}
export function writeF32(path: string, data: Float32Array): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}
export function writeJson(path: string, value: unknown, pretty = true): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, pretty ? JSON.stringify(value, null, '\t') : JSON.stringify(value));
}
export function gitHead(): string {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: ROOT }).trim();
	} catch {
		return 'unknown';
	}
}

export interface Track {
	name: string;
	mixPath: string;
	stemPath: string;
	classPath: string;
	subclassPath: string;
}
export function track(name: string): Track {
	return {
		name,
		mixPath: join(dirs.corpus, 'audio', 'full_mix', `${name}_MIX.wav`),
		stemPath: join(dirs.corpus, 'audio', 'drum_only', `${name}_Drum.wav`),
		classPath: join(dirs.corpus, 'annotations', 'class', `${name}_class.txt`),
		subclassPath: join(dirs.corpus, 'annotations', 'subclass', `${name}_subclass.txt`)
	};
}
/** Every corpus track, or those whose name contains one of `only`, sorted by name. */
export function corpus(only: readonly string[] = []): Track[] {
	return readdirSync(join(dirs.corpus, 'audio', 'full_mix'))
		.filter((f) => f.endsWith('_MIX.wav'))
		.map((f) => f.slice(0, -8))
		.filter((name) => only.length === 0 || only.some((part) => name.includes(part)))
		.sort()
		.map(track);
}

const LABELS: Record<string, ClassName | 'other'> =
	{ KD: 'kick', SD: 'snare', HH: 'hat', TT: 'tom', CY: 'cymbal', OT: 'other' };
export interface Labels {
	kick: number[];
	snare: number[];
	hat: number[];
	tom: number[];
	cymbal: number[];
	other: number[];
	/** Every annotated onset of any class, for drumless-span checks. */
	all: number[];
	/** MDB subclass rows (SDG ghost, PHH pedal, RDC ride ...) in file order. */
	subclass: { time: number; sub: string }[];
}
export function loadLabels(name: string): Labels {
	const t = track(name);
	const lists: Record<string, number[]> = { kick: [], snare: [], hat: [], tom: [], cymbal: [], other: [] };
	for (const line of readFileSync(t.classPath, 'utf8').split('\n')) {
		const [time, cls] = line.trim().split(/\s+/);
		if (!time || !cls) continue;
		const kind = LABELS[cls];
		if (!kind) throw new Error(`${basename(t.classPath)}: unknown class ${cls}`);
		lists[kind].push(Number(time));
	}
	for (const list of Object.values(lists)) list.sort((a, b) => a - b);
	const subclass: { time: number; sub: string }[] = [];
	if (existsSync(t.subclassPath)) {
		for (const line of readFileSync(t.subclassPath, 'utf8').split('\n')) {
			const [time, sub] = line.trim().split(/\s+/);
			if (time && sub) subclass.push({ time: Number(time), sub });
		}
	}
	return {
		kick: lists.kick, snare: lists.snare, hat: lists.hat,
		tom: lists.tom, cymbal: lists.cymbal, other: lists.other,
		all: Object.values(lists).flat().sort((a, b) => a - b),
		subclass
	};
}

export type Decoded = Awaited<ReturnType<typeof decodeAudio>>;
export type Features = ReturnType<typeof extractFeatures>;
export function audioPath(name: string, stem = false): string {
	const t = track(name);
	return stem ? t.stemPath : t.mixPath;
}
/** 22.05 kHz analysis decode by default; 44100 for the model input. */
export function decodeMix(name: string, sampleRate?: number, stem = false): Promise<Decoded> {
	return decodeAudio(audioPath(name, stem), sampleRate);
}
/** analyzeTrack's loudness normalisation, so standalone stages see the same PCM it does. */
export function normalised(mono: Float32Array, sampleRate: number): Float32Array {
	const loudness = measureLoudness(mono, sampleRate);
	const gain = Math.pow(10, (TARGET_LUFS - loudness.integrated) / 20);
	const copy = Float32Array.from(mono);
	if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
		const g = Math.min(gain, 40);
		for (let i = 0; i < copy.length; i++) copy[i] *= g;
	}
	return copy;
}
export function featuresOf(decoded: Pick<Decoded, 'mono' | 'sampleRate'>): Features {
	return extractFeatures(normalised(decoded.mono, decoded.sampleRate), decoded.sampleRate);
}
export async function features(name: string, stem = false): Promise<Features> {
	return featuresOf(await decodeMix(name, undefined, stem));
}

let adtof: Adtof | null = null;
let beatThis: BeatThis | null = null;
async function adtofModel(): Promise<Adtof> {
	adtof ??= await Adtof.create();
	if (!adtof) throw new Error('ADTOF model unavailable.');
	return adtof;
}
export const beatModelPresent = (): boolean => existsSync(join(MODEL_DIR, 'beat_this.onnx'));
/** Release ONNX sessions; call before the process ends. */
export async function closeModels(): Promise<void> {
	await adtof?.close();
	await beatThis?.close();
	adtof = null;
	beatThis = null;
}

export function classCurve(act: Float32Array, channel: number): Float32Array {
	const frames = act.length / CLASSES;
	const curve = new Float32Array(frames);
	for (let t = 0; t < frames; t++) curve[t] = act[t * CLASSES + channel];
	return curve;
}
export function modelStream(act: Float32Array, cls: ClassName, threshold = THRESHOLDS[CHANNEL[cls]]): DrumStream {
	return activationStream(classCurve(act, CHANNEL[cls]), threshold);
}
/** Kit streams at `thresholds` (indexed like THRESHOLDS): the adtof.ts output before snapping. */
export function modelStreams(act: Float32Array, thresholds: readonly number[] = THRESHOLDS): Record<Kind, DrumStream> {
	return {
		kick: activationStream(classCurve(act, CHANNEL.kick), thresholds[CHANNEL.kick]),
		snare: activationStream(classCurve(act, CHANNEL.snare), thresholds[CHANNEL.snare]),
		hat: activationStream(classCurve(act, CHANNEL.hat), thresholds[CHANNEL.hat])
	};
}
export const timesOf = (streams: Record<Kind, { times: number[] }>): Times =>
	({ kick: streams.kick.times, snare: streams.snare.times, hat: streams.hat.times });
export const round3 = (v: number) => Math.round(v * 1000) / 1000;
/** What analyzeTrack ships (roundStream): quantised times rounded to the millisecond. */
export const shipRound = (times: readonly number[]): number[] => times.map(round3);
export const streamHash = (drums: Record<Kind, DrumStream>): string => createHash('sha256')
	.update(JSON.stringify(KIT.map((kind) => drums[kind].times))).digest('hex');

export interface AdtofRun {
	act: Float32Array;
	hash: string;
	inferenceMs: number;
	cached: boolean;
}
/** Inference on 44.1 kHz mono PCM, cached under activations/by-hash by the PCM's own hash. */
export async function runAdtof(pcm44k: Float32Array): Promise<AdtofRun> {
	const hash = pcmHash(pcm44k);
	const path = join(dirs.out, 'activations', 'by-hash', `${hash}.f32`);
	const metaPath = `${path.slice(0, -4)}.json`;
	if (existsSync(path) && existsSync(metaPath)) {
		const inferenceMs = read<{ inferenceMs: number }>(metaPath).inferenceMs;
		return { act: readF32(path), hash, inferenceMs, cached: true };
	}
	const model = await adtofModel();
	const probe: { activations?: Float32Array } = {};
	const at = performance.now();
	await model.run(pcm44k, probe);
	const inferenceMs = performance.now() - at;
	const act = probe.activations!;
	writeF32(path, act);
	writeJson(metaPath, {
		hash, frames: act.length / CLASSES, classes: CLASSES, fps: MODEL_FPS, inferenceMs,
		created: new Date().toISOString()
	});
	return { act, hash, inferenceMs, cached: false };
}

export interface ActivationMeta {
	/** Decoded 44.1 kHz PCM hash for the shipped input; the transformed PCM's hash for a variant. */
	hash: string;
	frames: number;
	classes: number;
	fps: number;
	audioSha256?: string;
	streamHash?: string;
	inferenceMs: number;
	created: string;
	variant?: string;
	sourceHash?: string;
	pcmHash?: string;
}
export interface ActivationOptions {
	stem?: boolean;
	/** Names a PCM transform; cached separately as <name>[.drum_only].<variant>.f32. */
	variant?: string;
	transform?: (pcm44k: Float32Array, sampleRate: number) => Float32Array | Promise<Float32Array>;
	/** Re-decode and compare the cached hash; otherwise a name-keyed cache file is trusted. */
	verify?: boolean;
	/** The 44.1 kHz decode when the caller already has it; implies verify. */
	wide?: Decoded;
}
export interface ActivationRecord {
	/** frames x 5, class order kick, snare, tom, hat, cymbal, at MODEL_FPS. */
	act: Float32Array;
	meta: ActivationMeta;
	path: string;
	cached: boolean;
}
export function activationPath(name: string, opts: ActivationOptions = {}): string {
	const suffix = (opts.stem ? '.drum_only' : '') + (opts.variant ? `.${opts.variant}` : '');
	return join(dirs.out, 'activations', `${name}${suffix}.f32`);
}
export async function activationRecord(name: string, opts: ActivationOptions = {}): Promise<ActivationRecord> {
	const path = activationPath(name, opts);
	const metaPath = `${path.slice(0, -4)}.json`;
	const have = existsSync(path) && existsSync(metaPath) ? read<ActivationMeta>(metaPath) : null;
	if (have && !opts.verify && !opts.wide) return { act: readF32(path), meta: have, path, cached: true };
	const wide = opts.wide ?? await decodeMix(name, ADTOF_RATE, opts.stem);
	if (have && (opts.variant ? have.sourceHash : have.hash) === wide.hash) {
		return { act: readF32(path), meta: have, path, cached: true };
	}
	if (opts.variant && !opts.transform) {
		throw new Error(`${name}: no cached activations for variant ${opts.variant} and no transform.`);
	}
	const pcm = opts.transform ? await opts.transform(wide.mono, ADTOF_RATE) : wide.mono;
	const run = await runAdtof(pcm);
	writeF32(path, run.act);
	const meta: ActivationMeta = {
		hash: opts.variant ? run.hash : wide.hash, frames: run.act.length / CLASSES, classes: CLASSES,
		fps: MODEL_FPS, audioSha256: sha256(audioPath(name, opts.stem)),
		streamHash: streamHash(modelStreams(run.act)), inferenceMs: run.inferenceMs,
		created: new Date().toISOString(), sourceHash: wide.hash, pcmHash: run.hash,
		...(opts.variant ? { variant: opts.variant } : {})
	};
	writeJson(metaPath, meta);
	return { act: run.act, meta, path, cached: false };
}
export async function activations(name: string, opts: ActivationOptions = {}): Promise<Float32Array> {
	return (await activationRecord(name, opts)).act;
}

export interface BeatRecord {
	beats: number[];
	downbeats: number[];
	hash: string;
	ms: number;
	cached: boolean;
}
export function beatPath(name: string, stem = false): string {
	return join(dirs.out, 'beats', `${name}${stem ? '.drum_only' : ''}.json`);
}
/** Cached Beat This result; null when the model is absent and nothing is cached. */
export async function beats(
	name: string,
	opts: { stem?: boolean; decoded?: Decoded; verify?: boolean } = {}
): Promise<BeatRecord | null> {
	const path = beatPath(name, opts.stem);
	const have = existsSync(path) ? read<Omit<BeatRecord, 'cached'>>(path) : null;
	if (have && !opts.verify && !opts.decoded) return { ...have, cached: true };
	const decoded = opts.decoded ?? await decodeMix(name, undefined, opts.stem);
	if (have && have.hash === decoded.hash) return { ...have, cached: true };
	if (!beatModelPresent()) return null;
	beatThis ??= await BeatThis.create();
	const at = performance.now();
	const tracked = await beatThis.run(decoded.mono);
	const ms = performance.now() - at;
	const meta = { hash: decoded.hash, ...tracked, ms };
	writeJson(path, meta, false);
	return { ...meta, cached: false };
}

export interface QuantiseInputs {
	beats: Float64Array;
	beatsPerBar: number;
	downbeatPhase: number;
	barGroup: Int32Array;
	barTimes: Float64Array;
	duration: number;
	/** The grid period analyzeTrack detected and snapped with; snapRadius = min(50 ms, period / 8). */
	beatPeriod: number;
	bpm: number;
	snapRadius: number;
	/** Rate of `odf` and the DSP curves: 22050 / 221 = 99.77, not the model's 100. */
	fps: number;
	odf: Float32Array;
	dsp: Record<Kind, DrumStream>;
	/** Times analyzeTrack quantised: snapped model kick and snare, the DSP hat. */
	detected: Times;
	final: Record<Kind, { times: number[]; levels: number[]; invented: boolean[] }>;
	/** Whether standalone detectDrums/snapTimesToOnsets with these inputs reproduced the probe. */
	parity: { dsp: boolean; snapped: boolean };
}
interface QuantiseFile {
	hash: string;
	activationHash: string;
	head: string;
	created: string;
	beats: number[];
	beatsPerBar: number;
	downbeatPhase: number;
	barGroup: number[];
	barTimes: number[];
	duration: number;
	beatPeriod: number;
	bpm: number;
	fps: number;
	frames: Record<'odf' | Kind, number>;
	dsp: Record<Kind, { times: number[]; levels: number[]; fps: number }>;
	detected: Times;
	final: QuantiseInputs['final'];
	parity: QuantiseInputs['parity'];
}
export function quantisePath(name: string, stem = false): string {
	return join(dirs.out, 'quantise', `${name}${stem ? '.drum_only' : ''}.json`);
}
function loadQuantise(path: string): QuantiseInputs {
	const file = read<QuantiseFile>(path);
	const curves = readF32(`${path.slice(0, -5)}.f32`);
	let at = 0;
	const slice = (n: number) => {
		const out = curves.slice(at, at + n);
		at += n;
		return out;
	};
	const odf = slice(file.frames.odf);
	const dsp = {} as Record<Kind, DrumStream>;
	for (const kind of KIT) dsp[kind] = { ...file.dsp[kind], curve: slice(file.frames[kind]) };
	return {
		beats: Float64Array.from(file.beats), beatsPerBar: file.beatsPerBar, downbeatPhase: file.downbeatPhase,
		barGroup: Int32Array.from(file.barGroup), barTimes: Float64Array.from(file.barTimes),
		duration: file.duration, beatPeriod: file.beatPeriod, bpm: file.bpm,
		snapRadius: Math.min(0.05, file.beatPeriod / 8), fps: file.fps,
		odf, dsp, detected: file.detected, final: file.final, parity: file.parity
	};
}
const sameTimes = (a: readonly number[], b: readonly number[]) =>
	a.length === b.length && a.every((t, i) => t === b[i]);
/** The streams analyzeTrack quantised, rebuilt from cached times and the model's own curves. */
export function shippedDetected(q: QuantiseInputs, model: Record<Kind, DrumStream>): Record<Kind, DrumStream> {
	return {
		kick: { ...model.kick, times: q.detected.kick },
		snare: { ...model.snare, times: q.detected.snare },
		hat: q.dsp.hat
	};
}
async function buildQuantise(name: string, stem: boolean): Promise<QuantiseInputs> {
	const decoded = await decodeMix(name, undefined, stem);
	const tracked = await beats(name, { stem, decoded });
	const rec = await activationRecord(name, { stem });
	const model = modelStreams(rec.act);
	const probe: NonNullable<Parameters<typeof analyzeTrack>[0]['probe']> = {};
	const analysis = analyzeTrack({
		mono: decoded.mono, left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate,
		duration: decoded.duration, hash: decoded.hash, trackId: name, title: name,
		beats: tracked?.beats, downbeats: tracked?.downbeats, drums: model, probe
	});
	const captured = probe.drums;
	if (!captured) throw new Error(`${name}: analyzeTrack did not fill probe.drums.`);
	const q = captured.quantiseOptions;
	const feats = featuresOf(decoded);
	const beatPeriod = analysis.tempo.beatPeriod;
	const dsp = detectDrums(feats.spec, { beatPeriod, odf: feats.odf });
	const radius = Math.min(0.05, beatPeriod / 8);
	const parity = {
		dsp: KIT.every((kind) => sameTimes(dsp[kind].times, captured.dsp[kind].times)),
		snapped: (['kick', 'snare'] as const).every((kind) => sameTimes(
			snapTimesToOnsets(model[kind].times, feats.odf, feats.curves.fps, radius), captured.detected[kind].times))
	};
	const path = quantisePath(name, stem);
	const file: QuantiseFile = {
		hash: decoded.hash, activationHash: rec.meta.hash, head: gitHead(), created: new Date().toISOString(),
		beats: Array.from(q.beats), beatsPerBar: q.beatsPerBar, downbeatPhase: q.downbeatPhase ?? 0,
		barGroup: Array.from(q.barGroup ?? []), barTimes: Array.from(q.barTimes ?? []), duration: q.duration,
		beatPeriod, bpm: analysis.tempo.bpm, fps: feats.curves.fps,
		frames: {
			odf: feats.odf.length, kick: captured.dsp.kick.curve.length,
			snare: captured.dsp.snare.curve.length, hat: captured.dsp.hat.curve.length
		},
		dsp: Object.fromEntries(KIT.map((kind) => [kind, {
			times: captured.dsp[kind].times, levels: captured.dsp[kind].levels, fps: captured.dsp[kind].fps
		}])) as QuantiseFile['dsp'],
		detected: timesOf(captured.detected),
		final: Object.fromEntries(KIT.map((kind) => [kind, {
			times: captured.final[kind].times, levels: captured.final[kind].levels, invented: captured.final[kind].invented
		}])) as QuantiseFile['final'],
		parity
	};
	const curves = new Float32Array(file.frames.odf + file.frames.kick + file.frames.snare + file.frames.hat);
	let at = 0;
	for (const curve of [feats.odf, captured.dsp.kick.curve, captured.dsp.snare.curve, captured.dsp.hat.curve]) {
		curves.set(curve, at);
		at += curve.length;
	}
	writeF32(`${path.slice(0, -5)}.f32`, curves);
	writeJson(path, file, false);
	const loaded = loadQuantise(path);
	const shipped = shippedDetected(loaded, model);
	for (const kind of KIT) {
		if (!sameTimes(quantiseOnsets(shipped[kind], loaded).times, captured.final[kind].times)) {
			throw new Error(`${name}: cached quantise inputs do not reproduce analyzeTrack's ${kind} stream.`);
		}
	}
	return loaded;
}
/**
 * The per-track quantise options analyzeTrack built with the shipped model streams, plus its
 * DSP streams, odf and final output. Bar groups depend on the snapped kicks, so a variant that
 * moves kicks may not get exactly the bar groups analyzeTrack would derive for it.
 */
export async function quantiseInputs(name: string, opts: { stem?: boolean; rebuild?: boolean } = {}): Promise<QuantiseInputs> {
	const path = quantisePath(name, opts.stem);
	if (!opts.rebuild && existsSync(path) && existsSync(`${path.slice(0, -5)}.f32`)) return loadQuantise(path);
	return buildQuantise(name, opts.stem ?? false);
}

/** Hopcroft-Karp maximum matching of sorted reference onsets to sorted estimates within `window`. */
export function matchEvents(ref: readonly number[], est: readonly number[], window: number): Int32Array {
	const n = ref.length;
	const m = est.length;
	const tol = window + 1e-9;
	const adj: number[][] = Array.from({ length: n }, () => []);
	let from = 0;
	for (let i = 0; i < n; i++) {
		while (from < m && est[from] < ref[i] - tol) from++;
		for (let j = from; j < m && est[j] <= ref[i] + tol; j++) adj[i].push(j);
	}
	const pairU = new Int32Array(n).fill(-1);
	const pairV = new Int32Array(m).fill(-1);
	const dist = new Int32Array(n);
	const INF = 1 << 30;
	const bfs = (): boolean => {
		const queue: number[] = [];
		let found = false;
		for (let u = 0; u < n; u++) {
			dist[u] = pairU[u] < 0 ? 0 : INF;
			if (pairU[u] < 0) queue.push(u);
		}
		for (let q = 0; q < queue.length; q++) {
			const u = queue[q];
			for (const v of adj[u]) {
				const w = pairV[v];
				if (w < 0) found = true;
				else if (dist[w] === INF) {
					dist[w] = dist[u] + 1;
					queue.push(w);
				}
			}
		}
		return found;
	};
	const dfs = (u: number): boolean => {
		for (const v of adj[u]) {
			const w = pairV[v];
			if (w < 0 || (dist[w] === dist[u] + 1 && dfs(w))) {
				pairU[u] = v;
				pairV[v] = u;
				return true;
			}
		}
		dist[u] = INF;
		return false;
	};
	while (bfs()) for (let u = 0; u < n; u++) if (pairU[u] < 0) dfs(u);
	return pairU;
}

export function nearestDistance(sorted: readonly number[], t: number): number {
	let lo = 0;
	let hi = sorted.length - 1;
	if (hi < 0) return Infinity;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] <= t) lo = mid;
		else hi = mid;
	}
	return Math.min(Math.abs(sorted[lo] - t), Math.abs(sorted[hi] - t));
}
export function rmsDbfs(mono: Float32Array, sampleRate: number, t: number, radiusSec: number): number {
	const from = Math.max(0, Math.round((t - radiusSec) * sampleRate));
	const to = Math.min(mono.length, Math.round((t + radiusSec) * sampleRate));
	let acc = 0;
	for (let i = from; i < to; i++) acc += mono[i] * mono[i];
	return to > from ? 10 * Math.log10(Math.max(1e-20, acc / (to - from))) : -Infinity;
}

export interface Score {
	ref: number;
	est: number;
	tp: number;
	fp: number;
	fn: number;
	p: number;
	r: number;
	f: number;
	/** est - ref of matched hits, ms, in reference order. */
	signedMs: number[];
}
export interface Scored extends Score {
	/** Per estimate, index-aligned with `est`. */
	matched: boolean[];
}
/** Both lists ascending; evaluate() sorts, drumscore.ts passes stream order as it always did. */
export function score(ref: readonly number[], est: readonly number[], window = WINDOW): Scored {
	const pairs = matchEvents(ref, est, window);
	const matched = est.map(() => false);
	const signedMs: number[] = [];
	for (let i = 0; i < ref.length; i++) {
		const j = pairs[i];
		if (j < 0) continue;
		matched[j] = true;
		signedMs.push((est[j] - ref[i]) * 1000);
	}
	const tp = signedMs.length;
	const p = div(tp, est.length);
	const r = div(tp, ref.length);
	return {
		ref: ref.length, est: est.length, tp, fp: est.length - tp, fn: ref.length - tp,
		p, r, f: div(2 * p * r, p + r), signedMs, matched
	};
}
export function timing(signedMs: readonly number[]) {
	const abs = signedMs.map(Math.abs);
	return {
		signedMedianMs: quantileOf(signedMs, 0.5),
		signedP90Ms: quantileOf(signedMs, 0.9),
		absMedianMs: quantileOf(abs, 0.5),
		absP90Ms: quantileOf(abs, 0.9)
	};
}
export type Timing = ReturnType<typeof timing>;

export interface TrackResult {
	name: string;
	/** stage -> class -> score; a class absent from a stage is left out of that stage's means. */
	stages: Record<string, Partial<Record<Kind, Score>>>;
}
export interface ClassSummary {
	ref: number;
	est: number;
	tp: number;
	pooled: { p: number; r: number; f: number };
	trackMean: { p: number; r: number; f: number; tracks: number };
	timing: Timing;
}
export interface StageSummary {
	classes: Partial<Record<Kind, ClassSummary>>;
	classMeanFPooled: number;
	classMeanF: number;
	trackMeanF: number;
}
/** Pooled over hits and track-mean over tracks with references, per class, as drumscore.ts. */
export function summarise(rows: readonly TrackResult[]): Record<string, StageSummary> {
	const stages = [...new Set(rows.flatMap((row) => Object.keys(row.stages)))];
	const out: Record<string, StageSummary> = {};
	for (const stage of stages) {
		const classes: Partial<Record<Kind, ClassSummary>> = {};
		for (const kind of KIT) {
			const scored = rows.flatMap((row) => {
				const s = row.stages[stage]?.[kind];
				return s ? [s] : [];
			});
			if (scored.length === 0) continue;
			const withRefs = scored.filter((s) => s.ref > 0);
			const sum = (pick: (s: Score) => number) => scored.reduce((acc, s) => acc + pick(s), 0);
			const p = div(sum((s) => s.tp), sum((s) => s.est));
			const r = div(sum((s) => s.tp), sum((s) => s.ref));
			classes[kind] = {
				ref: sum((s) => s.ref), est: sum((s) => s.est), tp: sum((s) => s.tp),
				pooled: { p, r, f: div(2 * p * r, p + r) },
				trackMean: {
					p: mean(withRefs.map((s) => s.p)), r: mean(withRefs.map((s) => s.r)),
					f: mean(withRefs.map((s) => s.f)), tracks: withRefs.length
				},
				timing: timing(scored.flatMap((s) => s.signedMs))
			};
		}
		const present = KIT.filter((kind) => classes[kind]);
		out[stage] = {
			classes,
			classMeanFPooled: mean(present.map((kind) => classes[kind]!.pooled.f)),
			classMeanF: mean(present.map((kind) => classes[kind]!.trackMean.f)),
			trackMeanF: mean(rows.filter((row) => row.stages[stage]).map((row) => mean(present
				.filter((kind) => (row.stages[stage][kind]?.ref ?? 0) > 0)
				.map((kind) => row.stages[stage][kind]!.f))))
		};
	}
	return out;
}

export interface BaselineClass {
	p: number;
	r: number;
	f: number;
	trackMeanF: number;
}
/** Per-class numbers of one stage of a drumscore.ts run (results-<label>.json). */
export function baseline(label = 'worktree', stage = 'final'): Record<Kind, BaselineClass> | null {
	const path = join(dirs.out, `results-${label}.json`);
	if (!existsSync(path)) return null;
	const json = read<{ summary: Record<string, { classes: Record<Kind, {
		pooled: { precision: number; recall: number; f: number }; trackMean: { f: number } }> }> }>(path);
	const s = json.summary[stage];
	if (!s) return null;
	return Object.fromEntries(KIT.map((kind) => [kind, {
		p: s.classes[kind].pooled.precision, r: s.classes[kind].pooled.recall,
		f: s.classes[kind].pooled.f, trackMeanF: s.classes[kind].trackMean.f
	}])) as Record<Kind, BaselineClass>;
}
export interface DiffRow {
	kind: Kind;
	p: number;
	r: number;
	f: number;
	baseF: number;
	dP: number;
	dR: number;
	dF: number;
	trackMeanF: number;
	baseTrackMeanF: number;
	dTrackMeanF: number;
}
export function diff(stage: StageSummary, base: Record<Kind, BaselineClass>): DiffRow[] {
	return KIT.flatMap((kind) => {
		const c = stage.classes[kind];
		if (!c) return [];
		const b = base[kind];
		return [{
			kind, p: c.pooled.p, r: c.pooled.r, f: c.pooled.f, baseF: b.f,
			dP: c.pooled.p - b.p, dR: c.pooled.r - b.r, dF: c.pooled.f - b.f,
			trackMeanF: c.trackMean.f, baseTrackMeanF: b.trackMeanF, dTrackMeanF: c.trackMean.f - b.trackMeanF
		}];
	});
}
export function formatDiff(diffs: Record<string, DiffRow[]>): string[] {
	const lines = [
		'| Stage | Class | P | R | F | base F | delta F | F track-mean | base | delta | delta P | delta R |',
		'|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
	];
	for (const [stage, rows] of Object.entries(diffs)) {
		for (const d of rows) {
			lines.push(`| ${stage} | ${d.kind} | ${fmt(d.p)} | ${fmt(d.r)} | ${fmt(d.f)} | ${fmt(d.baseF)} | ${signed(d.dF)} `
				+ `| ${fmt(d.trackMeanF)} | ${fmt(d.baseTrackMeanF)} | ${signed(d.dTrackMeanF)} | ${signed(d.dP)} | ${signed(d.dR)} |`);
		}
		lines.push(`| ${stage} | class-mean | | | ${fmt(mean(rows.map((d) => d.f)))} | ${fmt(mean(rows.map((d) => d.baseF)))} `
			+ `| ${signed(mean(rows.map((d) => d.dF)))} | ${fmt(mean(rows.map((d) => d.trackMeanF)))} `
			+ `| ${fmt(mean(rows.map((d) => d.baseTrackMeanF)))} | ${signed(mean(rows.map((d) => d.dTrackMeanF)))} | | |`);
	}
	return lines;
}

export interface ReportOptions {
	baselineLabel?: string;
	baselineStage?: string;
	window?: number;
}
export function report(label: string, rows: readonly TrackResult[], notes: readonly string[] = [], opts: ReportOptions = {}) {
	if (!/^[\w.-]+$/.test(label)) throw new Error('Label must be a file-safe word.');
	const baselineLabel = opts.baselineLabel ?? 'worktree';
	const baselineStage = opts.baselineStage ?? 'final';
	const window = opts.window ?? WINDOW;
	const summary = summarise(rows);
	const stages = Object.keys(summary);
	const base = baseline(baselineLabel, baselineStage);
	const diffs = base ? Object.fromEntries(stages.map((stage) => [stage, diff(summary[stage], base)])) : null;
	const created = new Date().toISOString();
	const head = gitHead();
	const json = {
		created, head, node: process.version, label, windowSec: window, notes,
		baseline: base ? { label: baselineLabel, stage: baselineStage } : null,
		summary, diffs,
		tracks: rows.map((row) => ({
			name: row.name,
			stages: Object.fromEntries(Object.entries(row.stages).map(([stage, classes]) =>
				[stage, Object.fromEntries(Object.entries(classes).map(([kind, s]) => {
					const { signedMs, matched, ...rest } = s as Scored;
					return [kind, { ...rest, ...timing(signedMs) }];
				}))]))
		}))
	};
	const jsonPath = join(dirs.lab, `${label}.json`);
	const mdPath = join(dirs.lab, `${label}.md`);
	writeJson(jsonPath, json);

	const lines: string[] = [];
	lines.push(`# ${label}`, '');
	lines.push(`${rows.length} tracks, head ${head.slice(0, 10)}, ${created}. Window +-${window * 1000} ms, Hopcroft-Karp matching.`, '');
	for (const note of notes) lines.push(`- ${note}`);
	if (notes.length) lines.push('');
	lines.push('## Per stage and class', '');
	lines.push('| Stage | Class | ref | est | tp | P | R | F | F track-mean | signed med / p90 ms | abs med / p90 ms |');
	lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
	for (const stage of stages) {
		for (const kind of KIT) {
			const c = summary[stage].classes[kind];
			if (!c) continue;
			lines.push(`| ${stage} | ${kind} | ${c.ref} | ${c.est} | ${c.tp} | ${fmt(c.pooled.p)} | ${fmt(c.pooled.r)} | ${fmt(c.pooled.f)} | ${fmt(c.trackMean.f)} `
				+ `| ${fmt(c.timing.signedMedianMs, 1)} / ${fmt(c.timing.signedP90Ms, 1)} | ${fmt(c.timing.absMedianMs, 1)} / ${fmt(c.timing.absP90Ms, 1)} |`);
		}
	}
	lines.push('', '| Stage | class-mean F (pooled) | class-mean F (track-mean) | track-mean F |', '|---|---:|---:|---:|');
	for (const stage of stages) {
		const s = summary[stage];
		lines.push(`| ${stage} | ${fmt(s.classMeanFPooled)} | ${fmt(s.classMeanF)} | ${fmt(s.trackMeanF)} |`);
	}
	if (diffs) lines.push('', `## Against ${baselineLabel} ${baselineStage}`, '', ...formatDiff(diffs));
	lines.push('', '## Per track F (kick/snare/hat)', '');
	lines.push(`| Track | refs k/s/h | ${stages.join(' | ')} |`, `|---|---|${stages.map(() => '---').join('|')}|`);
	for (const row of rows) {
		const refs = KIT.map((kind) =>
			stages.map((stage) => row.stages[stage]?.[kind]?.ref).find((n) => n !== undefined) ?? 0);
		const cells = stages.map((stage) => KIT.map((kind) => {
			const s = row.stages[stage]?.[kind];
			return s && s.ref > 0 ? fmt(s.f, 2) : '-';
		}).join('/'));
		lines.push(`| ${row.name.replace('MusicDelta_', '')} | ${refs.join('/')} | ${cells.join(' | ')} |`);
	}
	const md = lines.join('\n') + '\n';
	writeFileSync(mdPath, md);
	return { summary, diffs, jsonPath, mdPath, md };
}

export type Variant = (track: Track, labels: Labels) =>
	Promise<Record<string, Partial<Times>>> | Record<string, Partial<Times>>;
export interface EvaluateOptions extends ReportOptions {
	only?: readonly string[];
	notes?: readonly string[];
	quiet?: boolean;
}
/** Score `variant`'s per-stage times on every track, write lab/<label>.{json,md} and print the tables. */
export async function evaluate(label: string, variant: Variant, opts: EvaluateOptions = {}) {
	const started = performance.now();
	const rows: TrackResult[] = [];
	try {
		for (const t of corpus(opts.only)) {
			const labels = loadLabels(t.name);
			const at = performance.now();
			const stages = await variant(t, labels);
			const row: TrackResult = { name: t.name, stages: {} };
			for (const [stage, times] of Object.entries(stages)) {
				row.stages[stage] = {};
				for (const kind of KIT) {
					const est = times[kind];
					if (est) row.stages[stage][kind] = score(labels[kind], [...est].sort((a, b) => a - b), opts.window);
				}
			}
			rows.push(row);
			if (!opts.quiet) {
				const brief = Object.entries(row.stages).map(([stage, classes]) =>
					`${stage} ${KIT.map((kind) => (classes[kind] ? fmt(classes[kind]!.f, 2) : '-')).join('/')}`).join('  ');
				console.log(`${t.name} (${((performance.now() - at) / 1000).toFixed(1)}s): ${brief}`);
			}
		}
	} finally {
		await closeModels();
	}
	const seconds = (performance.now() - started) / 1000;
	const out = report(label, rows, [...(opts.notes ?? []), `${rows.length} tracks in ${seconds.toFixed(1)} s.`], opts);
	if (!opts.quiet) {
		const cut = out.md.indexOf('## Per track');
		console.log(cut > 0 ? out.md.slice(0, cut) : out.md);
		console.log(`Wrote ${out.jsonPath} and .md`);
	}
	return { rows, seconds, ...out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const args = process.argv.slice(2);
	const only = args.find((a) => a.startsWith('--tracks='))?.slice(9).split(',').filter(Boolean) ?? [];
	const stem = args.includes('--stems');
	const rebuild = args.includes('--rebuild');
	try {
		for (const t of corpus(only)) {
			const at = performance.now();
			const a = await activationRecord(t.name, { stem });
			const b = await beats(t.name, { stem });
			const q = await quantiseInputs(t.name, { stem, rebuild });
			console.log(`${t.name}: activations ${a.cached ? 'cached' : 'ran'}, beats ${b ? (b.cached ? 'cached' : 'ran') : 'none'}, `
				+ `quantise ${q.beats.length} beats ${q.beatsPerBar}/bar parity ${JSON.stringify(q.parity)}, ${((performance.now() - at) / 1000).toFixed(1)}s`);
		}
	} finally {
		await closeModels();
	}
}
