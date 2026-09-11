// Stage an analysis variant through analyzeTrack's real gridCuts path for a listening
// comparison.
// MV_CACHE_DIR=<cache> node bench/gridedit.ts <trackId> <cutT1,cutT2,...>
// MV_CACHE_DIR=<cache> node bench/gridedit.ts <trackId> restore
// Preserve audio hash/ID, save the original as .analysis.json.orig, and invalidate the show.
// Uses DSP drums without ADTOF.
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { decodeAudio } from '@mv/analysis';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';

const id = process.argv[2];
const arg = process.argv[3];
if (!id || !arg) throw new Error('usage: node bench/gridedit.ts <trackId> <cutT1,cutT2,...|restore>');
const cache = benchmarkCache();
const blobPath = join(cache, `${id}.analysis.json`);
const origPath = `${blobPath}.orig`;
const showPath = join(cache, `${id}.show.json`);

if (arg === 'restore') {
	if (!existsSync(origPath)) throw new Error(`nothing to restore at ${origPath}`);
	renameSync(origPath, blobPath);
	rmSync(showPath, { force: true });
	console.log('restored original analysis; show will recompose on next play');
	process.exit(0);
}

const cuts = arg.split(',').map(Number);
if (cuts.some((c) => !Number.isFinite(c))) throw new Error('cut points must be seconds');
const beatsPath = join(import.meta.dirname, 'corpus/.beats', `judged-${id}.json`);
if (!existsSync(beatsPath)) throw new Error(`no cached beats at ${beatsPath} - run earlybars first`);
const tracked = JSON.parse(readFileSync(beatsPath, 'utf8')) as { beats: number[]; downbeats: number[] };

const orig = JSON.parse(readFileSync(blobPath, 'utf8')) as { hash: string; trackId: string };
const meta = JSON.parse(readFileSync(join(cache, `${id}.meta.json`), 'utf8')) as { title: string };
const files = readdirSync(cache);
const audioFile = files.find((x) => x.startsWith(`${id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
if (!audioFile) throw new Error(`no audio for ${id} in ${cache}`);
const context = existsSync(join(cache, `${id}.context.json`))
	? JSON.parse(readFileSync(join(cache, `${id}.context.json`), 'utf8'))
	: undefined;

const decoded = await decodeAudio(join(cache, audioFile));
const analysis = analyzeTrack({
	mono: decoded.mono,
	sampleRate: decoded.sampleRate,
	duration: decoded.duration,
	hash: orig.hash,
	trackId: orig.trackId,
	title: meta.title,
	context,
	beats: tracked.beats,
	downbeats: tracked.downbeats,
	gridCuts: cuts
});

if (!existsSync(origPath)) copyFileSync(blobPath, origPath);
writeFileSync(blobPath, JSON.stringify(analysis));
rmSync(showPath, { force: true });

console.log(`staged cut grid via the real path, meterConf ${analysis.tempo.meterConfidence}`);
console.log('sections:', analysis.sections.map((s) => `${s.kind}@${s.startBar}`).join(' '));
const bt = analysis.tempo.barTimes;
for (const t of cuts) {
	let b = 0;
	for (let i = 0; i < bt.length - 1; i++) if (Math.abs(bt[i] - t) < Math.abs(bt[b] - t)) b = i;
	console.log(`  cut ${t}s -> bar line ${b} at ${bt[b].toFixed(2)}s (span ${(bt[b] - bt[b - 1]).toFixed(2)}s before it)`);
}
