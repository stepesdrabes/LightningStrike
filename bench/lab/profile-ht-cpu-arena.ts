// Preparation and self-test never import ORT or run inference.
// node bench/lab/profile-ht-cpu-arena.ts --prepare
// node bench/lab/profile-ht-cpu-arena.ts --run  (only in an agreed idle benchmark window)
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import type { InferenceSession } from 'onnxruntime-node';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = 'bench/reports/audio-reliability/separation-performance/cpu-arena';
const PLAN = resolve(ROOT, OUTPUT, 'plan.json');
const LENGTH = 343980;
const LIMITS = { relativeRms: 0.001, correlation: 0.999999 };
const CONFIGS = [
	{ id: 'arena-default-pattern', pattern: true, initializers: false },
	{ id: 'arena-no-pattern', pattern: false, initializers: false },
	{ id: 'arena-direct-initializers', pattern: true, initializers: true },
	{ id: 'arena-no-pattern-direct-initializers', pattern: false, initializers: true },
] as const;
const FILES = {
	model: 'bench/reports/audio-reliability/separation-performance/htdemucs-host-fft.onnx',
	originalModel: 'bench/reports/audio-reliability/model-exports/htdemucs-original.onnx',
	input: 'bench/reports/audio-reliability/onnx-demucs-stereo/input-normalized.f32',
	reference: 'bench/reports/audio-reliability/onnx-demucs-stereo/output-time.f32',
	captureManifest: 'bench/reports/audio-reliability/onnx-demucs-stereo/manifest.json',
	extractor: 'bench/lab/cut-htdemucs-fft.py',
	fft: 'packages/analysis/src/dsp/separationFft.ts',
	fftKernel: 'packages/analysis/src/dsp/fft.ts',
	harness: 'bench/lab/profile-ht-cpu-arena.ts',
};
type FileProof = { path: string; bytes: number; sha256: string };
type Plan = { schema: number; createdAt: string; files: Record<keyof typeof FILES, FileProof>; limits: typeof LIMITS };
const absolute = (path: string) => resolve(ROOT, path);
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
async function proof(path: string): Promise<FileProof> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(absolute(path))) hash.update(chunk);
	return { path, bytes: statSync(absolute(path)).size, sha256: hash.digest('hex') };
}
function readFloat(path: string) {
	const bytes = readFileSync(absolute(path));
	assert.equal(bytes.byteLength % 4, 0);
	return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}
