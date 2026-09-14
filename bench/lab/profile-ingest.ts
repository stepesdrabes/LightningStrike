// node bench/lab/profile-ingest.ts --id=TRACK --out=NEW_DIRECTORY [--help for every flag]
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus, platform, arch, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { benchmarkCache } from '../cache.ts';

const option = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.argv.includes('--help')) {
	console.log('node bench/lab/profile-ingest.ts --id=TRACK --out=NEW_DIRECTORY [--cache=SOURCE_CACHE] [--runs=2] [--worker=BUILT_WORKER] [--models=MODEL_DIR] [--graphs=SEPARATOR_GRAPH_DIR] [--fresh-evidence] [--fresh-context] [--fresh-genre]');
	process.exit(0);
}
// --graphs seeds verified CPU graphs so a first import is timed with the app's warm graph cache;
// --fresh-evidence deletes separated drums before every run; --fresh-context re-runs enrichment;
// --fresh-genre re-runs only the local genre model, as for a new track, without catalogue lookups.
// Every run records how late a 10 ms main-thread timer fires, standing in for the hardware renderer.
const freshEvidence = process.argv.includes('--fresh-evidence');
const freshGenre = process.argv.includes('--fresh-genre');
const freshContext = process.argv.includes('--fresh-context');
const id = option('id');
if (!id || !/^(?:[\w-]{11}|file-[a-f0-9]{12})$/.test(id)) throw new Error('Pass a cached track identifier.');
if (!option('out')) throw new Error('Pass --out with a new benchmark directory.');
const out = resolve(option('out')!);
if (existsSync(out)) throw new Error('Benchmark output already exists. Use a new directory.');
const cache = resolve(benchmarkCache(option('cache')));
const scratch = join(out, 'cache');
const workerPath = resolve(option('worker') ?? 'packages/analysis/src/ingestWorker.ts');
const modelDir = resolve(option('models') ?? 'models');
const runs = Number(option('runs') ?? 2);
if (!Number.isInteger(runs) || runs < 1 || runs > 5) throw new Error('--runs must be 1 to 5.');
const files = (await readdir(cache)).filter(name => name.startsWith(id + '.') &&
	/\.(m4a|webm|opus|mp3|ogg|oga|aac|wav|flac|mp4|mka|analysis\.json|meta\.json|context\.json)$/.test(name));
