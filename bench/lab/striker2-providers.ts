// node bench/lab/striker2-providers.ts --model=DIR --song=AUDIO [--out=FILE] [--providers=ID,...]
//   [--dynamic=GRAPH] [--webgpu] [--dml]
// Striker 2.0 on each execution provider this machine has, one child process each, nothing else
// running: session creation, the first and three further chunk runs, a whole song the app's way,
// peak memory, Rule P on the manifest's golden chunks and the song's events against the CPU.
// DIR holds striker2.json, its static graph and golden files; --dynamic names an older graph with
// a dynamic batch (Core ML 24 on it shows the fragmentation). Mac runs: CPU at the default threads
// and at the performance-core count, Core ML 56 and 24, and Core ML 25 (Core ML's own CPU) as a
// reference; WebGPU only with --webgpu. Windows: the CPU, DirectML only with --dml. Prints a table
// and writes a JSON report (default bench/reports/striker2-providers/<machine>-<date>.json).
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, hostname, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import {
	STRIKER2_MANIFEST, Striker2, decodeStriker2, readStriker2, type Striker2Result
} from '../../packages/analysis/src/striker2.ts';
import { striker2Features } from '../../packages/analysis/src/striker2Frontend.ts';
import {
	checkParity, compareEvents, readGolden, streamEqual, type ParityReport, type StreamComparison
} from '../../packages/analysis/src/striker2Parity.ts';
import {
	bundledProviders, providerLabel, providerSession, type ExecutionProvider
} from '../../packages/analysis/src/striker2Provider.ts';

interface Run {
	id: string;
	provider: ExecutionProvider;
	/** An older graph with a dynamic batch instead of the manifest's. */
	graph?: string;
}

interface Measured {
	sessionMs: number;
	firstMs: number;
	chunkMs: number[];
	medianMs: number;
	song: { frontMs: number; networkMs: number; decodeMs: number; appMs: number; sameEvents: boolean };
	peakRssMb: number;
	ruleP: ParityReport | { verdict: 'unchecked'; reason: string };
	events: Striker2Result;
}

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ms = (since: number) => Math.round(performance.now() - since);
const ort = (createRequire(import.meta.url)('onnxruntime-node/package.json') as { version: string }).version;

function f32(path: string): Float32Array {
	const buf = readFileSync(path);
	return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** One provider, measured in this process; the parent reads the last stdout line. */
async function child(spec: { run: Run; model: string; mono: string }): Promise<Measured> {
	if (!bundledProviders().includes(spec.run.provider.name)) {
		throw new Error(`this onnxruntime-node build has no ${spec.run.provider.name}`);
	}
	const loaded = await readStriker2(spec.model, STRIKER2_MANIFEST, { verify: false });
	const model = spec.run.graph ? { ...loaded, graph: spec.run.graph, static: false } : loaded;
	const mono = f32(spec.mono);
	let at = performance.now();
	const front = striker2Features(mono, model.taps);
	const frontMs = ms(at);
	// Info level makes ORT log how Core ML partitions the graph.
	const log = spec.run.provider.name === 'cpu' ? {} : { logSeverityLevel: 1 };
	at = performance.now();
	const striker = await Striker2.create(model, { session: { ...providerSession(spec.run.provider), ...log } });
	const sessionMs = ms(at);
	const golden = await readGolden(model).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
	const chunk = typeof golden === 'string' ? front.data.slice(0, model.chunk * front.bins) : golden[0].features;
	at = performance.now();
	await striker.chunk(chunk);
	const firstMs = ms(at);
	const chunkMs: number[] = [];
	for (let i = 0; i < 3; i++) {
		at = performance.now();
		await striker.chunk(chunk);
		chunkMs.push(ms(at));
	}
	const ruleP = typeof golden === 'string'
		? { verdict: 'unchecked' as const, reason: golden }
		: await checkParity(model, golden, (x) => striker.chunk(x));
	at = performance.now();
	const outputs = await striker.outputs(front);
	const networkMs = ms(at);
	at = performance.now();
	const events = decodeStriker2(model, outputs);
	const decodeMs = ms(at);
	at = performance.now();
	const app = await striker.run(mono);
	const appMs = ms(at);
	await striker.close();
	return {
		sessionMs, firstMs, chunkMs, medianMs: [...chunkMs].sort((a, b) => a - b)[1],
		song: { frontMs, networkMs, decodeMs, appMs, sameEvents: JSON.stringify(app) === JSON.stringify(events) },
		peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024), ruleP, events
	};
}

