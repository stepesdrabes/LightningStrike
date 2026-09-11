import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONTEXT_VERSION, type TrackContext } from '@mv/core';
import { CACHE_DIR, enrichTrack, publishedLevel, readContext, contextPath } from '@mv/analysis';

/** Report cached-track enrichment coverage: identity, genre, published tempo and synced lyrics. */
const force = process.argv.includes('--force');

const files = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.meta.json'));
const rows: string[] = [];
let resolved = 0;
let genred = 0;
let bpmd = 0;
let lyriced = 0;
let corrections = 0;

for (const f of files) {
	const meta = JSON.parse(await readFile(join(CACHE_DIR, f), 'utf8')) as {
		id: string;
		title: string;
		uploader: string;
		duration?: number;
		webpageUrl?: string;
	};
	let context: TrackContext | null = force ? null : await readContext(meta.id);
	if (!context || context.version !== CONTEXT_VERSION || context.sources.length === 0) {
		context = await enrichTrack({
			title: meta.title,
			uploader: meta.uploader,
			duration: meta.duration ?? 0,
			webpageUrl: meta.webpageUrl || undefined
		});
		await writeFile(contextPath(meta.id), JSON.stringify(context, null, '\t'));
	}

	let detectedBpm = 0;
	let level: number | null = null;
	try {
		const analysis = JSON.parse(
			await readFile(join(CACHE_DIR, `${meta.id}.analysis.json`), 'utf8')
		) as { tempo: { bpm: number }; beats: number[] };
		detectedBpm = analysis.tempo.bpm;
		if (context.publishedBpm) level = publishedLevel(analysis.beats, context.publishedBpm);
	} catch {
		// No analysis yet; enrichment coverage still counts.
	}

	if (context.artist) resolved++;
	if (context.genreFamily) genred++;
	if (context.publishedBpm) bpmd++;
	if (context.lyrics) lyriced++;
	if (level !== null) corrections++;

	rows.push(
		[
			(context.artist ?? '?').slice(0, 22).padEnd(22),
			(context.title ?? meta.title).slice(0, 26).padEnd(26),
			(context.genreFamily ?? '-').padEnd(8),
			String(context.publishedBpm ?? '-').padStart(7),
			String(Math.round(detectedBpm) || '-').padStart(5),
			level !== null ? `x${level.toFixed(2)}` : '     ',
			context.lyrics ? `${context.lyrics.length} lines` : context.instrumental ? 'instrumental' : '-',
			context.sources.join(',')
		].join('  ')
	);
}

console.log('artist                  title                       genre      pubBpm    det  level  lyrics');
for (const r of rows.sort()) console.log(r);
console.log('');
console.log(
	`${files.length} tracks: identity ${resolved}, genre ${genred}, published bpm ${bpmd}, ` +
		`synced lyrics ${lyriced}, metrical corrections ${corrections}`
);
