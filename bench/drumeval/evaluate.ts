// node bench/drumeval/evaluate.ts --label=NAME [--corpus=mdb,rbma] [--jobs=5] [--src=DIR]
//   [--compare=LABEL] [--window=0.05] [--model=FILE|CV_DIR] [--export-candidates=NAME]
// Replays analyzeTrack on cached evidence (bench/drumeval/prepare.ts) and scores its drum
// streams against corpus labels. --src imports packages/analysis/src from another checkout;
// --model runs Striker with that model; --export-candidates writes its training candidates.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { KIT, referenceTimes, tracks, trackKey, type CorpusTrack, type DrumClass, type Kind } from './corpus.ts';
import {
	EVAL_ROOT, evidenceDir, files, readF32, readJson, writeJson, type AudioRecord, type BeatsRecord
} from './evidence.ts';
import { matchEvents, prf, quantile, scoreEvents, type ScoreDetail } from './score.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = flag('label') ?? 'worktree';
if (!/^[\w.-]+$/.test(label)) throw new Error('Label must be a file-safe word.');
const window = Number(flag('window') ?? 0.05);
const src = resolve(flag('src') ?? join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src'));
const runDir = join(EVAL_ROOT, 'runs', label);
const select = flag('corpus')?.split(',') ?? [];

const STAGES = ['model', 'modelDrums', 'dsp', 'detected', 'final', 'final05'] as const;
type Stage = typeof STAGES[number];
const METRICS = ['strict', 'light'] as const;
type Metric = typeof METRICS[number] | 'metal';

export interface TrackResult {
	corpus: string;
	name: string;
	duration: number;
	seconds: number;
	/** stage -> kind -> metric -> detail; hats also score against hats plus cymbals as `metal`. */
	scores: Record<string, Record<string, Partial<Record<Metric, ScoreDetail>>>>;
	final: Record<Kind, { times: number[]; levels: number[] }>;
	/** Striker's hits per class, the hat without cymbals, when it ran. */
	classes?: Record<Kind | 'cymbal' | 'tom', { times: number[]; levels: number[] }>;
}

function ready(track: CorpusTrack): boolean {
	const dir = evidenceDir(track);
	return [files.audio, files.beats, files.adtofMix, files.separation, files.kick22, files.snare22, files.hat22, files.cymbal22]
		.every((file) => existsSync(join(dir, file)));
}

/**
 * A model file, or a cross-validation directory: folds.json names each training track's fold
 * model, and tracks outside every fold (held-out corpora) use model.json.
 */
function strikerModels(path: string | undefined, validate: (model: unknown) => unknown) {
	if (!path) return (_track: CorpusTrack): unknown => undefined;
	const load = (file: string) => validate(JSON.parse(readFileSync(file, 'utf8')));
	if (path.endsWith('.json')) {
		const model = load(path);
		return (_track: CorpusTrack): unknown => model;
	}
	const folds = JSON.parse(readFileSync(join(path, 'folds.json'), 'utf8')) as Record<string, number>;
	const cache = new Map<string, unknown>();
	return (track: CorpusTrack): unknown => {
		// A variant corpus renders another corpus's recordings, so it takes that recording's fold.
		const fold = folds[trackKey(track)] ?? (track.variantOf ? folds[`${track.variantOf}/${track.name}`] : undefined);
		const file = fold === undefined ? 'model.json' : `fold-${fold}.json`;
		if (!cache.has(file)) cache.set(file, load(join(path, file)));
		return cache.get(file);
	};
}

async function runShard(list: CorpusTrack[]): Promise<void> {
	const url = (file: string) => pathToFileURL(join(src, file)).href;
	const { analyzeTrack } = await import(url('analyze.ts'));
	const { onsetsFromActivations } = await import(url('adtof.ts'));
	const { sourceOnsets } = await import(url('separatedDrums.ts'));
	const { decodeAudio } = await import(url('decode.ts'));
	const strikerModule = existsSync(join(src, 'striker.ts')) ? await import(url('striker.ts')) : null;
	const modelFor = strikerModels(flag('model'), (model) => strikerModule!.validateStrikerModel(model));
	const exportName = flag('export-candidates');
	for (const track of list) {
		const at = performance.now();
		const dir = evidenceDir(track);
		const audio = readJson<AudioRecord>(join(dir, files.audio))!;
		const beats = readJson<BeatsRecord>(join(dir, files.beats))!;
		const decoded = await decodeAudio(track.audio);
		if (decoded.hash !== audio.hash22 || beats.hash22 !== audio.hash22) throw new Error(`${trackKey(track)}: stale evidence.`);
		const mixAct = readF32(join(dir, files.adtofMix));
		const model = onsetsFromActivations(mixAct);
		const drumsAct = existsSync(join(dir, files.adtofDrums)) ? readF32(join(dir, files.adtofDrums)) : null;
		const modelDrums = drumsAct ? onsetsFromActivations(drumsAct) : null;
		const [kick, snare, hat, cymbal] = [files.kick22, files.snare22, files.hat22, files.cymbal22]
			.map((file) => readF32(join(dir, file)));
		const striker = modelFor(track);
		const probe: {
			drums?: { dsp: Record<Kind, { times: number[] }>; detected: Record<Kind, { times: number[] }> };
			striker?: {
				candidates?: Record<string, { times: number[]; features: Float32Array }>;
				classes?: Record<Kind | 'cymbal' | 'tom', { times: number[]; levels: number[] }>;
			};
		} = exportName || striker ? { striker: {} } : {};
		const input = {
			mono: decoded.mono, left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate,
			duration: decoded.duration, hash: decoded.hash, trackId: track.name, title: track.name,
			beats: beats.beats, downbeats: beats.downbeats, drums: model,
			separatedDrums: { kick, snare, hat, cymbal, sampleRate: 22050 },
			separatedOnsets: {
				kick: sourceOnsets(kick, 22050), snare: sourceOnsets(snare, 22050), hat: sourceOnsets(hat, 22050),
				cymbal: sourceOnsets(cymbal, 22050)
			},
			stemActivations: drumsAct ?? undefined,
			sourceActivations: existsSync(join(dir, files.adtofCymbal)) ? {
				kick: readF32(join(dir, files.adtofKick)), snare: readF32(join(dir, files.adtofSnare)),
				hat: readF32(join(dir, files.adtofHat)), cymbal: readF32(join(dir, files.adtofCymbal))
			} : undefined,
			striker,
			probe
		};
		const analysis = analyzeTrack(input);
		if (exportName && probe.striker?.candidates && track.labeled !== false) {
			exportCandidates(exportName, track, probe.striker.candidates, strikerModule!.STRIKER_FEATURES, strikerModule!.CANDIDATE_REVISION);
		}
		const streams: Record<Stage, Record<Kind, number[]>> = {
			model: { kick: model.kick.times, snare: model.snare.times, hat: model.hat.times },
			modelDrums: { kick: modelDrums?.kick.times ?? [], snare: modelDrums?.snare.times ?? [], hat: modelDrums?.hat.times ?? [] },
			dsp: { kick: probe.drums!.dsp.kick.times, snare: probe.drums!.dsp.snare.times, hat: probe.drums!.dsp.hat.times },
			detected: {
				kick: probe.drums!.detected.kick.times, snare: probe.drums!.detected.snare.times, hat: probe.drums!.detected.hat.times
			},
			final: { kick: analysis.onsets.kick.times, snare: analysis.onsets.snare.times, hat: analysis.onsets.hat.times },
			final05: Object.fromEntries(KIT.map((kind) => [kind, analysis.onsets[kind].times
				.filter((_: number, i: number) => analysis.onsets[kind].levels[i] >= 0.05)])) as Record<Kind, number[]>
		};
		const scores: TrackResult['scores'] = {};
		for (const stage of STAGES) {
			scores[stage] = {};
			for (const kind of KIT) {
				const est = streams[stage][kind];
				const all = referenceTimes(track, kind);
				const required = referenceTimes(track, kind, false);
				const optional = all.filter((t) => !required.includes(t));
				scores[stage][kind] = {
					strict: scoreEvents(all, est, window),
					light: scoreEvents(required, est, window, optional)
				};
			}
			const metalRequired = [...referenceTimes(track, 'hat', false), ...referenceTimes(track, 'cymbal', false)].sort((a, b) => a - b);
			const metalAll = [...referenceTimes(track, 'hat'), ...referenceTimes(track, 'cymbal')].sort((a, b) => a - b);
			scores[stage]['hat'].metal = scoreEvents(metalRequired, streams[stage].hat, window,
				metalAll.filter((t) => !metalRequired.includes(t)));
		}
		const result: TrackResult = {
			corpus: track.corpus, name: track.name, duration: decoded.duration, seconds: (performance.now() - at) / 1000, scores,
			final: Object.fromEntries(KIT.map((kind) => [kind, analysis.onsets[kind]])) as TrackResult['final'],
			...(probe.striker?.classes ? {
				classes: Object.fromEntries(Object.entries(probe.striker.classes)
					.map(([kind, { times, levels }]) => [kind, { times, levels }])) as TrackResult['classes']
			} : {})
		};
		writeJson(join(runDir, 'tracks', `${track.corpus}__${track.name}.json`), result);
		console.log(`${trackKey(track)} ${result.seconds.toFixed(1)} s: final light F `
			+ KIT.map((kind) => prf(scores.final[kind].light!).f.toFixed(2)).join('/'));
	}
}

/** MIDI_REDUCED_5, as bench/drumeval/benchmark.py scores: tambourine and shakers are no drum class. */
const BENCHMARK_DROPPED = new Set(['TMB', 'GM54', 'GM69', 'GM70', 'GM82']);

/**
 * Candidate features with labels: 1 matches a required reference, -1 an optional one, 0 neither.
 * `strictLabels` count every benchmark reference of the class as required instead.
 */
function exportCandidates(
	name: string, track: CorpusTrack, candidates: Record<string, { times: number[]; features: Float32Array }>,
	names: readonly string[], revision: number | undefined
): void {
	const outDir = join(EVAL_ROOT, 'candidates', name);
	const meta: Record<string, unknown> = {
		corpus: track.corpus, name: track.name, heldOut: track.heldOut ?? false, variantOf: track.variantOf,
		candidateRevision: revision, classes: {}
	};
	const blocks: Float32Array[] = [];
	for (const kind of Object.keys(candidates) as DrumClass[]) {
		const { times, features } = candidates[kind];
		const required = referenceTimes(track, kind, false);
		const optional = referenceTimes(track, kind).filter((t) => !required.includes(t));
		const labels = new Array<number>(times.length).fill(0);
		const pairs = matchEvents(required, times, window);
		for (const j of pairs) if (j >= 0) labels[j] = 1;
		const rest = times.map((t, j) => ({ t, j })).filter(({ j }) => labels[j] === 0);
		for (const j of matchEvents(optional, rest.map((r) => r.t), window)) if (j >= 0) labels[rest[j].j] = -1;
		const strictReferences = track.events.filter((e) => e.cls === kind && !BENCHMARK_DROPPED.has(e.sub ?? ''))
			.map((e) => e.time).sort((a, b) => a - b);
		const dropped = track.events.filter((e) => e.cls === kind && BENCHMARK_DROPPED.has(e.sub ?? ''))
			.map((e) => e.time).sort((a, b) => a - b);
		const strictLabels = new Array<number>(times.length).fill(0);
		for (const j of matchEvents(strictReferences, times, window)) if (j >= 0) strictLabels[j] = 1;
		const unmatched = times.map((t, j) => ({ t, j })).filter(({ j }) => strictLabels[j] === 0);
		for (const j of matchEvents(dropped, unmatched.map((r) => r.t), window)) if (j >= 0) strictLabels[unmatched[j].j] = -1;
		if (track.classes && !track.classes.includes(kind)) {
			labels.fill(-1);
			strictLabels.fill(-1);
		}
		blocks.push(features);
		(meta.classes as Record<string, unknown>)[kind] = {
			count: times.length, features: names, times, labels, references: required, optional, strictLabels, strictReferences
		};
	}
	const all = new Float32Array(blocks.reduce((n, b) => n + b.length, 0));
	let at = 0;
	for (const block of blocks) {
		all.set(block, at);
		at += block.length;
	}
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, `${track.corpus}__${track.name}.f32`), Buffer.from(all.buffer));
	writeFileSync(join(outDir, `${track.corpus}__${track.name}.json`), JSON.stringify(meta));
}

