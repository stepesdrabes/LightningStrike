import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import type { OpenSession } from './onnxSession.ts';
import { CACHE_DIR } from './paths.ts';
import { Striker2, runtimeVersion, type Striker2Model } from './striker2.ts';
import {
	checkParity, readGolden, type GoldenChunk, type ParityReport, type ParityVerdict
} from './striker2Parity.ts';

/**
 * `analysisProvider` in settings.json. `auto` tries the platform's graphics provider first (Core ML
 * on Apple silicon, DirectML on Windows); `cpu` is the CPU alone.
 */
export const ANALYSIS_PROVIDERS = ['auto', 'cpu'] as const;
export type AnalysisProvider = (typeof ANALYSIS_PROVIDERS)[number];
export const DEFAULT_ANALYSIS_PROVIDER: AnalysisProvider = 'auto';

export function isAnalysisProvider(value: unknown): value is AnalysisProvider {
	return ANALYSIS_PROVIDERS.includes(value as AnalysisProvider);
}

export interface ExecutionProvider {
	name: 'cpu' | 'coreml' | 'dml' | 'webgpu';
	/** onnxruntime-node's options for it, such as `coreMlFlags` or `deviceId`. */
	options?: Readonly<Record<string, number | string>>;
	/** Intra-op threads; absent is onnxruntime's default. */
	threads?: number;
}

export const CPU: ExecutionProvider = { name: 'cpu' };
/** MLProgram 0x10, static input shapes 0x08, CPU and GPU 0x20; float32 never reaches the Neural Engine. */
export const COREML: ExecutionProvider = { name: 'coreml', options: { coreMlFlags: 0x38 } };
export const DIRECTML: ExecutionProvider = { name: 'dml', options: { deviceId: 0 } };

/** `cpu`, `coreml:56`, `dml:0`; a thread count is appended when set. */
export function providerLabel(provider: ExecutionProvider): string {
	const options = Object.values(provider.options ?? {});
	const threads = provider.threads ? ` threads=${provider.threads}` : '';
	return `${provider.name}${options.length > 0 ? `:${options.join(':')}` : ''}${threads}`;
}

/** Session options for Striker2.create. DirectML needs memory patterns off and sequential runs. */
export function providerSession(provider: ExecutionProvider): Record<string, unknown> {
	return {
		executionProviders: provider.name === 'cpu'
			? ['cpu']
			: [{ name: provider.name, ...provider.options }, 'cpu'],
		...(provider.name === 'dml' ? { enableMemPattern: false, executionMode: 'sequential' } : {}),
		...(provider.threads ? { intraOpNumThreads: provider.threads } : {})
	};
}

/** The providers to try, in order, the CPU always last. Core ML and DirectML get only a static graph. */
export function providerCandidates(
	setting: AnalysisProvider, staticGraph: boolean, platform: string = process.platform,
	arch: string = process.arch
): ExecutionProvider[] {
	if (!staticGraph || setting === 'cpu') return [CPU];
	if (platform === 'darwin' && arch === 'arm64') return [COREML, CPU];
	if (platform === 'win32' && arch === 'x64') return [DIRECTML, CPU];
	return [CPU];
}

/** The execution providers this onnxruntime-node build has. It runs one it lacks on the CPU, silently. */
export function bundledProviders(): string[] {
	try {
		const ort = createRequire(import.meta.url)('onnxruntime-node') as {
			listSupportedBackends(): { name: string }[];
		};
		return ort.listSupportedBackends().map(({ name }) => name);
	} catch {
		return ['cpu'];
	}
}

/** Raise when the check changes, so every stored verdict is made again. */
export const CHECK_VERSION = 1;

export interface Machine {
	platform: string;
	arch: string;
	release: string;
	cpu: string;
	/** `sysctl hw.model` on a Mac, which names its GPU too. */
	model: string | null;
	/** Display adapters and their drivers, read for DirectML only. */
	gpu: string | null;
}

