// node bench/drumeval/evaluate.ts --label=NAME [--corpus=mdb,rbma] [--jobs=1] [--src=DIR]
//   [--compare=LABEL] [--window=0.05] [--striker2=DIR]
// Hears each track's 44.1 kHz decode with Striker 2.0 (striker2.json beside its graph in DIR,
// default models/) as ingest does, replays analyzeTrack on its beats and transcription, and scores
// the drum streams against corpus labels. Needs only each track's audio and labels. --src imports
// packages/analysis/src from another checkout. Each job holds its own model session.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { KIT, referenceTimes, tracks, trackKey, type CorpusTrack, type Kind } from './corpus.ts';
import { EVAL_ROOT, readJson, writeJson } from './evidence.ts';
import { prf, quantile, scoreEvents, type ScoreDetail } from './score.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = flag('label') ?? 'worktree';
if (!/^[\w.-]+$/.test(label)) throw new Error('Label must be a file-safe word.');
const window = Number(flag('window') ?? 0.05);
const src = resolve(flag('src') ?? join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src'));
const runDir = join(EVAL_ROOT, 'runs', label);
const select = flag('corpus')?.split(',') ?? [];
const modelDir = resolve(flag('striker2') ?? join(import.meta.dirname, '..', '..', 'models'));

/** What the lights receive, and the same hits from level 0.05 up, the effects' gate. */
const STAGES = ['final', 'final05'] as const;
type Stage = typeof STAGES[number];
const METRICS = ['strict', 'light'] as const;
type Metric = typeof METRICS[number] | 'metal';
type Hits = { times: number[]; levels: number[] };

export interface TrackResult {
	corpus: string;
	name: string;
	duration: number;
	seconds: number;
	/** stage -> kind -> metric -> detail; hats also score against hats plus cymbals as `metal`. */
	scores: Record<string, Record<string, Partial<Record<Metric, ScoreDetail>>>>;
	final: Record<Kind, Hits>;
	/** Each class's hits as analysis emits that class alone: the hat without cymbals, and toms. */
	classes?: Record<Kind | 'cymbal' | 'tom', Hits>;
	/** The grid analysis took: Striker 2.0's beats after repair. */
	beats?: number[];
}

async function runShard(list: CorpusTrack[]): Promise<void> {
	const url = (file: string) => pathToFileURL(join(src, file)).href;
	const { analyzeTrack } = await import(url('analyze.ts'));
	const { decodeAudio } = await import(url('decode.ts'));
	const { Striker2, readStriker2 } = await import(url('striker2.ts'));
	const striker2 = await Striker2.create(await readStriker2(modelDir));
	try {
		for (const track of list) {
			const at = performance.now();
			const decoded = await decodeAudio(track.audio);
			const heard = await striker2.run((await decodeAudio(track.audio, 44100)).mono);
			const probe: { striker: { classes?: Record<Kind | 'cymbal' | 'tom', Hits> } } = { striker: {} };
			const analysis = analyzeTrack({
				mono: decoded.mono, left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate,
				duration: decoded.duration, hash: decoded.hash, trackId: track.name, title: track.name,
				beats: heard.beats, downbeats: heard.downbeats, striker2: heard, probe
			});
			const streams: Record<Stage, Record<Kind, number[]>> = {
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
			const classes = probe.striker.classes;
			const result: TrackResult = {
				corpus: track.corpus, name: track.name, duration: decoded.duration, seconds: (performance.now() - at) / 1000, scores,
				final: Object.fromEntries(KIT.map((kind) => [kind, analysis.onsets[kind]])) as TrackResult['final'],
				...(classes ? {
					classes: Object.fromEntries(Object.entries(classes)
						.map(([kind, { times, levels }]) => [kind, { times, levels }])) as TrackResult['classes']
				} : {}),
				beats: analysis.beats
			};
			writeJson(join(runDir, 'tracks', `${track.corpus}__${track.name}.json`), result);
			console.log(`${trackKey(track)} ${result.seconds.toFixed(1)} s: final light F `
				+ KIT.map((kind) => prf(scores.final[kind].light!).f.toFixed(2)).join('/'));
		}
	} finally {
		await striker2.close();
	}
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
			['final', 'kick', 'strict'], ['final', 'snare', 'strict'], ['final', 'hat', 'strict']];
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
	const list = tracks(select).filter((track) => existsSync(track.audio));
	if (shard) {
		const [index, count] = shard.split('/').map(Number);
		await runShard(list.filter((_, i) => i % count === index));
	} else {
		const jobs = Math.max(1, Number(flag('jobs') ?? 1));
		const started = performance.now();
		if (existsSync(join(runDir, 'tracks'))) rmSync(join(runDir, 'tracks'), { recursive: true });
		mkdirSync(join(runDir, 'tracks'), { recursive: true });
		console.log(`${list.length} tracks with audio, ${jobs} jobs, analysis ${src}, model ${modelDir}`);
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
		const manifest = readJson<{ name: string }>(join(modelDir, 'striker2.json'));
		writeJson(join(runDir, 'summary.json'), {
			label, src, model: modelDir, modelVersion: manifest?.name,
			window, created: new Date().toISOString(), summary
		});
		const head = `# ${label}\n\n${results.length} tracks, window ${window * 1000} ms`
			+ `${compareLabel ? `, deltas against ${compareLabel}` : ''}.\n\n`;
		writeFileSync(join(runDir, 'summary.md'), head + table(summary, compare) + '\n## Per track\n\n'
			+ perTrack(results, compareRun) + '\n\n## All stages\n\n' + table(summary, compare, true));
		console.log(head + table(summary, compare));
		console.log(`${((performance.now() - started) / 1000).toFixed(0)} s; wrote ${join(runDir, 'summary.md')}`);
	}
}