interface Row { tp: number; fp: number; fn: number; ignored: number; tracks: number; fSum: number; offsets: number[] }

function summarise(all: TrackResult[]) {
	const labeled = new Set(tracks().filter((t) => t.labeled !== false).map(trackKey));
	const results = all.filter((r) => labeled.has(`${r.corpus}/${r.name}`));
	const groups = [...new Set(results.map((r) => r.corpus)), 'all'];
	const out: Record<string, Record<string, Record<string, Record<string, { p: number; r: number; f: number; trackMeanF: number;
		tp: number; fp: number; fn: number; ignored: number; tracks: number; absMedianMs: number; absP90Ms: number }>>>> = {};
	for (const group of groups) {
		const members = results.filter((r) => group === 'all' || r.corpus === group);
		out[group] = {};
		for (const stage of STAGES) {
			out[group][stage] = {};
			for (const kind of KIT) {
				out[group][stage][kind] = {};
				for (const metric of [...METRICS, ...(kind === 'hat' ? ['metal'] as const : [])]) {
					const row: Row = { tp: 0, fp: 0, fn: 0, ignored: 0, tracks: 0, fSum: 0, offsets: [] };
					for (const r of members) {
						const d = r.scores[stage]?.[kind]?.[metric as Metric];
						if (!d) continue;
						row.tp += d.tp;
						row.fp += d.fp;
						row.fn += d.fn;
						row.ignored += d.ignored;
						row.offsets.push(...d.offsetsMs);
						if (d.tp + d.fn > 0) {
							row.tracks++;
							row.fSum += prf(d).f;
						}
					}
					const abs = row.offsets.map(Math.abs);
					out[group][stage][kind][metric] = {
						...prf(row), trackMeanF: row.tracks ? row.fSum / row.tracks : 0,
						tp: row.tp, fp: row.fp, fn: row.fn, ignored: row.ignored, tracks: row.tracks,
						absMedianMs: quantile(abs, 0.5), absP90Ms: quantile(abs, 0.9)
					};
				}
			}
		}
	}
	return out;
}

