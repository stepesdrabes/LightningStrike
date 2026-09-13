import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, readdir, rm, stat, utimes } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { arch, cpus, platform, release } from 'node:os';

const MAX_GRAPH_BYTES = 512 * 1024 ** 2;

export async function hashFile(path: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

interface GraphCacheOptions<T> {
	modelPath: string;
	modelSha256: string;
	runtimeVersion: string | undefined;
	cacheDir?: string;
	sessionOptions: Record<string, unknown>;
	load: (path: string, options: Record<string, unknown>) => Promise<T>;
}

function escaped(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function processGone(pid: number): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return false; }
	catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
}

async function entries(directory: string): Promise<string[]> {
	try { return await readdir(directory); } catch { return []; }
}

async function cleanInterruptedExports(directory: string, name: string): Promise<void> {
	const pattern = new RegExp(`^\\.${escaped(name)}\\.cpu-v2\\.(\\d+)\\.[a-f0-9-]+\\.tmp\\.onnx$`);
	for (const file of await entries(directory)) {
		const match = pattern.exec(file);
		// A live/reused PID stays untouched, including after laptop suspend/resume.
		if (match && processGone(Number(match[1]))) await rm(join(directory, file), { force: true }).catch(() => {});
	}
}

async function trimGraphs(directory: string, name: string, keep?: string): Promise<number> {
	const pattern = new RegExp(`^${escaped(name)}\\.cpu-v2\\.[a-f0-9]{64}\\.[a-f0-9]{64}\\.onnx$`);
	let retained = 0;
	for (const file of await entries(directory)) {
		if (!pattern.test(file) && file !== `${name}.optimized.onnx`) continue;
		const path = join(directory, file);
		if (path !== keep) await rm(path, { force: true }).catch(() => {});
		try { retained += (await stat(path)).size; } catch { /* Removed or concurrently pruned. */ }
	}
	return retained;
}

/** Optional local CPU graph cache. Original model integrity must be verified by the caller. */
export async function createCachedCpuSession<T>(input: GraphCacheOptions<T>): Promise<T> {
	const { modelPath, modelSha256, runtimeVersion, cacheDir, sessionOptions, load } = input;
	if (!cacheDir || !runtimeVersion) return load(modelPath, sessionOptions);
	const fingerprint = {
		format: 2, modelSha256, runtimeVersion, platform: platform(), arch: arch(), os: release(),
		cpu: [...new Set(cpus().map(cpu => cpu.model))].sort(), sessionOptions
	};
	const key = createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
	const name = basename(modelPath, '.onnx');
	const prefix = `${name}.cpu-v2.${key}.`;
	try { await mkdir(cacheDir, { recursive: true }); }
	catch { return load(modelPath, sessionOptions); }
	await cleanInterruptedExports(cacheDir, name);

	for (const file of await entries(cacheDir)) {
		if (!file.startsWith(prefix) || !/^[a-f0-9]{64}\.onnx$/.test(file.slice(prefix.length))) continue;
		const graph = join(cacheDir, file);
		try {
			if ((await stat(graph)).size > MAX_GRAPH_BYTES || await hashFile(graph) !== file.slice(prefix.length, -5)) {
				await rm(graph, { force: true }).catch(() => {});
				continue;
			}
			// Published graph bytes never change. Concurrent pruning may cause a cache miss,
			// but cannot substitute different bytes between verification and native opening.
			const session = await load(graph, { ...sessionOptions, graphOptimizationLevel: 'disabled' });
			const now = new Date();
			await utimes(graph, now, now).catch(() => {});
			await trimGraphs(cacheDir, name, graph);
			return session;
		} catch { /* A missing, incompatible or concurrently pruned graph uses the original. */ }
	}

	const temporary = join(cacheDir, `.${name}.cpu-v2.${process.pid}.${randomUUID()}.tmp.onnx`);
	try {
		let session: T;
		try { session = await load(modelPath, { ...sessionOptions, optimizedModelFilePath: temporary }); }
		catch { return await load(modelPath, sessionOptions); }
		try {
			const size = (await stat(temporary)).size;
			if (size > MAX_GRAPH_BYTES) return session;
			const hash = await hashFile(temporary);
			const graph = join(cacheDir, `${prefix}${hash}.onnx`);
			const retained = await trimGraphs(cacheDir, name, graph);
			const existing = await stat(graph).then(info => info.size).catch(() => 0);
			if (retained + (existing ? 0 : size) > MAX_GRAPH_BYTES) return session;
			try {
				// Creating a hard link is atomic and cannot replace an existing reader's file.
				await link(temporary, graph);
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return session;
			}
			await trimGraphs(cacheDir, name, graph);
		} catch { /* Inference is available even when export, publication or pruning fails. */ }
		return session;
	} finally {
		await rm(temporary, { force: true }).catch(() => {});
	}
}
