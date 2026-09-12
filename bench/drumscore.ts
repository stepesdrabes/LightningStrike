// node bench/drumscore.ts [--label=worktree] [--stems] [--before=DIR | --no-before]
//   [--tracks=Rock,Disco] [--corpus=bench/corpus/mdb-drums] [--out=bench/reports/audio-reliability/mdb]
// Labelled drum accuracy on MDB Drums: every stage of the shipping drum path against the
// human class annotations, mir_eval-style (maximum bipartite matching, +-50 ms). Corpus,
// caches, matching and summaries come from bench/lab/mdb.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { onsetsFromActivations } from '../packages/analysis/src/adtof.ts';
import { detectDrums, snapTimesToOnsets } from '../packages/analysis/src/drums.ts';
import { assessMetricalLevel } from '../packages/analysis/src/metricalLevel.ts';
import {
	KIT, WINDOW, activationRecord, beats, closeModels, configure, corpus, decodeMix, div, featuresOf,
	fmt, gitHead, loadLabels, matchEvents, mean, modelStream, modelStreams, nearestDistance, rmsDbfs,
	score as scoreEvents, sha256, streamHash, timing, type Kind, type Labels, type Times
} from './lab/mdb.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = flag('label') ?? 'worktree';
const stems = args.includes('--stems');
const out = resolve(flag('out') ?? 'bench/reports/audio-reliability/mdb');
configure({ corpus: resolve(flag('corpus') ?? 'bench/corpus/mdb-drums'), out });
const beforeRoot = args.includes('--no-before')
	? null
	: resolve(flag('before') ?? 'bench/reports/audio-reliability/baseline-source/packages/analysis/src');
const only = flag('tracks')?.split(',').filter(Boolean) ?? [];
if (!/^[\w-]+$/.test(label)) throw new Error('Label must be a file-safe word.');

/** A false positive further than this from any annotated onset is a phantom in a drumless span. */
const DRUMLESS_S = 0.5;
const SILENT_DBFS = -60;

const STAGES = ['dsp', 'model', 'model-snapped', 'final', 'final-before'] as const;
type Stage = typeof STAGES[number];