type Summary = ReturnType<typeof summarise>;

function table(summary: Summary, compare?: Summary, full = false): string {
	const lines: string[] = [];
	const f3 = (v: number) => v.toFixed(3);
	const delta = (v: number, b?: number) => (b === undefined ? '' : ` (${v - b >= 0 ? '+' : ''}${(v - b).toFixed(3)})`);
	const rows: [string, Kind, string][] = full
		? STAGES.flatMap((stage) => KIT.flatMap((kind) => [...METRICS, ...(kind === 'hat' ? ['metal'] : [])]
			.map((metric): [string, Kind, string] => [stage, kind, metric])))
		: [['final', 'kick', 'light'], ['final', 'snare', 'light'], ['final', 'hat', 'light'], ['final', 'hat', 'metal'],
			['final', 'kick', 'strict'], ['final', 'snare', 'strict'], ['final', 'hat', 'strict'],
			['model', 'kick', 'light'], ['model', 'snare', 'light'], ['model', 'hat', 'light']];
	for (const group of Object.keys(summary)) {
		lines.push(`### ${group}`, '', '| stage | class | metric | P | R | F | track-mean F | tp | fp | fn | abs med/p90 ms |',
			'|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
		for (const [stage, kind, metric] of rows) {
			const s = summary[group][stage]?.[kind]?.[metric];
			if (!s) continue;
			const b = compare?.[group]?.[stage]?.[kind]?.[metric];
			lines.push(`| ${stage} | ${kind} | ${metric} | ${f3(s.p)}${delta(s.p, b?.p)} | ${f3(s.r)}${delta(s.r, b?.r)} `
				+ `| **${f3(s.f)}**${delta(s.f, b?.f)} | ${f3(s.trackMeanF)}${delta(s.trackMeanF, b?.trackMeanF)} `
				+ `| ${s.tp} | ${s.fp} | ${s.fn} | ${s.absMedianMs.toFixed(1)}/${s.absP90Ms.toFixed(1)} |`);
		}
		lines.push('');
	}
	return lines.join('\n');
}

function perTrack(results: TrackResult[], compare?: TrackResult[]): string {
	const lines = ['| track | refs k/s/h | final light F k/s/h | fp k/s/h | fn k/s/h |', '|---|---|---|---|---|'];
	for (const r of results) {
		const b = compare?.find((c) => c.corpus === r.corpus && c.name === r.name);
		const cell = (kind: Kind) => {
			const d = r.scores.final[kind].light!;
			if (d.tp + d.fn === 0) return d.fp ? `-(${d.fp}fp)` : '-';
			const f = prf(d).f;
			const bd = b?.scores.final[kind].light;
			const change = bd && bd.tp + bd.fn > 0 ? f - prf(bd).f : 0;
			return f.toFixed(2) + (Math.abs(change) >= 0.005 ? `(${change >= 0 ? '+' : ''}${change.toFixed(2)})` : '');
		};
		const light = (kind: Kind) => r.scores.final[kind].light!;
		lines.push(`| ${r.corpus}/${r.name} | ${KIT.map((k) => light(k).tp + light(k).fn).join('/')} | ${KIT.map(cell).join(' / ')} `
			+ `| ${KIT.map((k) => light(k).fp).join('/')} | ${KIT.map((k) => light(k).fn).join('/')} |`);
	}
	return lines.join('\n');
}

export function loadRun(name: string): TrackResult[] {
	const dir = join(EVAL_ROOT, 'runs', name, 'tracks');
	return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => readJson<TrackResult>(join(dir, f))!);
}