function command(file: string, params: string[]): Promise<string | null> {
	return new Promise((resolve) => execFile(file, params, (error, stdout) =>
		resolve(error ? null : String(stdout).trim() || null)));
}

async function machine() {
	const mac = platform() === 'darwin';
	const sysctl = (name: string) => (mac ? command('sysctl', ['-n', name]) : Promise.resolve(null));
	return {
		hostname: hostname(), platform: platform(), arch: arch(), release: release(),
		os: mac ? `macOS ${await command('sw_vers', ['-productVersion'])}` : `${platform()} ${release()}`,
		model: await sysctl('hw.model'), chip: (await sysctl('machdep.cpu.brand_string')) ?? cpus()[0]?.model,
		performanceCores: Number(await sysctl('hw.perflevel0.physicalcpu')) || null,
		efficiencyCores: Number(await sysctl('hw.perflevel1.physicalcpu')) || null,
		logicalCpus: cpus().length, memoryGb: Math.round(totalmem() / 2 ** 30), node: process.version, ort
	};
}

function runsFor(info: Awaited<ReturnType<typeof machine>>): Run[] {
	const coreml = (flags: number, graph?: string): Run => ({
		id: `coreml-${flags}${graph ? '-dynamic' : ''}`, provider: { name: 'coreml', options: { coreMlFlags: flags } }, graph
	});
	const runs: Run[] = [{ id: 'cpu', provider: { name: 'cpu' } }];
	if (info.platform === 'darwin' && info.arch === 'arm64') {
		if (info.performanceCores) runs.push({ id: 'cpu-perf', provider: { name: 'cpu', threads: info.performanceCores } });
		runs.push(coreml(56), coreml(24), coreml(25));
		const dynamic = flag('dynamic');
		if (dynamic) runs.push(coreml(24, dynamic));
	}
	if (args.includes('--webgpu')) {
		runs.push({ id: 'webgpu', provider: { name: 'webgpu' } },
			{ id: 'webgpu-nchw', provider: { name: 'webgpu', options: { preferredLayout: 'NCHW' } } });
	}
	if (args.includes('--dml') && info.platform === 'win32') runs.push({ id: 'dml', provider: { name: 'dml', options: { deviceId: 0 } } });
	const only = flag('providers')?.split(',');
	return only ? runs.filter((r) => only.includes(r.id)) : runs;
}