interface Score {
	ref: number;
	est: number;
	matched: number;
	precision: number;
	recall: number;
	f: number;
	signedMs: number[];
	fpDrumless: number;
	fpSilent: number;
}
interface Completion {
	kept: number;
	invented: number;
	inventedTrue: number;
	demoted: number;
	demotedTrue: number;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

interface Audio {
	mono: Float32Array;
	sampleRate: number;
}
function score(ref: readonly number[], est: readonly number[], labels: Labels, audio: Audio):
	{ score: Score; matched: boolean[] } {
	const s = scoreEvents(ref, est, WINDOW);
	let fpDrumless = 0;
	let fpSilent = 0;
	for (let j = 0; j < est.length; j++) {
		if (s.matched[j]) continue;
		if (nearestDistance(labels.all, est[j]) > DRUMLESS_S) fpDrumless++;
		if (rmsDbfs(audio.mono, audio.sampleRate, est[j], WINDOW) < SILENT_DBFS) fpSilent++;
	}
	return {
		matched: s.matched,
		score: {
			ref: s.ref, est: s.est, matched: s.tp, precision: s.p, recall: s.r, f: s.f,
			signedMs: s.signedMs, fpDrumless, fpSilent
		}
	};
}

const sameTimes = (a: readonly number[], b: readonly number[]) =>
	a.length === b.length && a.every((t, i) => Math.abs(t - b[i]) < 1e-9);

const tracks = corpus(only);
if (tracks.length === 0) throw new Error('No corpus tracks matched.');
const detailDir = join(out, `detail-${label}`);
mkdirSync(detailDir, { recursive: true });
const frozen = beforeRoot
	? await import(pathToFileURL(join(beforeRoot, 'analyze.ts')).href) as { analyzeTrack: typeof analyzeTrack }
	: null;
const stages: Stage[] = STAGES.filter((stage) => stage !== 'final-before' || frozen);
const head = gitHead();

interface TrackRow {
	name: string;
	duration: number;
	beatSource: string;
	bpm: number;
	beatsPerBar: number;
	refs: Record<string, number>;
	scores: Record<Stage, Record<Kind, Score>>;
	completion: Partial<Record<Stage, Record<Kind, Completion>>>;
	extras: { tomPeaks: number; tomTrue: number; cymbalPeaks: number; cymbalTrue: number };
	parity: { dsp: boolean; snapped: boolean; inventedFlags: boolean; beatPeriod: { standalone: number; analysis: number } };
	ms: Record<string, number>;
}
const rows: TrackRow[] = [];

try {
	for (const { name } of tracks) {
		const startedAt = performance.now();
		const labels = loadLabels(name);
		const ms: Record<string, number> = {};
		const timed = async <T>(key: string, work: () => Promise<T> | T): Promise<T> => {
			const at = performance.now();
			const result = await work();
			ms[key] = (ms[key] ?? 0) + performance.now() - at;
			return result;
		};

		const decoded = await timed('decode', () => decodeMix(name, undefined, stems));
		const wide = await timed('decode', () => decodeMix(name, 44100, stems));

		const tracked = await beats(name, { stem: stems, decoded });
		const beatSource = tracked ? (tracked.cached ? 'beat_this (cached)' : 'beat_this') : 'dsp';
		if (tracked) {
			ms.beats = tracked.ms;
			if (tracked.cached) ms.cached = 1;
		}

		const activation = await activationRecord(name, { stem: stems, wide });
		const act = activation.act;
		ms.adtof = activation.meta.inferenceMs;
		if (activation.cached) ms.cached = 1;
		const model = await timed('model', () => modelStreams(act));
		if (streamHash(model) !== activation.meta.streamHash) {
			throw new Error(`${name}: re-derived model streams differ from the model run.`);
		}
		const tom = modelStream(act, 'tom').times;
		const cymbal = modelStream(act, 'cymbal').times;

		const input = {
			mono: decoded.mono, left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate,
			duration: decoded.duration, hash: decoded.hash, trackId: name, title: name,
			beats: tracked?.beats, downbeats: tracked?.downbeats, drums: model
		};
		const probe: NonNullable<Parameters<typeof analyzeTrack>[0]['probe']> = {};
		// The shipped post-processing (thresholds, click veto, cymbals) feeds the worktree analyser;
		// the frozen analyser keeps the raw streams it was written for.
		const shipped = onsetsFromActivations(act);
		const analysis = await timed('final', () => analyzeTrack({ ...input, drums: shipped, probe }));
		if (!probe.drums) throw new Error('analyzeTrack did not fill probe.drums.');
		const captured = probe.drums;
		const before = frozen ? await timed('finalBefore', () => frozen.analyzeTrack(input)) : null;

		const features = await timed('features', () => featuresOf(decoded));
		const fps = features.curves.fps;
		const assessed = tracked ? assessMetricalLevel(tracked.beats, features.odf, fps) : null;
		const beatPeriod = assessed && assessed.bpm > 0 ? 60 / assessed.bpm : analysis.tempo.beatPeriod;
		const dsp = await timed('dsp', () => detectDrums(features.spec, { beatPeriod, odf: features.odf }));
		const radius = Math.min(0.05, beatPeriod / 8);
		const snapped = await timed('snapped', () => Object.fromEntries(KIT.map((kind) =>
			[kind, snapTimesToOnsets(model[kind].times, features.odf, fps, radius)])) as Times);

		// Score the analyser's own dsp and snapped streams; the standalone calls time and verify them.
		const times: Record<Stage, Times> = {
			dsp: { kick: captured.dsp.kick.times, snare: captured.dsp.snare.times, hat: captured.dsp.hat.times },
			model: { kick: model.kick.times, snare: model.snare.times, hat: model.hat.times },
			'model-snapped': { kick: captured.detected.kick.times, snare: captured.detected.snare.times, hat: snapped.hat },
			final: { kick: analysis.onsets.kick.times, snare: analysis.onsets.snare.times, hat: analysis.onsets.hat.times },
			'final-before': before
				? { kick: before.onsets.kick.times, snare: before.onsets.snare.times, hat: before.onsets.hat.times }
				: { kick: [], snare: [], hat: [] }
		};
		const audio = { mono: decoded.mono, sampleRate: decoded.sampleRate };
		const scores = {} as Record<Stage, Record<Kind, Score>>;
		const detail: Record<string, unknown> = { name, refs: { kick: labels.kick, snare: labels.snare, hat: labels.hat, tom: labels.tom, cymbal: labels.cymbal, other: labels.other } };
		const matchedBy: Partial<Record<Stage, Record<Kind, boolean[]>>> = {};
		for (const stage of stages) {
			scores[stage] = {} as Record<Kind, Score>;
			matchedBy[stage] = {} as Record<Kind, boolean[]>;
			for (const kind of KIT) {
				const result = score(labels[kind], times[stage][kind], labels, audio);
				scores[stage][kind] = result.score;
				matchedBy[stage]![kind] = result.matched;
			}
			detail[stage] = Object.fromEntries(KIT.map((kind) =>
				[kind, { times: times[stage][kind], matched: matchedBy[stage]![kind] }]));
		}

		// Completion accounting: what pattern correction added and what it removed, per class.
		// The frozen analyser has no probe, so its invented flags derive from the shared detections.
		const detectedSets = Object.fromEntries(KIT.map((kind) =>
			[kind, new Set(captured.detected[kind].times.map(round3))])) as Record<Kind, Set<number>>;
		const derivedInvented = (final: Times) => Object.fromEntries(KIT.map((kind) =>
			[kind, final[kind].map((t) => !detectedSets[kind].has(round3(t)))])) as Record<Kind, boolean[]>;
		const account = (stage: Stage, final: Times, invented: Record<Kind, boolean[]>): Record<Kind, Completion> =>
			Object.fromEntries(KIT.map((kind) => {
				const finalSet = new Set(final[kind].map(round3));
				const detected = captured.detected[kind].times;
				const demotedTimes = detected.filter((t) => !finalSet.has(round3(t)));
				const matched = matchedBy[stage]![kind];
				return [kind, {
					kept: detected.length - demotedTimes.length,
					invented: invented[kind].filter(Boolean).length,
					inventedTrue: invented[kind].filter((v, i) => v && matched[i]).length,
					demoted: demotedTimes.length,
					demotedTrue: matchEvents(labels[kind], demotedTimes, WINDOW).filter((j) => j >= 0).length
				}];
			})) as Record<Kind, Completion>;
		const probeInvented = Object.fromEntries(KIT.map((kind) => [kind, captured.final[kind].invented])) as Record<Kind, boolean[]>;
		const derived = derivedInvented(times.final);
		const inventedFlags = KIT.every((kind) => derived[kind].length === probeInvented[kind].length
			&& derived[kind].every((v, i) => v === probeInvented[kind][i]));
		const completion: Partial<Record<Stage, Record<Kind, Completion>>> = { final: account('final', times.final, probeInvented) };
		if (before) completion['final-before'] = account('final-before', times['final-before'], derivedInvented(times['final-before']));
		detail.invented = probeInvented;
		detail.detected = Object.fromEntries(KIT.map((kind) => [kind, captured.detected[kind].times]));

		const extras = {
			tomPeaks: tom.length,
			tomTrue: matchEvents(labels.tom, tom, WINDOW).filter((j) => j >= 0).length,
			cymbalPeaks: cymbal.length,
			cymbalTrue: matchEvents(labels.cymbal, cymbal, WINDOW).filter((j) => j >= 0).length
		};
		const parity = {
			dsp: KIT.every((kind) => sameTimes(dsp[kind].times, captured.dsp[kind].times)),
			snapped: (['kick', 'snare'] as const).every((kind) => sameTimes(snapped[kind], captured.detected[kind].times)),
			inventedFlags,
			beatPeriod: { standalone: beatPeriod, analysis: analysis.tempo.beatPeriod }
		};
		ms.total = performance.now() - startedAt;
		rows.push({
			name, duration: decoded.duration, beatSource, bpm: analysis.tempo.bpm,
			beatsPerBar: analysis.tempo.beatsPerBar,
			refs: { kick: labels.kick.length, snare: labels.snare.length, hat: labels.hat.length,
				tom: labels.tom.length, cymbal: labels.cymbal.length, other: labels.other.length },
			scores, completion, extras, parity, ms
		});
		writeFileSync(join(detailDir, `${name}.json`), JSON.stringify(detail));
		const brief = stages.map((stage) => `${stage} ${KIT.map((kind) => fmt(scores[stage][kind].f, 2)).join('/')}`).join('  ');
		console.log(`${name} (${decoded.duration.toFixed(0)}s, ${(ms.total / 1000).toFixed(1)}s): ${brief}`
			+ (parity.dsp && parity.snapped && parity.inventedFlags !== false ? '' : `  parity ${JSON.stringify(parity)}`));
	}
} finally {
	await closeModels();
}

interface ClassSummary {
	ref: number;
	est: number;
	matched: number;
	pooled: { precision: number; recall: number; f: number };
	trackMean: { precision: number; recall: number; f: number; tracks: number };
	timing: ReturnType<typeof timing>;
	fpDrumless: number;
	fpSilent: number;
}
const summary = {} as Record<Stage, { classes: Record<Kind, ClassSummary>; classMeanF: number; classMeanFPooled: number; trackMeanF: number }>;
for (const stage of stages) {
	const classes = {} as Record<Kind, ClassSummary>;
	for (const kind of KIT) {
		const scored = rows.map((row) => row.scores[stage][kind]);
		const withRefs = scored.filter((s) => s.ref > 0);
		const sum = (pick: (s: Score) => number) => scored.reduce((acc, s) => acc + pick(s), 0);
		const precision = div(sum((s) => s.matched), sum((s) => s.est));
		const recall = div(sum((s) => s.matched), sum((s) => s.ref));
		classes[kind] = {
			ref: sum((s) => s.ref), est: sum((s) => s.est), matched: sum((s) => s.matched),
			pooled: { precision, recall, f: div(2 * precision * recall, precision + recall) },
			trackMean: {
				precision: mean(withRefs.map((s) => s.precision)),
				recall: mean(withRefs.map((s) => s.recall)),
				f: mean(withRefs.map((s) => s.f)),
				tracks: withRefs.length
			},
			timing: timing(scored.flatMap((s) => s.signedMs)),
			fpDrumless: sum((s) => s.fpDrumless),
			fpSilent: sum((s) => s.fpSilent)
		};
	}
	summary[stage] = {
		classes,
		classMeanF: mean(KIT.map((kind) => classes[kind].trackMean.f)),
		classMeanFPooled: mean(KIT.map((kind) => classes[kind].pooled.f)),
		trackMeanF: mean(rows.map((row) => mean(KIT.filter((kind) => row.refs[kind] > 0).map((kind) => row.scores[stage][kind].f))))
	};
}
const completionSummary = Object.fromEntries((['final', 'final-before'] as const)
	.filter((stage) => stages.includes(stage))
	.map((stage) => [stage, Object.fromEntries(KIT.map((kind) => {
		const total = { kept: 0, invented: 0, inventedTrue: 0, demoted: 0, demotedTrue: 0 };
		for (const row of rows) for (const key of Object.keys(total) as (keyof Completion)[]) total[key] += row.completion[stage]![kind][key];
		return [kind, total];
	}))]));
const extrasSummary = rows.reduce((acc, row) => {
	for (const key of Object.keys(acc) as (keyof TrackRow['extras'])[]) acc[key] += row.extras[key];
	return acc;
}, { tomPeaks: 0, tomTrue: 0, cymbalPeaks: 0, cymbalTrue: 0 });
const runtime = Object.fromEntries(['decode', 'beats', 'adtof', 'features', 'dsp', 'model', 'snapped', 'final', 'finalBefore', 'total']
	.map((key) => [key, rows.reduce((acc, row) => acc + (row.ms[key] ?? 0), 0)]));

const report = {
	created: new Date().toISOString(),
	head,
	node: process.version,
	label,
	corpus: resolve(flag('corpus') ?? 'bench/corpus/mdb-drums'),
	stems,
	beforeRoot,
	windowSec: WINDOW,
	sourceHashes: Object.fromEntries(['analyze', 'quantise', 'adtof', 'drums'].map((name) =>
		[name, sha256(join(import.meta.dirname, '../packages/analysis/src', name + '.ts'))])),
	definitions: {
		matching: 'Hopcroft-Karp maximum bipartite matching, |ref - est| <= 50 ms, as mir_eval.util.match_events.',
		classes: 'KD->kick, SD->snare, HH->hat; TT/CY/OT are not scored but count toward drumless-span checks.',
		pooled: 'Precision/recall over all hits in the corpus.',
		trackMean: 'Mean of per-track values over tracks with at least one reference hit of the class.',
		classMeanF: 'Mean over classes of the track-mean F.',
		trackMeanF: 'Mean over tracks of the mean class F (classes with references only).',
		timing: 'est - ref of matched hits, ms; p90 of signed values and of absolute values.',
		fpDrumless: `Unmatched hits further than ${DRUMLESS_S} s from any annotated onset of any class.`,
		fpSilent: `Unmatched hits whose +-50 ms RMS is below ${SILENT_DBFS} dBFS.`,
		completion: 'invented = final hits absent from the snapped detections; demoted = detections absent from final. True = matched a reference within 50 ms.',
		hat: 'model-snapped hats snap the model hat stream; final hats are the DSP hat stream (analysis does not ship model hats).',
		extras: 'Model tom/cymbal peaks at shipping thresholds matched against TT/CY labels within 50 ms.'
	},
	summary,
	completion: completionSummary,
	extras: extrasSummary,
	runtimeMs: runtime,
	tracks: rows.map((row) => ({
		...row,
		scores: Object.fromEntries(stages.map((stage) => [stage, Object.fromEntries(KIT.map((kind) => {
			const { signedMs, ...rest } = row.scores[stage][kind];
			return [kind, { ...rest, ...timing(signedMs) }];
		}))]))
	}))
};
writeFileSync(join(out, `results-${label}.json`), JSON.stringify(report, null, '\t'));

const lines: string[] = [];
lines.push(`# Drum accuracy on MDB Drums: ${label}`, '');
lines.push(`${rows.length} tracks, ${stems ? 'drum-only stems' : 'full mixes'}, head ${head.slice(0, 10)}, ${report.created}. `
	+ `Window +-${WINDOW * 1000} ms, Hopcroft-Karp matching. before = ${beforeRoot ?? 'none'}.`, '');
lines.push('## Per stage and class', '');
lines.push('| Stage | Class | ref | est | match | P | R | F | F track-mean | signed med / p90 ms | abs med / p90 ms | FP drumless | FP silent |');
lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const stage of stages) {
	for (const kind of KIT) {
		const c = summary[stage].classes[kind];
		lines.push(`| ${stage} | ${kind} | ${c.ref} | ${c.est} | ${c.matched} | ${fmt(c.pooled.precision)} | ${fmt(c.pooled.recall)} | ${fmt(c.pooled.f)} | ${fmt(c.trackMean.f)} `
			+ `| ${fmt(c.timing.signedMedianMs, 1)} / ${fmt(c.timing.signedP90Ms, 1)} | ${fmt(c.timing.absMedianMs, 1)} / ${fmt(c.timing.absP90Ms, 1)} | ${c.fpDrumless} | ${c.fpSilent} |`);
	}
}
lines.push('', '| Stage | class-mean F (pooled) | class-mean F (track-mean) | track-mean F |', '|---|---:|---:|---:|');
for (const stage of stages) {
	const s = summary[stage];
	lines.push(`| ${stage} | ${fmt(s.classMeanFPooled)} | ${fmt(s.classMeanF)} | ${fmt(s.trackMeanF)} |`);
}
lines.push('', '## Pattern completion', '', '| Stage | Class | kept | invented | invented true | demoted | demoted true |', '|---|---|---:|---:|---:|---:|---:|');
for (const [stage, classes] of Object.entries(completionSummary)) {
	for (const kind of KIT) {
		const c = classes[kind];
		lines.push(`| ${stage} | ${kind} | ${c.kept} | ${c.invented} | ${c.inventedTrue} | ${c.demoted} | ${c.demotedTrue} |`);
	}
}
lines.push('', `Model tom peaks: ${extrasSummary.tomPeaks}, within 50 ms of TT: ${extrasSummary.tomTrue} (${rows.reduce((a, r) => a + r.refs.tom, 0)} TT labels). `
	+ `Model cymbal peaks: ${extrasSummary.cymbalPeaks}, within 50 ms of CY: ${extrasSummary.cymbalTrue} (${rows.reduce((a, r) => a + r.refs.cymbal, 0)} CY labels).`);
