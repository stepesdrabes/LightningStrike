import { readFile, stat } from 'node:fs/promises';
import { analysisPath, readLibrary } from '@mv/analysis';
import type { TrackAnalysis } from '@mv/core';
import { heatOf, type DriveSummary, type LibraryTrack } from '$lib/evening/library.ts';

interface Cached {
	mtimeMs: number;
	drive: DriveSummary | null;
}

const drives = new Map<string, Cached>();

/** Drive figures from one analysis, read once per analysis file version. */
async function driveOf(id: string): Promise<DriveSummary | null> {
	let path: string;
	let mtimeMs: number;
	try {
		path = analysisPath(id);
		mtimeMs = (await stat(path)).mtimeMs;
	} catch {
		return null;
	}
	const cached = drives.get(id);
	if (cached && cached.mtimeMs === mtimeMs) return cached.drive;
	let drive: DriveSummary | null = null;
	try {
		const a = JSON.parse(await readFile(path, 'utf8')) as TrackAnalysis;
		const loud = [...a.bars].sort((x, y) => y.energy - x.energy).slice(0, Math.max(1, Math.floor(a.bars.length / 2)));
		drive = {
			bpm: a.tempo.bpm,
			integratedLufs: a.integratedLufs,
			loudnessRange: a.loudnessRange,
			kicksPerLoudBar: loud.reduce((sum, b) => sum + b.kicks, 0) / loud.length
		};
	} catch {
		drive = null;
	}
	drives.set(id, { mtimeMs, drive });
	return drive;
}

/** Every library track as the planner sees it, from a library listing when the caller has one. */
export async function libraryTracks(listing?: Awaited<ReturnType<typeof readLibrary>>): Promise<LibraryTrack[]> {
	const entries = listing ?? (await readLibrary());
	return Promise.all(
		entries.map(async (e): Promise<LibraryTrack> => {
			const drive = e.analysed ? await driveOf(e.id) : null;
			return {
				id: e.id,
				title: e.title,
				artist: e.uploader.replace(/\s+-\s+Topic$/, ''),
				thumbnail: e.thumbnail,
				source: e.source || e.webpageUrl,
				duration: e.duration ?? 0,
				ready: e.analysed && e.current && e.authored !== 'none',
				genre: e.genreFamily,
				bpm: drive?.bpm ?? null,
				heat: heatOf(e.genreFamily, drive),
				loungeOnly: e.gridTrust?.trusted === false && !e.gridTrustOverride
			};
		})
	);
}
