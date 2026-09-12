// MV_CACHE_DIR=<library> node bench/lab/library-before.ts --out=DIR --ids=ID,ID [--before=DIR]
// The frozen analyser on the same cached beats and activations, with the model streams built
// the way it expects them, so a section or onset difference against library-reanalyse output
// is tonight's change alone and not an older cached analysis version.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TrackAnalysis, TrackContext } from '@mv/core';
import { CACHE_DIR, decodeAudio, handMapInput, publishedLevel } from '@mv/analysis';
import type { analyzeTrack as AnalyzeTrack } from '../../packages/analysis/src/analyze.ts';
import type { activationStream as ActivationStream } from '../../packages/analysis/src/adtof.ts';
import { CHANNEL, THRESHOLDS, classCurve, readF32 } from './mdb.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = resolve(flag('out') ?? 'bench/reports/audio-reliability/library-v33');
const beforeRoot = resolve(flag('before') ?? 'bench/reports/audio-reliability/baseline-source/packages/analysis/src');
const activationsDir = resolve(flag('activations') ?? 'bench/reports/audio-reliability/library-activations');
const only = flag('ids')?.split(',').filter(Boolean) ?? [];
const frozen = await import(pathToFileURL(join(beforeRoot, 'analyze.ts')).href) as { analyzeTrack: typeof AnalyzeTrack };
const frozenAdtof = await import(pathToFileURL(join(beforeRoot, 'adtof.ts')).href) as { activationStream: typeof ActivationStream };

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const files = readdirSync(CACHE_DIR);
const ids = files.filter((f) => f.endsWith('.analysis.json')).map((f) => f.slice(0, -14))
	.filter((id) => only.length === 0 || only.includes(id));
const sectionsOf = (a: TrackAnalysis) => a.sections.map((s) => `${s.kind}@${s.startBar}`);

for (const id of ids) {
	const cached = read<TrackAnalysis>(join(CACHE_DIR, `${id}.analysis.json`));
	const contextPath = join(CACHE_DIR, `${id}.context.json`);
	const context = existsSync(contextPath) ? read<TrackContext>(contextPath) : undefined;
	const audio = files.find((f) => f.startsWith(`${id}.`) && /\.(m4a|mp3|wav|flac|ogg|opus|webm|aac|mp4|mka)$/i.test(f));
	if (!audio) continue;
	const decoded = await decodeAudio(join(CACHE_DIR, audio));
	const act = readF32(join(activationsDir, `${id}.f32`));
	const drums = {
		kick: frozenAdtof.activationStream(classCurve(act, CHANNEL.kick), THRESHOLDS[CHANNEL.kick]),
		snare: frozenAdtof.activationStream(classCurve(act, CHANNEL.snare), THRESHOLDS[CHANNEL.snare]),
		hat: frozenAdtof.activationStream(classCurve(act, CHANNEL.hat), THRESHOLDS[CHANNEL.hat])
	};
	const heard = cached.heard ?? { beats: cached.beats, downbeats: cached.downbeats ?? [] };
	const metricalLevel = context?.publishedBpm
		? publishedLevel(heard.beats, context.publishedBpm, context.genreFamily, {
				downbeats: heard.downbeats, snares: drums.snare.times
			}) ?? undefined
		: undefined;
	const before = frozen.analyzeTrack({
		...decoded, trackId: id, title: cached.title, context, beats: heard.beats,
		downbeats: heard.downbeats, drums, metricalLevel, ...(await handMapInput(id))
	});
	writeFileSync(join(out, `${id}.before.analysis.json`), JSON.stringify(before));
	const afterPath = join(out, `${id}.analysis.json`);
	const after = existsSync(afterPath) ? read<TrackAnalysis>(afterPath) : null;
	const same = after ? JSON.stringify(sectionsOf(before)) === JSON.stringify(sectionsOf(after)) : null;
	console.log(`${cached.title.slice(0, 30).padEnd(30)} cached v${cached.version} sections: frozen-vs-worktree ${same === null ? '?' : same ? 'same' : 'CHANGED'}`
		+ ` | cached-vs-frozen ${JSON.stringify(sectionsOf(cached)) === JSON.stringify(sectionsOf(before)) ? 'same' : 'differs'}`);
	if (same === false && after) {
		console.log('   frozen  ', sectionsOf(before).slice(0, 12).join(' '));
		console.log('   worktree', sectionsOf(after).slice(0, 12).join(' '));
	}
}
