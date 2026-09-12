// MV_CACHE_DIR=<library> node bench/lab/library-reanalyse.ts --out=DIR [--ids=ID,ID] [--activations=DIR]
// Re-analyse every library track with the working-tree analyser from its cached model beats and
// cached ADTOF activations, compose its show, and write both into a scratch cache next to copies
// of context and meta so the review harnesses can read it. Nothing in the library is written.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gridTrust, type TrackAnalysis, type TrackContext } from '@mv/core';
import { CACHE_DIR, decodeAudio, handMapInput, publishedLevel } from '@mv/analysis';
import { onsetsFromActivations } from '../../packages/analysis/src/adtof.ts';
import { analyzeTrack } from '../../packages/analysis/src/analyze.ts';
import { composeShow } from '../../packages/author-engine/src/plan.ts';
import { readF32 } from './mdb.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = resolve(flag('out') ?? 'bench/reports/audio-reliability/library-v33');
const activationsDir = resolve(flag('activations') ?? 'bench/reports/audio-reliability/library-activations');
const only = flag('ids')?.split(',').filter(Boolean) ?? [];
if (out === CACHE_DIR || out.startsWith(CACHE_DIR)) throw new Error('Output must be outside the library.');
mkdirSync(out, { recursive: true });

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const files = readdirSync(CACHE_DIR);
const ids = files.filter((f) => f.endsWith('.analysis.json')).map((f) => f.slice(0, -14))
	.filter((id) => only.length === 0 || only.includes(id));
const sectionsOf = (a: TrackAnalysis) => a.sections.map((s) => `${s.kind}@${s.startBar}`);
const rows: Record<string, unknown>[] = [];

for (const id of ids) {
	const at = performance.now();
	const cached = read<TrackAnalysis>(join(CACHE_DIR, `${id}.analysis.json`));
	const contextPath = join(CACHE_DIR, `${id}.context.json`);
	const context = existsSync(contextPath) ? read<TrackContext>(contextPath) : undefined;
	const meta = read<{ artHue?: number | null; title?: string }>(join(CACHE_DIR, `${id}.meta.json`));
	const audio = files.find((f) => f.startsWith(`${id}.`) && /\.(m4a|mp3|wav|flac|ogg|opus|webm|aac|mp4|mka)$/i.test(f));
	const activationPath = join(activationsDir, `${id}.f32`);
	if (!audio || !existsSync(activationPath)) {
		rows.push({ id, title: cached.title, skipped: !audio ? 'no audio' : 'no activations' });
		continue;
	}
	const decoded = await decodeAudio(join(CACHE_DIR, audio));
	const drums = onsetsFromActivations(readF32(activationPath));
	const heard = cached.heard ?? { beats: cached.beats, downbeats: cached.downbeats ?? [] };
	const metricalLevel = context?.publishedBpm
		? publishedLevel(heard.beats, context.publishedBpm, context.genreFamily, {
				downbeats: heard.downbeats, snares: drums.snare.times
			}) ?? undefined
		: undefined;
	const analysis = analyzeTrack({
		...decoded, trackId: id, title: cached.title, context, beats: heard.beats,
		downbeats: heard.downbeats, drums, metricalLevel, ...(await handMapInput(id))
	});
	const show = composeShow(analysis, { context, artHue: meta.artHue });
	writeFileSync(join(out, `${id}.analysis.json`), JSON.stringify(analysis));
	writeFileSync(join(out, `${id}.show.json`), JSON.stringify(show));
	for (const suffix of ['.context.json', '.meta.json']) {
		const src = join(CACHE_DIR, id + suffix);
		if (existsSync(src)) copyFileSync(src, join(out, id + suffix));
	}
	const counts = (a: TrackAnalysis) => ({
		kick: a.onsets.kick.times.length, snare: a.onsets.snare.times.length, hat: a.onsets.hat.times.length
	});
	rows.push({
		id, title: cached.title, genre: context?.genreFamily ?? null, duration: cached.duration,
		cachedVersion: cached.version, hashMatch: cached.hash === decoded.hash,
		beatsUnchanged: JSON.stringify(cached.beats) === JSON.stringify(analysis.beats),
		barTimesUnchanged: JSON.stringify(cached.tempo.barTimes) === JSON.stringify(analysis.tempo.barTimes),
		sectionsBefore: sectionsOf(cached), sectionsAfter: sectionsOf(analysis),
		sectionsUnchanged: JSON.stringify(sectionsOf(cached)) === JSON.stringify(sectionsOf(analysis)),
		onsetsBefore: counts(cached), onsetsAfter: counts(analysis),
		trustBefore: gridTrust(cached, context?.publishedBpm), trustAfter: gridTrust(analysis, context?.publishedBpm),
		cues: show.cues.length, ms: Math.round(performance.now() - at)
	});
	const r = rows[rows.length - 1] as { onsetsBefore: Record<string, number>; onsetsAfter: Record<string, number> };
	console.log(`${cached.title.slice(0, 32).padEnd(32)} sections ${rows[rows.length - 1].sectionsUnchanged ? 'same' : 'CHANGED'}`
		+ ` k ${r.onsetsBefore.kick}->${r.onsetsAfter.kick} s ${r.onsetsBefore.snare}->${r.onsetsAfter.snare}`
		+ ` h ${r.onsetsBefore.hat}->${r.onsetsAfter.hat} ${((performance.now() - at) / 1000).toFixed(1)}s`);
	writeFileSync(join(out, 'summary.json'), JSON.stringify({ created: new Date().toISOString(), out, rows }, null, 2));
}