/** A provider in its own process, so its memory peak and ORT's log lines are its own. */
function measure(spec: { run: Run; model: string; mono: string }) {
	const script = fileURLToPath(import.meta.url);
	return new Promise<{ result?: Measured; error?: string; log: string[] }>((resolve) => {
		const proc = spawn(process.execPath, [...process.execArgv, script, `--child=${JSON.stringify(spec)}`],
			{ stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		proc.stdout.on('data', (d) => (out += d));
		proc.stderr.on('data', (d) => (err += d));
		proc.on('close', (code) => {
			const log = err.split(/\r?\n/).filter((l) => /coreml|partition|webgpu|dml|error/i.test(l)).slice(0, 200);
			const last = out.trim().split(/\r?\n/).at(-1) ?? '';
			try {
				const parsed = JSON.parse(last) as { result?: Measured; error?: string };
				resolve({ ...parsed, log });
			} catch {
				resolve({ error: `exited with ${code}: ${err.trim().split(/\r?\n/).slice(-3).join(' / ')}`, log });
			}
		});
	});
}

const seconds = (v?: number) => (v === undefined ? '-' : `${(v / 1000).toFixed(2)} s`);

function songAgainst(reference: Striker2Result | undefined, events: Striker2Result | undefined) {
	if (!reference || !events) return null;
	const streams: Record<string, StreamComparison> = compareEvents(reference, events);
	const flips = Object.values(streams).reduce((n, s) => n + s.flips, 0);
	return { equal: Object.values(streams).every(streamEqual), flips, streams };
}

async function main() {
	const childSpec = flag('child');
	if (childSpec) {
		try {
			console.log(JSON.stringify({ result: await child(JSON.parse(childSpec)) }));
		} catch (e) {
			console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
		}
		return;
	}
	const dir = flag('model');
	const song = flag('song');
	if (!dir || !song) throw new Error('Usage: node bench/lab/striker2-providers.ts --model=DIR --song=AUDIO');
	const info = await machine();
	console.log(`${info.model ?? info.chip}, ${info.os}, Node ${info.node}, onnxruntime-node ${ort}`);
	const model = await readStriker2(dir);
	const goldenOk = await readGolden(model).then((g) => g.length, (e: Error) => e.message);
	console.log(`${model.name}: ${model.static ? 'static' : 'dynamic'} graph, chunk ${model.chunk}, golden ${goldenOk}`);
	const audio = await decodeAudio(song, 44100);
	const scratch = join(tmpdir(), `striker2-providers-${process.pid}`);
	mkdirSync(scratch, { recursive: true });
	const mono = join(scratch, 'mono.f32');
	writeFileSync(mono, Buffer.from(audio.mono.buffer, audio.mono.byteOffset, audio.mono.byteLength));
	const runs = runsFor(info);
	const results: Record<string, unknown>[] = [];
	let reference: Striker2Result | undefined;
	console.log(['run', 'session', 'first', 'chunk', 'front', 'network', 'decode', 'app song', 'peak',
		'partitions', 'Rule P', 'song events'].join('\t'));
	try {
		for (const run of runs) {
			const { result, error, log } = await measure({ run, model: dir, mono });
			if (run.id === 'cpu') reference = result?.events;
			const partitions = log.find((l) => /number of partitions supported by CoreML/.test(l)) ?? null;
			const against = run.id === 'cpu' ? null : songAgainst(reference, result?.events);
			const { events: _, ...kept } = result ?? ({} as Partial<Measured>);
			results.push({ id: run.id, label: providerLabel(run.provider), provider: run.provider,
				graph: run.graph ? 'dynamic' : 'static', ...kept, partitions, songAgainstCpu: against, error, log });
			const p = result?.ruleP;
			console.log([run.id, seconds(result?.sessionMs), seconds(result?.firstMs), seconds(result?.medianMs),
				seconds(result?.song.frontMs), seconds(result?.song.networkMs), seconds(result?.song.decodeMs),
				seconds(result?.song.appMs), result ? `${result.peakRssMb} MB` : '-',
				partitions?.match(/CoreML: (\d+)/)?.[1] ?? '-', p ? `${p.verdict}${p.reason ? ` (${p.reason})` : ''}` : '-',
				error ? `error: ${error}` : against ? (against.equal ? 'equal' : `${against.flips} flips`) : 'reference'
			].join('\t'));
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
	const out = flag('out') ?? join('bench', 'reports', 'striker2-providers',
		`${(info.model ?? info.hostname).replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify({
		tool: 'bench/lab/striker2-providers.ts', date: new Date().toISOString(), machine: info,
		model: { name: model.name, sha256: model.sha256, static: model.static, chunk: model.chunk, golden: goldenOk },
		song: { file: song, seconds: audio.duration }, runs: results
	}, null, '\t'));
	console.log(`Report: ${out}`);
}

await main();