lines.push('', '## Per track F (kick/snare/hat)', '');
lines.push(`| Track | s | refs k/s/h | ${stages.join(' | ')} |`, `|---|---:|---|${stages.map(() => '---').join('|')}|`);
for (const row of rows) {
	const cells = stages.map((stage) => KIT.map((kind) => (row.refs[kind] > 0 ? fmt(row.scores[stage][kind].f, 2) : '-')).join('/'));
	lines.push(`| ${row.name.replace('MusicDelta_', '')} | ${row.duration.toFixed(0)} | ${KIT.map((kind) => row.refs[kind]).join('/')} | ${cells.join(' | ')} |`);
}
lines.push('', '## Worst tracks per class at final', '');
for (const kind of KIT) {
	const worst = rows.filter((row) => row.refs[kind] > 0)
		.sort((a, b) => a.scores.final[kind].f - b.scores.final[kind].f).slice(0, 5);
	lines.push(`- ${kind}: ` + worst.map((row) => {
		const s = row.scores.final[kind];
		return `${row.name.replace('MusicDelta_', '')} F ${fmt(s.f, 2)} (P ${fmt(s.precision, 2)} R ${fmt(s.recall, 2)}, model F ${fmt(row.scores.model[kind].f, 2)})`;
	}).join('; '));
}
lines.push('', '## Runtime (ms)', '', '| Track | decode | beats | adtof | features | dsp | model | snapped | final | final-before | total |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
const msCell = (row: Record<string, number>, key: string) => Math.round(row[key] ?? 0);
for (const row of rows) {
	lines.push(`| ${row.name.replace('MusicDelta_', '')} | ${['decode', 'beats', 'adtof', 'features', 'dsp', 'model', 'snapped', 'final', 'finalBefore', 'total'].map((key) => msCell(row.ms, key)).join(' | ')} |`);
}
lines.push(`| total | ${['decode', 'beats', 'adtof', 'features', 'dsp', 'model', 'snapped', 'final', 'finalBefore', 'total'].map((key) => msCell(runtime, key)).join(' | ')} |`);
if (rows.some((row) => row.ms.cached)) {
	lines.push('', 'beats and adtof times on cached tracks come from the run that filled the cache; total is this run\'s wall time.');
}
const parityIssues = rows.filter((row) => !row.parity.dsp || !row.parity.snapped || row.parity.inventedFlags === false);
lines.push('', `Parity: standalone dsp/snapped stages match analyzeTrack's probe on ${rows.length - parityIssues.length}/${rows.length} tracks`
	+ (parityIssues.length ? ` (issues: ${parityIssues.map((row) => `${row.name} ${JSON.stringify(row.parity)}`).join(', ')})` : '') + '.');
lines.push(`Beat source: ${[...new Set(rows.map((row) => row.beatSource))].join(', ')}.`);
writeFileSync(join(out, `results-${label}.md`), lines.join('\n') + '\n');
console.log(lines.slice(0, stages.length * KIT.length + 12).join('\n'));
console.log(`Wrote ${join(out, `results-${label}.json`)} and .md`);
