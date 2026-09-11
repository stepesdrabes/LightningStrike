import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GenreFamily } from '@mv/core';
import { ANALYSIS_VERSION, SHOW_VERSION } from '@mv/core';
import { CACHE_DIR } from './paths.ts';
import type { TrackMeta } from './ingest.ts';

/** Read version/duration from the analysis head; parsing every large blob would slow the library. */
async function headOfAnalysis(
	path: string
): Promise<{ duration: number | null; version: number | null }> {
	let handle;
	try {
		handle = await open(path, 'r');
		const buffer = Buffer.alloc(2048);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const head = buffer.subarray(0, bytesRead).toString('utf8');
		const num = (key: string) => {
			const match = new RegExp(`"${key}"\\s*:\\s*([0-9.]+)`).exec(head);
			const value = match ? Number(match[1]) : Number.NaN;
			return Number.isFinite(value) && value > 0 ? value : null;
		};
		return { duration: num('duration'), version: num('version') };
	} catch {
		return { duration: null, version: null };
	} finally {
		await handle?.close();
	}
}

export interface LibraryEntry extends TrackMeta {
	/** An analysis exists, so this track loads without touching the network. */
	analysed: boolean;
	/**
	 * Analysis and engine-show versions must match. Preserve model-authored shows across versions
	 * because they are paid artifacts.
	 */
	current: boolean;
	authored: 'none' | 'engine' | 'claude' | 'deepseek';
	/** The lighting family, once something has listened to the track. Null until enriched. */
	genreFamily: GenreFamily | null;
	/** When the track was last ingested or authored, for ordering by recency. */
	updatedAt: number;
}

/** Genre comes from the small context blob, not the large analysis, which does not store it. */
async function readGenre(path: string): Promise<GenreFamily | null> {
	try {
		const raw = await readFile(path, 'utf8');
		return (JSON.parse(raw) as { genreFamily?: GenreFamily | null }).genreFamily ?? null;
	} catch {
		return null;
	}
}

interface ShowStamp {
	authored: 'engine' | 'claude' | 'deepseek';
	version: number;
	updatedAt: number;
}

/**
 * Legacy shows with custom effects are AI-authored. Their backend is Claude because they
 * predate DeepSeek support.
 */
async function readShowStamp(path: string): Promise<ShowStamp | null> {
	try {
		const [raw, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
		const show = JSON.parse(raw) as {
			authoredBy?: 'engine' | 'claude' | 'deepseek';
			generatedEffects?: unknown[];
			version?: number;
		};
		const authored =
			show.authoredBy ?? ((show.generatedEffects?.length ?? 0) > 0 ? 'claude' : 'engine');
		return { authored, version: show.version ?? 0, updatedAt: info.mtimeMs };
	} catch {
		return null;
	}
}

/** Library entries, newest first; use metadata duration without loading analysis bodies. */
export async function readLibrary(): Promise<LibraryEntry[]> {
	if (!existsSync(CACHE_DIR)) return [];
	const files = await readdir(CACHE_DIR);
	const ids = files.filter((f) => f.endsWith('.meta.json')).map((f) => f.slice(0, -'.meta.json'.length));

	const entries = await Promise.all(
		ids.map(async (id): Promise<LibraryEntry | null> => {
			let meta: TrackMeta;
			let metaStat: Awaited<ReturnType<typeof stat>>;
			try {
				const path = join(CACHE_DIR, `${id}.meta.json`);
				const [raw, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
				meta = JSON.parse(raw) as TrackMeta;
				metaStat = info;
			} catch {
				return null;
			}

			const analysisFile = join(CACHE_DIR, `${id}.analysis.json`);
			const analysed = existsSync(analysisFile);
			const head = analysed
				? await headOfAnalysis(analysisFile)
				: { duration: null, version: null };

			// Persist repaired metadata once rather than recover it on every listing.
			if (!meta.duration && head.duration !== null) {
				meta = { ...meta, duration: head.duration };
				await writeFile(
					join(CACHE_DIR, `${id}.meta.json`),
					JSON.stringify(meta, null, '\t')
				).catch(() => {
					// A read-only cache still lists correctly; it just repairs itself each time.
				});
			}

			const [show, genreFamily] = await Promise.all([
				readShowStamp(join(CACHE_DIR, `${id}.show.json`)),
				readGenre(join(CACHE_DIR, `${id}.context.json`))
			]);
			return {
				...meta,
				analysed,
				current:
					head.version === ANALYSIS_VERSION &&
					show !== null &&
					(show.version === SHOW_VERSION || show.authored !== 'engine'),
				authored: show?.authored ?? 'none',
				genreFamily,
				updatedAt: Math.max(metaStat.mtimeMs, show?.updatedAt ?? 0)
			};
		})
	);

	return entries
		.filter((e): e is LibraryEntry => e !== null)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}
