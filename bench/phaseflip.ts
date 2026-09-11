// Shift cached model downbeats and rerun analysis for a listening comparison.
// MV_CACHE_DIR=<cache> node bench/phaseflip.ts <trackId> <shiftBeats|restore>
// Keep hash/ID, save .analysis.json.orig for restore and invalidate the show. Uses DSP drums
// without ADTOF.
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { decodeAudio } from '@mv/analysis';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';

const id = process.argv[2];
const arg = process.argv[3];
if (!id || !arg) throw new Error('usage: node bench/phaseflip.ts <trackId> <shiftBeats|restore>');
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

const shift = Number(arg);
if (!Number.isInteger(shift) || shift === 0) throw new Error('shiftBeats must be a non-zero integer');
const beatsPath = join(import.meta.dirname, 'corpus/.beats', `judged-${id}.json`);
if (!existsSync(beatsPath)) throw new Error(`no cached beats at ${beatsPath} - run earlybars first`);
const tracked = JSON.parse(readFileSync(beatsPath, 'utf8')) as { beats: number[]; downbeats: number[] };

const orig = JSON.parse(readFileSync(blobPath, 'utf8')) as {
	hash: string;
	trackId: string;
	tempo: { downbeatPhase: number };
};
const meta = JSON.parse(readFileSync(join(cache, `${id}.meta.json`), 'utf8')) as { title: string };
const files = readdirSync(cache);
const audioFile = files.find((x) => x.startsWith(`${id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
if (!audioFile) throw new Error(`no audio for ${id} in ${cache}`);
const context = existsSync(join(cache, `${id}.context.json`))
	? JSON.parse(readFileSync(join(cache, `${id}.context.json`), 'utf8'))
	: undefined;

// Move each downbeat K beats along the beat stream; meterFromDownbeats then votes the
// shifted phase with the same spacing, so beatsPerBar is untouched.
const beats = tracked.beats;
const indexOf = (t: number): number => {
	let best = 0;
	for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - t) < Math.abs(beats[best] - t)) best = i;
	return best;
};
const downbeats = tracked.downbeats
	.map((t) => indexOf(t) + shift)
	.filter((i) => i >= 0 && i < beats.length)
	.map((i) => beats[i]);

const decoded = await decodeAudio(join(cache, audioFile));
const analysis = analyzeTrack({
	mono: decoded.mono,
	sampleRate: decoded.sampleRate,
	duration: decoded.duration,
	hash: orig.hash,
	trackId: orig.trackId,
	title: meta.title,
	context,
	beats,
	downbeats
});

if (!existsSync(origPath)) copyFileSync(blobPath, origPath);
writeFileSync(blobPath, JSON.stringify(analysis));
rmSync(showPath, { force: true });

console.log(`staged shift=${shift}: downbeatPhase ${orig.tempo.downbeatPhase} -> ${analysis.tempo.downbeatPhase}`);
console.log('sections:', analysis.sections.map((s) => `${s.kind}@${s.startBar}`).join(' '));
const bt = analysis.tempo.barTimes;
const near = bt.map((t, b) => ({ t, b })).filter(({ t }) => t > 64 && t < 70);
for (const { t, b } of near) console.log(`  bar ${b} starts ${t.toFixed(2)}s`);
