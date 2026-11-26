import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Show, TrackAnalysis, TrackContext } from '@mv/core';
import type { PackInput } from '@mv/roblox';

export interface CachedSong extends PackInput {
	label: string;
	artHue: number | null;
	context: TrackContext | null;
}

interface Meta {
	title?: string;
	uploader?: string;
	artHue?: number | null;
	gridTrust?: { trusted: boolean };
	gridTrustOverride?: true;
}

/** Every song in a cache folder with a current show, as the box would pack it; `tag` names the folder. */
export function cachedSongs(dir: string, tag: string): CachedSong[] {
	const out: CachedSong[] = [];
	for (const file of readdirSync(dir).filter((f) => f.endsWith('.analysis.json')).sort()) {
		const id = file.slice(0, -'.analysis.json'.length);
		const read = <T>(suffix: string): T | null => {
			const path = join(dir, `${id}.${suffix}`);
			return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null;
		};
		const analysis = read<TrackAnalysis>('analysis.json')!;
		const show = read<Show>('show.json');
		if (!show || show.analysisHash !== analysis.hash) continue;
		const meta = read<Meta>('meta.json') ?? {};
		out.push({
			label: `${tag}/${id}`,
			analysis,
			show,
			meta: {
				trackId: id,
				title: meta.title ?? analysis.title,
				artist: meta.uploader ?? '',
				// The web app's rule for a lounge-only row.
				gridTrusted: !(meta.gridTrust?.trusted === false && !meta.gridTrustOverride)
			},
			artHue: meta.artHue ?? null,
			context: read<TrackContext>('context.json')
		});
	}
	return out;
}

/** The cache folders named on the command line, or the desktop app's, each tagged by its position. */
export function cacheArgs(args: readonly string[], fallback: string): { dir: string; tag: string }[] {
	return (args.length > 0 ? args : [fallback]).map((dir, i) => ({ dir, tag: String(i + 1) }));
}