function command(file: string, args: string[]): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(file, args, { timeout: 10_000, windowsHide: true }, (error, stdout) => {
			resolve(error ? null : String(stdout).trim() || null);
		});
	});
}

let base: Promise<Machine> | null = null;
let adapters: Promise<string | null> | null = null;

/** This machine as a check key reads it for `provider`. */
export async function thisMachine(provider: ExecutionProvider = CPU): Promise<Machine> {
	const machine = await (base ??= (async () => ({
		platform: process.platform, arch: process.arch, release: release(), cpu: cpus()[0]?.model ?? 'unknown',
		model: process.platform === 'darwin' ? await command('sysctl', ['-n', 'hw.model']) : null,
		gpu: null
	}))());
	if (provider.name !== 'dml') return machine;
	adapters ??= command('powershell', ['-NoProfile', '-Command',
		'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + " " + $_.DriverVersion }']);
	return { ...machine, gpu: (await adapters)?.split(/\r?\n/).join('; ') ?? null };
}

export interface CheckKey extends Machine {
	check: number;
	graph: string;
	ort: string | null;
	provider: string;
	options: Record<string, number | string>;
	threads: number;
}

/** What a verdict depends on, and its short id. A change to any part runs the check again. */
export function checkKey(
	model: Striker2Model, provider: ExecutionProvider, machine: Machine
): { key: CheckKey; id: string } {
	const { platform, arch, release, cpu, model: hardware, gpu } = machine;
	const key: CheckKey = {
		check: CHECK_VERSION, graph: model.sha256, ort: runtimeVersion(), provider: provider.name,
		options: { ...provider.options }, threads: provider.threads ?? 0,
		platform, arch, release, cpu, model: hardware, gpu
	};
	return { key, id: createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 16) };
}

/** Each check key's verdict, in the cache beside the analyses. */
export const PROVIDER_CHECKS = 'striker2-providers.json';

export interface ProviderVerdict {
	key: CheckKey;
	verdict: ParityVerdict;
	reason?: string;
	maxAbs?: ParityReport['maxAbs'];
	events?: ParityReport['events'];
	sessionMs: number;
	checkMs: number;
	date: string;
}

export async function readVerdicts(): Promise<Record<string, ProviderVerdict>> {
	try {
		const { checks } = JSON.parse(await readFile(join(CACHE_DIR, PROVIDER_CHECKS), 'utf8')) as {
			checks?: Record<string, ProviderVerdict>;
		};
		return checks && typeof checks === 'object' ? checks : {};
	} catch {
		return {};
	}
}

