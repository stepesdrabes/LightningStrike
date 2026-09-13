// Reusable transcription and DSP probes against the exact grid shown to a listener.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Adtof, onsetsFromActivations } from '../../packages/analysis/src/adtof.ts';
import { analyzeTrack } from '../../packages/analysis/src/analyze.ts';
import { detectSeparatedDrums } from '../../packages/analysis/src/separatedDrums.ts';
import { MODEL_DIR } from '../../packages/analysis/src/paths.ts';
import { featuresOf, readF32, sha256 } from './mdb.ts';

const root = 'bench/reports/audio-reliability/judgement-correction';
const requested = process.argv.find(arg => arg.startsWith('--ids='))?.slice(6).split(',');
if (!requested?.length) throw new Error('Pass --ids=TRACK,... after preparing source PCM.');
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const serialize = (value: unknown) => JSON.stringify(value, (_, v) => ArrayBuffer.isView(v) ? Array.from(v as Float32Array) : v);
for (const id of requested) {
	const directory = join(root, 'sources', id);
	const manifest = json(join(directory, 'manifest.json'));
	const baselinePath = join(root, 'cache', `${id}.analysis.json`);
	const baseline = json(baselinePath);
	const contextPath = join(root, 'cache', `${id}.context.json`);
	const context = existsSync(contextPath) ? json(contextPath) : undefined;
	const pcm = readF32(join(directory, 'mix.f32'));
	const mono = readF32(join(directory, 'mix22.f32'));
	const activationPath = join(directory, 'adtof.activations.f32');
	const metadataPath = join(directory, 'adtof.json');
	const identity = { pcmSha256: sha256(join(directory, 'mix.f32')),
		modelSha256: sha256(join(MODEL_DIR, 'adtof_frame_rnn.onnx')), frontendSha256: sha256('packages/analysis/src/adtof.ts') };
	let activations: Float32Array;
	if (existsSync(activationPath) && existsSync(metadataPath) && Object.entries(identity)
		.every(([key, value]) => json(metadataPath)[key] === value)) {
		activations = readF32(activationPath);
	} else {
		const model = await Adtof.create();
		if (!model) throw new Error('ADTOF required for review diagnostics.');
		const capture: { activations?: Float32Array } = {};
		try { await model.run(pcm, capture); } finally { await model.close(); }
		activations = capture.activations!;
		writeFileSync(activationPath, Buffer.from(activations.buffer, activations.byteOffset, activations.byteLength));
		writeFileSync(metadataPath, JSON.stringify(identity, null, 2));
	}
	const drums = onsetsFromActivations(activations);
	const sources = { sampleRate: 22050, kick: readF32(join(directory, 'kick22.f32')),
		snare: readF32(join(directory, 'snare22.f32')), cymbal: readF32(join(directory, 'cymbal22.f32')) };
	const probe: NonNullable<Parameters<typeof analyzeTrack>[0]['probe']> = {};
	const analysis = analyzeTrack({ mono, sampleRate: 22050, duration: mono.length / 22050,
		hash: manifest.analysisHash, title: baseline.title, trackId: id, beats: baseline.beats,
		downbeats: baseline.bars.map((bar: { t: number }) => bar.t), metricalLevel: 1,
		octaveGuard: false, drums, separatedDrums: sources, context, probe });
	analysis.drumSeparation = manifest.version;
	const features = featuresOf({ mono, sampleRate: 22050 } as Parameters<typeof featuresOf>[0]);
	const sourceDrums = detectSeparatedDrums(sources, mono, 22050, features.odf, features.curves.fps,
		{ kick: probe.drums!.detected.kick, snare: drums.snare });
	writeFileSync(join(directory, 'review-evidence.json'), serialize({
		id, referenceAnalysisSha256: sha256(baselinePath), identity, model: drums, ...probe.drums,
		sourceDrums, currentAnalysis: analysis.onsets,
		detectorSha256: sha256('packages/analysis/src/separatedDrums.ts') }));
	writeFileSync(join(directory, 'candidate.analysis.json'), JSON.stringify(analysis, null, 2));
	console.log(JSON.stringify({ id, kick: analysis.onsets.kick.times.length, snare: analysis.onsets.snare.times.length }));
}
