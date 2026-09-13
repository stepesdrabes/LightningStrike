// Compare providers with identical PCM, transcription, beats and detector code.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Adtof } from '../../packages/analysis/src/adtof.ts';
import { analyzeTrack } from '../../packages/analysis/src/analyze.ts';
import { resamplePcm } from '../../packages/analysis/src/decode.ts';
import { benchmarkCache } from '../cache.ts';
import { scoreDrumRegression, type DrumRegressionLabels } from '../drum-regressions.ts';
import { readF32 } from './mdb.ts';

const option = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const id = option('id')!;
const input = resolve(option('input')!);
const reference = resolve(option('reference')!);
const candidate = resolve(option('candidate')!);
const offset = Number(option('offset') ?? 0);
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const baselinePath = join(benchmarkCache(), `${id}.analysis.json`);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const dependencies = ['analyze.ts', 'separatedDrums.ts', 'kickEvidence.ts', 'quantise.ts', 'drums.ts', 'adtof.ts', 'decode.ts']
	.map(name => join('packages/analysis/src', name));
const sourceHashes = Object.fromEntries(dependencies.map(path => [path, hash(path)]));
const stereo = readF32(input);
const frames = stereo.length / 2;
const mix = new Float32Array(frames);
for (let i = 0; i < frames; i++) mix[i] = (stereo[i] + stereo[frames + i]) * .5;
const model = await Adtof.create();
if (!model) throw new Error('ADTOF is required for provider admission.');
let drums;
try { drums = await model.run(mix); } finally { await model.close(); }
const mono = await resamplePcm(mix, 44100);
const duration = mono.length / 22050;
const beats = baseline.beats.filter((t: number) => t >= offset && t < offset + duration).map((t: number) => t - offset);
const analyses = [];
for (const directory of [reference, candidate]) {
	const sources = { sampleRate: 22050, kick: new Float32Array(), snare: new Float32Array(), cymbal: new Float32Array() };
	for (const kind of ['kick', 'snare', 'cymbal'] as const) {
		const pcm = readF32(join(directory, kind + '.f32'));
		if (pcm.length !== frames || !pcm.every(Number.isFinite)) throw new Error(`Invalid ${directory}/${kind} PCM.`);
		sources[kind] = await resamplePcm(pcm, 44100);
	}
	const analysis = analyzeTrack({ mono, sampleRate: 22050, duration, beats, drums,
		separatedDrums: sources, trackId: id, hash: hash(input), title: baseline.title });
	for (const kind of ['kick', 'snare', 'hat'] as const) analysis.onsets[kind].times = analysis.onsets[kind].times.map(t => t + offset);
	analyses.push(analysis);
}
const comparison = Object.fromEntries((['kick', 'snare', 'hat'] as const).map(kind => {
	const a = analyses[0].onsets[kind], b = analyses[1].onsets[kind];
	return [kind, { referenceCount: a.times.length, candidateCount: b.times.length,
		identicalTimes: JSON.stringify(a.times) === JSON.stringify(b.times),
		maxTimeDeltaMs: a.times.length === b.times.length ? Math.max(0, ...a.times.map((t, i) => Math.abs(t - b.times[i]) * 1000)) : null,
		maxLevelDelta: a.levels.length === b.levels.length ? Math.max(0, ...a.levels.map((v, i) => Math.abs(v - b.levels[i]))) : null,
		reference: a, candidate: b }];
}));
let labels;
if (option('labels')) {
	const fixture: DrumRegressionLabels = JSON.parse(readFileSync(resolve(option('labels')!), 'utf8'));
	for (const key of ['kick', 'snare', 'hat', 'nonSnare', 'probableSnare', 'probableNonSnare', 'uncertain'] as const) {
		if (fixture[key]) fixture[key] = fixture[key]!.filter(t => t >= offset && t < offset + duration);
	}
	labels = analyses.map(analysis => scoreDrumRegression(fixture, analysis, { minLevel: .05 }));
}
const admitted = Object.values(comparison).every(row => row.maxTimeDeltaMs !== null && row.maxTimeDeltaMs <= 1
	&& row.maxLevelDelta !== null && row.maxLevelDelta <= .01 + 1e-12);
for (const [path, before] of Object.entries(sourceHashes)) {
	if (hash(path) !== before) throw new Error(`Detector changed during comparison: ${path}`);
}
const report = { status: admitted ? 'passed' : 'failed', tolerances: { timeMs: 1, level: .01 },
	id, input, inputSha256: hash(input), reference, candidate, offset, duration,
	baselinePath, baselineSha256: hash(baselinePath), sourceHashes,
	comparison, labels,
	pcm: Object.fromEntries([reference, candidate].map(dir => [dir, Object.fromEntries(
		['kick', 'snare', 'cymbal'].map(kind => [kind, hash(join(dir, kind + '.f32'))]))])) };
writeFileSync(join(candidate, 'onset-parity.json'), JSON.stringify(report, null, 2));
writeFileSync(join(candidate, 'review-analysis.json'), JSON.stringify(analyses[1], null, 2));
console.log(JSON.stringify({ ...report, pcm: undefined, sourceHashes: undefined,
	labels: labels?.map(row => ({ positives: row.matchedPositiveCount, total: row.confirmedPositiveCount,
		negativeViolations: row.violatedNegativeCount })), comparison: Object.fromEntries(Object.entries(comparison)
	.map(([kind, value]) => [kind, { ...value, reference: undefined, candidate: undefined }])) }, null, 2));
if (!admitted) process.exitCode = 1;