/** A verdict that cannot be stored is made again next time; it never stops a preparation. */
async function record(id: string, verdict: ProviderVerdict): Promise<void> {
	try {
		const checks = { ...(await readVerdicts()), [id]: verdict };
		const file = join(CACHE_DIR, PROVIDER_CHECKS);
		const tmp = `${file}.${process.pid}.${threadId}.tmp`;
		await mkdir(CACHE_DIR, { recursive: true });
		await writeFile(tmp, JSON.stringify({ version: 1, checks }, null, '\t'));
		await rename(tmp, file);
	} catch {
		// Unwritable cache.
	}
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const since = (start: number) => Math.round(performance.now() - start);

/** A Striker 2.0 session on the provider that passed, or the CPU. */
export interface CheckedStriker2 {
	striker: Striker2;
	provider: ExecutionProvider;
	label: string;
	/** The check key's id, which `.preparation.json` records. */
	check: string;
	key: CheckKey;
	/** Why a faster provider is not used, or why the CPU runs unchecked. */
	warnings: string[];
}

export interface ProviderDeps {
	platform?: string;
	arch?: string;
	/** This machine, unless given. */
	machine?: Machine;
	/** `bundledProviders()`, unless given. */
	bundled?: readonly string[];
	open?: OpenSession;
	log?: (line: string) => void;
}

/**
 * Opens Striker 2.0 on the first candidate that passes Rule P on the golden chunks, its verdict
 * stored per check key so a pass is checked once. The CPU is checked too, but runs whatever its
 * verdict, with a warning: nothing else could.
 */
export async function openChecked(
	model: Striker2Model, setting: AnalysisProvider, deps: ProviderDeps = {}
): Promise<CheckedStriker2> {
	const { platform = process.platform, arch = process.arch, open, log = () => {} } = deps;
	const warnings: string[] = [];
	const warn = (line: string) => {
		warnings.push(line);
		log(`Striker 2.0: ${line}`);
	};
	const candidates = providerCandidates(setting, model.static, platform, arch);
	if (!model.static && providerCandidates(setting, true, platform, arch).length > 1) {
		warn('its graph is not static, which the GPU providers need, so the CPU runs it');
	}
	let golden: Promise<GoldenChunk[]> | null = null;
	for (const provider of candidates) {
		const cpu = provider.name === 'cpu';
		const label = providerLabel(provider);
		if (!cpu && !(deps.bundled ?? bundledProviders()).includes(provider.name)) {
			warn(`${label} is not used: this onnxruntime-node build does not have it`);
			continue;
		}
		const { key, id } = checkKey(model, provider, deps.machine ?? await thisMachine(provider));
		const known = (await readVerdicts())[id];
		if (!cpu && known && known.verdict !== 'pass') {
			warn(`${label} is not used: ${known.reason}`);
			continue;
		}
		let chunks: GoldenChunk[] | null = null;
		let unchecked = '';
		if (!known) {
			chunks = await (golden ??= readGolden(model)).catch((e: unknown) => {
				unchecked = message(e);
				return null;
			});
			if (!chunks && !cpu) {
				warn(`${label} is not used: it cannot be checked (${unchecked})`);
				continue;
			}
		}
		// Core ML compiles the graph on every session; that can take a minute.
		if (!cpu) log(`opening Striker 2.0 on ${label}`);
		const opening = performance.now();
		let striker: Striker2;
		try {
			striker = await Striker2.create(model, { session: providerSession(provider), open });
		} catch (e) {
			if (cpu) throw e;
			const reason = `its session did not open (${message(e)})`;
			const date = new Date().toISOString();
			await record(id, { key, verdict: 'fail', reason, sessionMs: since(opening), checkMs: 0, date });
			warn(`${label} is not used: ${reason}`);
			continue;
		}
		const sessionMs = since(opening);
		const chosen = { striker, provider, label, check: id, key, warnings };
		if (known) {
			if (known.verdict !== 'pass') warn(`the CPU did not pass its check (${known.reason}) and runs anyway`);
			return chosen;
		}
		if (!chunks) {
			warn(`the CPU runs unchecked: ${unchecked}`);
			return chosen;
		}
		log(`checking Striker 2.0 on ${label}`);
		const checking = performance.now();
		const report = await checkParity(model, chunks, (x) => striker.chunk(x))
			.catch((e: unknown): ParityReport => ({ verdict: 'fail', reason: message(e), maxAbs: {}, events: {} }));		await record(id, {
			key, verdict: report.verdict, reason: report.reason, maxAbs: report.maxAbs, events: report.events,
			sessionMs, checkMs: since(checking), date: new Date().toISOString()
		});
		if (report.verdict === 'pass') return chosen;
		if (cpu) {
			warn(`the CPU did not pass its check (${report.reason}) and runs anyway`);
			return chosen;
		}
		warn(`${label} is not used: ${report.reason}`);
		await striker.close().catch(() => {});
	}
	throw new Error('no provider can run Striker 2.0');
}

/** Stores a failed verdict for a provider that broke on a song, so it is not tried again. */
export async function markFailed(checked: CheckedStriker2, reason: string): Promise<void> {
	const known = (await readVerdicts())[checked.check];
	await record(checked.check, {
		...known, key: checked.key, verdict: 'fail', reason: `it failed on a song (${reason})`,
		sessionMs: known?.sessionMs ?? 0, checkMs: known?.checkMs ?? 0, date: new Date().toISOString()
	});
}