function parity(actual: Float32Array, reference: Float32Array) {
	assert.equal(actual.length, reference.length, 'Reference/output sample count mismatch');
	let errorEnergy = 0, referenceEnergy = 0, actualEnergy = 0, dot = 0, maxError = 0;
	for (let i = 0; i < actual.length; i++) {
		const error = actual[i] - reference[i];
		errorEnergy += error * error; referenceEnergy += reference[i] ** 2;
		actualEnergy += actual[i] ** 2; dot += actual[i] * reference[i];
		maxError = Math.max(maxError, Math.abs(error));
	}
	const relativeRms = Math.sqrt(errorEnergy / referenceEnergy);
	const correlation = dot / Math.sqrt(referenceEnergy * actualEnergy);
	return { maxError, rmsError: Math.sqrt(errorEnergy / actual.length), relativeRms, correlation,
		passed: Number.isFinite(relativeRms) && Number.isFinite(correlation)
			&& relativeRms < LIMITS.relativeRms && correlation > LIMITS.correlation };
}
function hardware() {
	return { node: process.version, ort: JSON.parse(readFileSync(absolute('node_modules/onnxruntime-node/package.json'), 'utf8')).version,
		platform: platform(), arch: arch(), osRelease: release(), totalMemoryBytes: totalmem(),
		cpuModels: [...new Set(cpus().map(cpu => cpu.model))], logicalCpus: cpus().length };
}
// Node reports maxRSS in KiB on Windows and macOS as well as Linux.
const memory = () => ({ ...process.memoryUsage(), peakRssBytes: process.resourceUsage().maxRSS * 1024 });
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function verifyPlan(plan: Plan) {
	assert.equal(plan.schema, 1);
	assert.deepEqual(plan.limits, LIMITS);
	for (const key of Object.keys(FILES) as (keyof typeof FILES)[]) {
		assert.equal(plan.files[key].path, FILES[key]);
		assert.deepEqual(await proof(FILES[key]), plan.files[key], `${key} changed since preparation; prepare a new comparison`);
	}
}
async function worker(id: string, plan: Plan) {
	const config = CONFIGS.find(value => value.id === id);
	assert.ok(config, `Unknown configuration ${id}`);
	await verifyPlan(plan);
	const ort = await import('onnxruntime-node');
	const { demucsSpec, demucsIspec } = await import('../../packages/analysis/src/dsp/separationFft.ts');
	const input = readFloat(FILES.input);
	assert.equal(input.length, 2 * LENGTH);
	const allReference = readFloat(FILES.reference);
	assert.equal(allReference.length, 4 * 2 * LENGTH);
	const reference = allReference.subarray(0, input.length); // Original model's drums, planar stereo.
	const startSpec = performance.now();
	const spectrum = demucsSpec(input, LENGTH);
	const specMs = performance.now() - startSpec;
	const options: InferenceSession.SessionOptions = {
		executionProviders: ['cpu'], intraOpNumThreads: 4, interOpNumThreads: 1,
		graphOptimizationLevel: 'all', executionMode: 'sequential', enableCpuMemArena: true,
		enableMemPattern: config.pattern,
		...(config.initializers ? { extra: { session: { use_device_allocator_for_initializers: '1' } } } : {}),
	};
	const feeds = { mix: new ort.Tensor('float32', input, [1, 2, LENGTH]),
		magnitude: new ort.Tensor('float32', spectrum, [1, 4, 2048, 336]) };
	const beforeLoad = memory();
	const loadStart = performance.now();
	const session = await ort.InferenceSession.create(absolute(FILES.model), options);
	const loadMs = performance.now() - loadStart;
	const afterLoad = memory();
	const runs: any[] = [];
	let postRuns: ReturnType<typeof memory> | undefined;
	try {
		for (let run = 0; run < 6; run++) {
			const started = performance.now();
			const prediction = await session.run(feeds);
			const inferMs = performance.now() - started;
			const afterInference = memory();
			try {
				assert.deepEqual(prediction.freq_output.dims, [1, 1, 4, 2048, 336]);
				assert.deepEqual(prediction.time_output.dims, [1, 1, 2, LENGTH]);
				const inverseStart = performance.now();
				const frequency = demucsIspec(prediction.freq_output.data as Float32Array, LENGTH, 1);
				const time = prediction.time_output.data as Float32Array;
				const combined = Float32Array.from(time, (value, i) => value + frequency[i]);
				const inverseMs = performance.now() - inverseStart;
				const check = parity(combined, reference);
				const sha256 = digest(new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength));
				const deterministic = run === 0 || sha256 === runs[0].sha256;
				runs.push({ kind: run === 0 ? 'cold' : 'warm', run, inferMs, inverseMs,
					computeMs: inferMs + inverseMs, afterInference, afterReconstruction: memory(),
					parity: check, sha256, deterministic });
				if (!check.passed || !deterministic) break;
			} finally { for (const output of Object.values(prediction)) output.dispose(); }
		}
		postRuns = memory();
	} finally {
		await session.release();
		for (const feed of Object.values(feeds)) feed.dispose();
	}
	const afterRelease = memory();
	const admitted = runs.length === 6 && runs.every(run => run.parity.passed && run.deterministic);
	const report = { schema: 1, id, pid: process.pid, timestamp: new Date().toISOString(), hardware: hardware(),
		files: plan.files, options, limits: LIMITS, shape: { length: LENGTH, channels: 2, sampleRate: 44100 },
		loadMs, specMs, beforeLoad, afterLoad, runs, postRuns, afterRelease, admitted,
		warmMedianInferMs: admitted ? median(runs.slice(1).map(run => run.inferMs)) : null,
		warmMedianComputeMs: admitted ? median(runs.slice(1).map(run => run.computeMs)) : null,
		measurementNotes: 'First inference cold, then five identical-input warm runs. Spec computed once. Timings exclude parity/hash. RSS includes JS buffers and ORT; maxRSS is process lifetime high-water mark. No forced GC; post-release RSS does not imply OS returned all freed pages. Warm calls explicitly dispose output tensors. No optimized graph cache imported.' };
	writeFileSync(absolute(`${OUTPUT}/${id}.json`), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ id, admitted, loadMs, warmMedianInferMs: report.warmMedianInferMs,
		peakRssBytes: afterRelease.peakRssBytes, postRunRssBytes: postRuns?.rss }));
	if (!admitted) process.exitCode = 1;
}
async function main() {
	if (process.argv.includes('--self-test')) {
		const reference = new Float32Array([1, -1, .5, -.5]);
		assert.equal(parity(reference, reference).passed, true);
		for (const bad of [new Float32Array([0, 0, 0, 0]), new Float32Array([NaN, 1, 1, 1]),
			new Float32Array([-1, 1, -.5, .5]), new Float32Array([2, -2, 1, -1])]) {
			assert.equal(parity(bad, reference).passed, false);
		}
		assert.throws(() => parity(new Float32Array(1), reference));
		console.log('Parity admission self-test passed; no neural inference.');
		return;
	}
	if (process.argv.includes('--prepare')) {
		mkdirSync(absolute(OUTPUT), { recursive: true });
		const files = {} as Plan['files'];
		for (const key of Object.keys(FILES) as (keyof typeof FILES)[]) files[key] = await proof(FILES[key]);
		assert.equal(files.originalModel.sha256, '68d0bf16428ef66e692cdff8a9ccf28f1ef3f69440d57e58605a4cc55fcc5e74');
		const plan: Plan = { schema: 1, createdAt: new Date().toISOString(), files, limits: LIMITS };
		writeFileSync(PLAN, JSON.stringify(plan, null, 2));
		console.log(`Prepared ${PLAN}; no neural inference. Run with --run only in an idle benchmark window.`);
		return;
	}
	const workerId = process.argv.find(arg => arg.startsWith('--worker='))?.slice(9);
	if (!process.argv.includes('--run') && !workerId) {
		console.log('Use --self-test, --prepare, or --run. --run performs four fresh-process CPU benchmarks serially.');
		return;
	}
	const plan: Plan = JSON.parse(readFileSync(PLAN, 'utf8'));
	if (workerId) return worker(workerId, plan);
	await verifyPlan(plan);
	const results: any[] = [];
	for (const config of CONFIGS) {
		console.log(`Starting ${config.id} in a fresh process`);
		await new Promise<void>((accept, reject) => {
			const child = spawn(process.execPath, [fileURLToPath(import.meta.url), `--worker=${config.id}`],
				{ cwd: ROOT, stdio: 'inherit', windowsHide: true });
			child.once('error', reject);
			child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`${config.id} failed: exit ${code}, signal ${signal}`)));
		});
		results.push(JSON.parse(readFileSync(absolute(`${OUTPUT}/${config.id}.json`), 'utf8')));
	}
	const crossConfigBitExact = results.every(result => result.runs[0].sha256 === results[0].runs[0].sha256);
	const summary = { plan, hardware: hardware(), crossConfigBitExact,
		admitted: crossConfigBitExact && results.every(result => result.admitted), results };
	writeFileSync(absolute(`${OUTPUT}/comparison.json`), JSON.stringify(summary, null, 2));
	console.log(JSON.stringify({ admitted: summary.admitted, crossConfigBitExact,
		configs: results.map(({ id, warmMedianInferMs, postRuns, afterRelease }) => ({ id, warmMedianInferMs,
			postRunRssBytes: postRuns.rss, peakRssBytes: afterRelease.peakRssBytes })) }, null, 2));
	if (!summary.admitted) process.exitCode = 1;
}
await main();