const shard = flag('shard');
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const list = tracks(select).filter(ready);
	if (shard) {
		const [index, count] = shard.split('/').map(Number);
		await runShard(list.filter((_, i) => i % count === index));
	} else {
		const jobs = Math.max(1, Number(flag('jobs') ?? 5));
		const started = performance.now();
		if (existsSync(join(runDir, 'tracks'))) rmSync(join(runDir, 'tracks'), { recursive: true });
		mkdirSync(join(runDir, 'tracks'), { recursive: true });
		console.log(`${list.length} tracks with evidence, ${jobs} jobs, analysis ${src}`);
		await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, (_, i) => new Promise<void>((accept, reject) => {
			const child = spawn(process.execPath, [import.meta.filename, ...args.filter((a) => !a.startsWith('--jobs')), `--shard=${i}/${jobs}`],
				{ stdio: 'inherit', windowsHide: true });
			child.once('error', reject);
			child.once('exit', (code) => (code === 0 ? accept() : reject(new Error(`shard ${i} exited ${code}`))));
		})));
		const results = loadRun(label);
		const summary = summarise(results);
		const compareLabel = flag('compare');
		const compareRun = compareLabel ? loadRun(compareLabel) : undefined;
		const compare = compareRun ? summarise(compareRun) : undefined;
		writeJson(join(runDir, 'summary.json'), { label, src, window, created: new Date().toISOString(), summary });
		const head = `# ${label}\n\n${results.length} tracks, window ${window * 1000} ms`
			+ `${compareLabel ? `, deltas against ${compareLabel}` : ''}.\n\n`;
		writeFileSync(join(runDir, 'summary.md'), head + table(summary, compare) + '\n## Per track\n\n'
			+ perTrack(results, compareRun) + '\n\n## All stages\n\n' + table(summary, compare, true));
		console.log(head + table(summary, compare));
		console.log(`${((performance.now() - started) / 1000).toFixed(0)} s; wrote ${join(runDir, 'summary.md')}`);
	}
}
