// node bench/drum-regressions.ts habibi --analysis=PATH [--min-level=0.05] [--out=PATH]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OnsetStream, TrackAnalysis } from '@mv/core';
import { benchmarkCache } from './cache.ts';
import { matchEvents } from './lab/mdb.ts';

const KIT = ['kick', 'snare', 'hat'] as const;
type Kind = typeof KIT[number];

export interface DrumRegressionLabels {
	trackId: string;
	title?: string;
	annotationType: 'positive-only' | 'partial';
	source?: string;
	timingSource?: string;
	limitations?: string;
	kick?: number[];
	snare?: number[];
	hat?: number[];
	probableNonSnare?: number[];
	probableSnare?: number[];
	probablePositiveSource?: string;
	nonSnare?: number[];
	confirmedNegativeSource?: string;
	uncertain?: number[];
	negativeSource?: string;
}

interface Hit { time: number; level: number; index: number }

function validateTimes(times: readonly number[], context: string): void {
	if (times.some((time) => !Number.isFinite(time) || time < 0)) throw new Error(`${context} contains invalid onset times.`);
}

function hitsOf(stream: OnsetStream): Hit[] {
	validateTimes(stream.times, 'Analysis');
	const hits = stream.times.map((time, index) => ({ time, level: stream.levels[index] ?? 1, index }));
	if (hits.some((hit) => !Number.isFinite(hit.level) || hit.level < 0 || hit.level > 1)) throw new Error('Analysis contains invalid onset levels.');
	return hits.sort((a, b) => a.time - b.time);
}

function describeHit(hit: Hit | undefined, reference: number) {
	return hit ? { time: hit.time, level: hit.level, deltaMs: (hit.time - reference) * 1000, index: hit.index } : null;
}

function nearest(hits: Hit[], reference: number): Hit | undefined {
	return hits.reduce<Hit | undefined>((best, hit) =>
		!best || Math.abs(hit.time - reference) < Math.abs(best.time - reference) ? hit : best, undefined);
}

export function scoreDrumRegression(
	labels: DrumRegressionLabels,
	analysis: Pick<TrackAnalysis, 'trackId' | 'onsets'>,
	opts: { toleranceMs?: number; minLevel?: number } = {}
) {
	const toleranceMs = opts.toleranceMs ?? 50;
	const minLevel = opts.minLevel ?? 0;
	if (!Number.isFinite(toleranceMs) || toleranceMs < 0) throw new Error('Tolerance must be finite and nonnegative.');
	if (!Number.isFinite(minLevel) || minLevel < 0 || minLevel > 1) throw new Error('Minimum level must be between 0 and 1.');
	if (labels.annotationType !== 'positive-only' && labels.annotationType !== 'partial') throw new Error('Only partial labels are supported.');
	if (labels.trackId !== analysis.trackId) throw new Error(`Track mismatch: ${labels.trackId} versus ${analysis.trackId}.`);
	const streams = Object.fromEntries(KIT.map((kind) => [kind, hitsOf(analysis.onsets[kind])])) as Record<Kind, Hit[]>;
	const eligible = Object.fromEntries(KIT.map((kind) => [kind, streams[kind].filter((hit) => hit.level >= minLevel)])) as Record<Kind, Hit[]>;
	const positives = KIT.flatMap((kind) => {
		const references = [...(labels[kind] ?? [])].sort((a, b) => a - b);
		validateTimes(references, `${kind} labels`);
		const paired = matchEvents(references, eligible[kind].map((hit) => hit.time), toleranceMs / 1000);
		const rawPaired = matchEvents(references, streams[kind].map((hit) => hit.time), toleranceMs / 1000);
		return references.map((time, i) => ({ kind, time,
			matched: describeHit(eligible[kind][paired[i]], time),
			matchedBeforeLevelFilter: describeHit(streams[kind][rawPaired[i]], time),
			nearest: describeHit(nearest(streams[kind], time), time),
			nearestEligible: describeHit(nearest(eligible[kind], time), time)
		}));
	});
	const observe = (times: number[] | undefined) => {
		validateTimes(times ?? [], 'Provisional labels');
		return (times ?? []).map((time) => ({ time,
			nearby: eligible.snare.filter((hit) => Math.abs(hit.time - time) <= toleranceMs / 1000 + 1e-9).map((hit) => describeHit(hit, time)),
			nearest: describeHit(nearest(streams.snare, time), time)
		}));
	};
	const negatives = observe(labels.nonSnare);
	return {
		trackId: labels.trackId, title: labels.title, annotationType: labels.annotationType,
		toleranceMs, minLevel, confirmedPositiveCount: positives.length,
		matchedPositiveCount: positives.filter((row) => row.matched !== null).length,
		matchedPositiveCountBeforeLevelFilter: positives.filter((row) => row.matchedBeforeLevelFilter !== null).length,
		positives,
		confirmedNegativeCount: negatives.length,
		violatedNegativeCount: negatives.filter((row) => row.nearby.length > 0).length,
		negatives, confirmedNegativeSource: labels.confirmedNegativeSource,
		provisional: {
			probableSnare: observe(labels.probableSnare), probablePositiveSource: labels.probablePositiveSource,
			probableNonSnare: observe(labels.probableNonSnare), uncertain: observe(labels.uncertain), source: labels.negativeSource
		},
		source: labels.source, timingSource: labels.timingSource,
		interpretation: 'Matches and violations cover only listed confirmed labels. Unlisted detections are not negatives. Provisional and uncertain labels are observations, not scored negative ground truth. No precision or full-passage recall is measured.',
		limitations: labels.limitations
	};
}

