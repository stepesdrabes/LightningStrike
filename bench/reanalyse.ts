import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ANALYSIS_VERSION, gridTrust } from '@mv/core';
import {
	CACHE_DIR,
	decodeAudio,
	readContext,
	analysisPath,
	contextPath,
	handMapInput,
	publishedLevel,
	refineGenreFromAudio
} from '@mv/analysis';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';
import { Adtof } from '../packages/analysis/src/adtof.ts';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';

/**
 * Reanalyze cached tracks without re-keying them through ingest; reuse the model across the
 * corpus.
 */
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
/** Skip current-version tracks so interrupted regeneration resumes. */
const skipCurrent = process.argv.includes('--skip-current');
/**
 * Ignore hand maps during evaluation; adopting ground truth would measure copying, not
 * analysis.
 */
const noHandMaps = process.argv.includes('--no-hand-maps');

const metas = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.meta.json'));
const model = await BeatThis.create();
const drumModel = await Adtof.create();
let done = 0;

for (const f of metas) {
	const meta = JSON.parse(await readFile(join(CACHE_DIR, f), 'utf8')) as {
		id: string;
		title: string;
	};
	if (only && meta.id !== only) continue;
	if (skipCurrent) {
		try {
			const existing = JSON.parse(await readFile(analysisPath(meta.id), 'utf8')) as {
				version: number;
			};
			if (existing.version === ANALYSIS_VERSION) continue;
		} catch {
			// Nothing there yet; analyse it.
		}
	}
	const files = await readdir(CACHE_DIR);
	const audio = files.find((x) => x.startsWith(`${meta.id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
	if (!audio) continue;

	const at = `[${++done}]`;
	try {
		const decoded = await decodeAudio(join(CACHE_DIR, audio));
		const tracked = await model.run(decoded.mono);
		const drums = drumModel
			? await drumModel.run((await decodeAudio(join(CACHE_DIR, audio), 44100)).mono)
			: undefined;
		let context = (await readContext(meta.id)) ?? undefined;
		if (context && !context.sources.includes('effnet')) {
			const refined = await refineGenreFromAudio(context, decoded.mono, decoded.sampleRate);
			if (refined !== null) {
				context = refined === context ? { ...context, sources: [...context.sources, 'effnet'] } : refined;
				await writeFile(contextPath(meta.id), JSON.stringify(context, null, '\t'));
			}
		}

		let metricalLevel: number | undefined;
		if (context?.publishedBpm) {
			const level = publishedLevel(tracked.beats, context.publishedBpm, context.genreFamily, {
				downbeats: tracked.downbeats,
				snares: drums?.snare.times
			});
			if (level !== null) metricalLevel = level;
		}

		const analysis = analyzeTrack({
			mono: decoded.mono,
			left: decoded.left,
			right: decoded.right,
			sampleRate: decoded.sampleRate,
			duration: decoded.duration,
			hash: decoded.hash,
			trackId: meta.id,
			title: meta.title,
			beats: tracked.beats,
			downbeats: tracked.downbeats,
			drums,
			metricalLevel,
			context,
			...(noHandMaps ? {} : await handMapInput(meta.id))
		});
		await writeFile(analysisPath(meta.id), JSON.stringify(analysis, null, '\t'));
		// The verdict the queue routes on lives on the meta, and ingest only refreshes it on
		// the fresh path: a cache built here would keep a stale lounge verdict forever (HUMBLE.
		// stayed unjudgeable that way). The owner's override survives, as in ingest.
		const metaFile = JSON.parse(await readFile(join(CACHE_DIR, f), 'utf8')) as Record<string, unknown>;
		metaFile.duration = metaFile.duration || analysis.duration;
		metaFile.gridTrust = gridTrust(analysis, context?.publishedBpm);
		await writeFile(join(CACHE_DIR, f), JSON.stringify(metaFile, null, '\t'));
		console.log(
			`${at} ${meta.title.slice(0, 50)} -> ${analysis.tempo.bpm} bpm` +
				`${metricalLevel ? ` (x${metricalLevel})` : ''}, ${analysis.sections.length} sections, ` +
				analysis.sections.map((s) => `${s.kind}@${s.startBar}`).join(' ')
		);
	} catch (e) {
		console.log(`${at} ${meta.title}: ${(e as Error).message.split('\n')[0]}`);
	}
}
await model.close();
await drumModel?.close();
console.log('reanalyse complete');