const meta = JSON.parse(await readFile(join(cache, `${id}.meta.json`), 'utf8'));
await mkdir(scratch, { recursive: true });
for (const file of files) await copyFile(join(cache, file), join(scratch, file));
if (option('graphs')) {
	await mkdir(join(scratch, 'separator-graphs'));
	for (const file of (await readdir(resolve(option('graphs')!))).filter(name => /\.cpu-v2\.[a-f0-9]{64}\.[a-f0-9]{64}\.onnx$/.test(name))) {
		await copyFile(join(resolve(option('graphs')!), file), join(scratch, 'separator-graphs', file));
	}
}
const savedContext = await readFile(join(scratch, `${id}.context.json`), 'utf8').catch(() => null);
const judgement = join(cache, 'judge', `${id}.json`);
if (existsSync(judgement)) {
	await mkdir(join(scratch, 'judge'));
	await copyFile(judgement, join(scratch, 'judge', `${id}.json`));
}
async function hash(path: string): Promise<string> {
	const digest = createHash('sha256');
	for await (const chunk of createReadStream(path)) digest.update(chunk);
	return digest.digest('hex');
}
function toolVersion(command: string): string {
	try { return execFileSync(command, ['-version'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).slice(0, 3).join('\n'); }
	catch (error) { return String(error); }
}
const inputFiles = Object.fromEntries(await Promise.all(files.map(async file => [file, await hash(join(scratch, file))])));
if (existsSync(judgement)) inputFiles[`judge/${id}.json`] = await hash(judgement);
async function sources(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	return (await Promise.all(entries.map(entry => entry.isDirectory() ? sources(join(directory, entry.name))
		: Promise.resolve(entry.name.endsWith('.ts') ? [join(directory, entry.name)] : [])))).flat();
}
const importedSources = (await Promise.all(['packages/analysis/src', 'packages/core/src'].map(sources))).flat().sort();
const sourceHashes = Object.fromEntries(await Promise.all(importedSources.map(async file => [file, await hash(file)])));
// A bundled ingest worker runs its ONNX and DSP work in sibling bundles, or in-thread without them.
const siblingWorkers = async () => Object.fromEntries(await Promise.all(['onnx-worker.mjs', 'dsp-worker.mjs'].map(async name =>
	[name, existsSync(join(dirname(workerPath), name)) ? await hash(join(dirname(workerPath), name)) : null])));
const provenance = { id, title: meta.title, workerPath, workerSha256: await hash(workerPath),
	siblingWorkers: option('worker') ? await siblingWorkers() : undefined,
	profilerSha256: await hash('bench/lab/profile-ingest.ts'),
	lockfileSha256: await hash('package-lock.json'),
	ort: JSON.parse(await readFile('node_modules/onnxruntime-node/package.json', 'utf8')).version,
	ffmpeg: toolVersion('ffmpeg'), ffprobe: toolVersion('ffprobe'),
	separatorOptions: { provider: process.env.MV_DRUM_PROVIDER ?? 'cpu', cpuArena: process.env.MV_DRUM_CPU_ARENA ?? 'default',
		cpuLanes: process.env.MV_DRUM_CPU_LANES ?? 'default' },
	sourceHashes: option('worker') ? undefined : sourceHashes,
	node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
	logicalCpus: cpus().length, memoryBytes: totalmem(), inputFiles,
	models: Object.fromEntries(await Promise.all(
		['htdemucs.onnx', 'drumsep-mdx23c.onnx', 'adtof_frame_rnn.onnx', 'drum-fusion.json'].map(async name =>
			[name, existsSync(join(modelDir, name)) ? await hash(join(modelDir, name)) : null]))) };
const results: unknown[] = [];
const busyMs = () => cpus().reduce((sum, cpu) => sum + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq, 0);
for (let run = 1; run <= runs; run++) {
	if (freshEvidence) await rm(join(scratch, 'drum-evidence'), { recursive: true, force: true });
	if (freshContext) await rm(join(scratch, `${id}.context.json`), { force: true });
	else if (freshGenre && savedContext) {
		const context = JSON.parse(savedContext);
		context.sources = context.sources.filter((source: string) => source !== 'effnet');
		await writeFile(join(scratch, `${id}.context.json`), JSON.stringify(context, null, '\t'));
	}
	const cpuBefore = process.cpuUsage();
	const systemBefore = busyMs();
	const started = performance.now();
	let peakRss = process.memoryUsage().rss;
	const lateness: number[] = [];
	let tick = performance.now();
	const ticker = setInterval(() => {
		const now = performance.now();
		lateness.push(now - tick - 10);
		tick = now;
	}, 10);
	const events: { ms: number; stage: string }[] = [];
	const result = await new Promise<any>((accept, reject) => {
		const worker = new Worker(workerPath, { execArgv: [],
			env: { ...process.env, MV_CACHE_DIR: scratch, MV_MODEL_DIR: modelDir },
			workerData: { source: meta.source, opts: { cachedTrackId: id, force: true } } });
		const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
		let settled = false;
		const finish = (error?: Error, value?: unknown) => {
			if (settled) return;
			settled = true;
			clearInterval(sample);
			void worker.terminate().then(() => error ? reject(error) : accept(value));
		};
		worker.on('message', message => {
			if (message.type === 'progress') {
				events.push({ ms: Math.round(performance.now() - started), stage: message.stage });
				console.log(JSON.stringify({ run, ...events.at(-1) }));
			} else if (message.type === 'done') finish(undefined, message.result);
			else if (message.type === 'error') finish(new Error(message.message));
		});
		worker.on('error', error => finish(error));
		worker.on('exit', code => { if (!settled) finish(new Error(`Worker exited before returning: ${code}`)); });
	});
	clearInterval(ticker);
	lateness.sort((a, b) => a - b);
	const percentile = (q: number) => Math.round(10 * (lateness[Math.min(lateness.length - 1, Math.floor(q * lateness.length))] ?? 0)) / 10;
	const timerLateMs = { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: percentile(1) };
	const cpu = process.cpuUsage(cpuBefore);
	const processCpuMs = Math.round((cpu.user + cpu.system) / 1000);
	const summary = { run, wallMs: Math.round(performance.now() - started), peakRss, processCpuMs, timerLateMs,
		otherCpuMs: Math.round(busyMs() - systemBefore - processCpuMs),
		timings: result.timings, analysisVersion: result.analysis.version,
		drumSeparation: result.analysis.drumSeparation, drumFusion: result.analysis.drumFusion, events };
	const { 'htdemucs.onnx': demucs, 'drumsep-mdx23c.onnx': kit } = provenance.models;
	const expectedModels = demucs && kit ? `htdemucs-${demucs.slice(0, 8)}-mdx23c-${kit.slice(0, 8)}-` : null;
	if (!expectedModels || !summary.drumSeparation?.startsWith(expectedModels)) {
		await writeFile(join(out, 'timings.json'), JSON.stringify({ status: 'invalid',
			reason: 'Expected drum separation did not complete; fallback timings are not comparable.',
			...provenance, results: [...results, summary] }, null, 2));
		throw new Error('Expected drum separation did not complete. Inspect the report before comparing timings.');
	}
	results.push(summary);
	await copyFile(join(scratch, `${id}.analysis.json`), join(out, `run-${run}.analysis.json`));
	await writeFile(join(out, 'timings.json'), JSON.stringify({ status: 'incomplete', ...provenance, results }, null, 2));
	console.log(JSON.stringify({ ...summary, events: undefined }));
}
try {
	if (await hash(workerPath) !== provenance.workerSha256
		|| await hash('bench/lab/profile-ingest.ts') !== provenance.profilerSha256
		|| await hash('package-lock.json') !== provenance.lockfileSha256
		|| (option('worker') && JSON.stringify(await siblingWorkers()) !== JSON.stringify(provenance.siblingWorkers))) {
		throw new Error('Runtime or profiler changed during timing. Rerun for a stable measurement.');
	}
	if (!option('worker')) {
		for (const [file, before] of Object.entries(sourceHashes)) {
			if (await hash(file) !== before) throw new Error(`Source changed during timing: ${file}. Rerun for a stable measurement.`);
		}
	}
	for (const [file, before] of Object.entries(provenance.models)) {
		const path = join(modelDir, file);
		if ((existsSync(path) ? await hash(path) : null) !== before) throw new Error(`Model changed during timing: ${file}.`);
	}
} catch (error) {
	await writeFile(join(out, 'timings.json'), JSON.stringify({ status: 'invalid', reason: String(error), ...provenance, results }, null, 2));
	throw error;
}
await writeFile(join(out, 'timings.json'), JSON.stringify({ status: 'verified', ...provenance, results }, null, 2));
