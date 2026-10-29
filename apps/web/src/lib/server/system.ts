import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ANALYSIS_VERSION, SHOW_VERSION } from '@mv/core';
import { CACHE_DIR, MODEL_DIR, runtimeVersion } from '@mv/analysis';

/** Mirrored in $lib/types.ts as SystemInfo. */
export interface SystemInfo {
	cacheDir: string;
	modelDir: string;
	library: { songs: number; bytes: number };
	tools: { name: string; version: string | null; note: string | null }[];
	runtime: { node: string; onnxruntime: string | null; analysis: number; show: number };
}

/** Matches decode.ts: past this age a 403 is blamed on the binary. */
const STALE_DAYS = 45;

function output(cmd: string, args: string[]): Promise<string | null> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: 8000 }, (error, stdout) => resolve(error ? null : String(stdout)));
	});
}

async function folderSize(dir: string): Promise<{ songs: number; bytes: number }> {
	let songs = 0;
	let bytes = 0;
	const walk = async (path: string) => {
		for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
			const full = join(path, entry.name);
			if (entry.isDirectory()) await walk(full);
			else {
				if (path === dir && entry.name.endsWith('.analysis.json')) songs++;
				bytes += (await stat(full).catch(() => null))?.size ?? 0;
			}
		}
	};
	await walk(dir);
	return { songs, bytes };
}

async function tools(): Promise<SystemInfo['tools']> {
	const upgrade = process.platform === 'win32' ? 'winget upgrade yt-dlp.yt-dlp' : 'brew upgrade yt-dlp';
	const [ytdlp, ffmpeg, deno] = await Promise.all([
		output('yt-dlp', ['--version']),
		output('ffmpeg', ['-version']),
		output('deno', ['--version'])
	]);
	const ytVersion = ytdlp?.trim() ?? null;
	const released = ytVersion && /^(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(ytVersion);
	const age = released
		? Math.floor((Date.now() - Date.UTC(+released[1], +released[2] - 1, +released[3])) / 86_400_000)
		: null;
	return [
		{
			name: 'yt-dlp',
			version: ytVersion,
			note: !ytVersion ? 'Not found: YouTube cannot be downloaded'
				: age !== null && age > STALE_DAYS ? `${age} days old, so YouTube may refuse it: ${upgrade}` : null
		},
		{
			name: 'ffmpeg',
			version: ffmpeg ? (/ffmpeg version (\S+)/.exec(ffmpeg)?.[1] ?? 'installed') : null,
			note: ffmpeg ? null : 'Not found: nothing can be decoded'
		},
		{
			name: 'deno',
			version: deno ? (/deno (\S+)/.exec(deno)?.[1] ?? 'installed') : null,
			note: deno ? null : 'yt-dlp needs it for YouTube’s challenges'
		}
	];
}

export async function systemInfo(): Promise<SystemInfo> {
	const [library, found] = await Promise.all([folderSize(CACHE_DIR), tools()]);
	return {
		cacheDir: CACHE_DIR,
		modelDir: MODEL_DIR,
		library,
		tools: found,
		runtime: { node: process.versions.node, onnxruntime: runtimeVersion(), analysis: ANALYSIS_VERSION, show: SHOW_VERSION }
	};
}

/** Opens one of the app's own folders in the file manager; nothing else can be named. */
export function reveal(which: 'cache' | 'models'): void {
	const dir = which === 'cache' ? CACHE_DIR : MODEL_DIR;
	const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
	execFile(opener, [dir], () => {});
}