export function drumRegressionsMain(args = process.argv.slice(2)): void {
	const option = (key: string) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
	if (args.includes('--help')) {
		console.log('node bench/drum-regressions.ts [label-name|track-id] [--analysis=PATH | --dir=DIR | --cache=DIR] [--labels=FILE] [--min-level=0.05] [--tolerance-ms=50] [--out=PATH] [--strict]');
		return;
	}
	const selector = args.find((arg) => !arg.startsWith('--'));
	const labelRoot = join(import.meta.dirname, 'judged', 'drums');
	const labelPaths = option('labels') ? [resolve(option('labels')!)] : readdirSync(labelRoot).filter((file) => file.endsWith('.json')).map((file) => join(labelRoot, file));
	const candidates = labelPaths.map((path) => ({ path, labels: JSON.parse(readFileSync(path, 'utf8')) as DrumRegressionLabels }));
	const analysisPath = option('analysis') ? resolve(option('analysis')!) : null;
	const explicitAnalysis = analysisPath ? JSON.parse(readFileSync(analysisPath, 'utf8')) as TrackAnalysis : null;
	const selected = candidates.filter(({ path, labels }) =>
		(!selector || selector === basename(path, '.json') || selector === labels.trackId) && (!explicitAnalysis || labels.trackId === explicitAnalysis.trackId));
	if (selected.length === 0) throw new Error('No matching partial drum labels found.');
	const directory = resolve(option('dir') ?? benchmarkCache(option('cache')));
	const reports = selected.map(({ path, labels }) => {
		const source = analysisPath ?? join(directory, `${labels.trackId}.analysis.json`);
		if (!existsSync(source)) throw new Error(`Analysis not found: ${source}. Pass --analysis for a differently named snapshot.`);
		const analysis = explicitAnalysis ?? JSON.parse(readFileSync(source, 'utf8')) as TrackAnalysis;
		return { labelsPath: path, analysisPath: source, ...scoreDrumRegression(labels, analysis, {
			toleranceMs: Number(option('tolerance-ms') ?? 50), minLevel: Number(option('min-level') ?? 0)
		}) };
	});
	const result = JSON.stringify(reports, null, 2);
	if (option('out')) {
		const destination = resolve(option('out')!);
		if (selected.some(({ path }) => path === destination) || reports.some((report) => report.analysisPath === destination)) throw new Error('Report output must not replace an input file.');
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, result);
	}
	console.log(result);
	if (args.includes('--strict') && reports.some((report) =>
		report.matchedPositiveCount < report.confirmedPositiveCount || report.violatedNegativeCount > 0)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) drumRegressionsMain();
