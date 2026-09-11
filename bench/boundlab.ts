import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, decodeAudio } from '@mv/analysis';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { beatSynchronous } from '../packages/analysis/src/beatsync.ts';
import { chromagram } from '../packages/analysis/src/chroma.ts';
import { detectDrums } from '../packages/analysis/src/drums.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import {
	barSynchronous,
	DEFAULT_TUNING,
	refineBoundaries,
	segmentBars,
	similarityMatrix,
	type BoundaryMove
} from '../packages/analysis/src/structure.ts';
import { arrivalStrengths } from '../packages/analysis/src/structure.ts';

/** Print section boundaries beside per-bar arrival evidence to expose one-bar offsets. */
const id = process.argv[2];
if (!id) throw new Error('usage: node bench/boundlab.ts <trackId> [fromBar] [toBar]');
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? 40);

const files = await readdir(CACHE_DIR);
const audio = files.find((x) => x.startsWith(`${id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
if (!audio) throw new Error(`no audio for ${id}`);

const decoded = await decodeAudio(join(CACHE_DIR, audio));
const loudness = measureLoudness(decoded.mono, decoded.sampleRate);
const mono = Float32Array.from(decoded.mono);
const gain = Math.pow(10, (-14 - loudness.integrated) / 20);
if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
	const g = Math.min(gain, 40);
	for (let i = 0; i < mono.length; i++) mono[i] *= g;
}

const model = await BeatThis.create();
const tracked = await model.run(mono);
await model.close();

const features = extractFeatures(mono, decoded.sampleRate);
const chroma = chromagram(mono, decoded.sampleRate);

// Meter from the analysis blob, so this lab agrees with what shipped.
const analysis = JSON.parse(await readFile(join(CACHE_DIR, `${id}.analysis.json`), 'utf8')) as {
	tempo: { beatsPerBar: number; downbeatPhase: number };
};
const beats = Float64Array.from(tracked.beats);
const bf = beatSynchronous(features.spec, chroma, features.curves, features.odf, beats, decoded.duration);
const bars = barSynchronous(bf, analysis.tempo.beatsPerBar, analysis.tempo.downbeatPhase);

const detected = detectDrums(features.spec, {
	beatPeriod: (beats[beats.length - 1] - beats[0]) / (beats.length - 1),
	odf: features.odf
});
const rawKicks = new Int32Array(bars.count);
{
	let i = 0;
	for (let b = 0; b < bars.count; b++) {
		while (i < detected.kick.times.length && detected.kick.times[i] < bars.time[b]) i++;
		let n = 0;
		while (i + n < detected.kick.times.length && detected.kick.times[i + n] < bars.time[b + 1]) n++;
		rawKicks[b] = n;
	}
}

const sim = similarityMatrix(bars);
const rough = segmentBars(sim, bars);
const moves: BoundaryMove[] = [];
// Match the shipped analyzer's floor. This corpus has no contexts, so lyric evidence is
// absent.
const refined = refineBoundaries(rough, bars, rawKicks, moves, DEFAULT_TUNING.refineFloor);

console.log('rough bounds:  ', rough.join(' '));
console.log('refined bounds:', refined.join(' '));
console.log('moves:', moves.map((m) => `${m.from}->${m.to}`).join(' ') || '(none)');
console.log('');
console.log('bar  arrival   rms    floor  kicks');
const arrivals = arrivalStrengths(bars, rawKicks);
for (let b = Math.max(1, from); b < Math.min(bars.count, to); b++) {
	const mark = refined.includes(b) ? ' <== boundary' : rough.includes(b) ? ' (rough)' : '';
	console.log(
		String(b).padStart(3),
		arrivals[b].toFixed(2).padStart(8),
		bars.rms[b].toFixed(4).padStart(7),
		bars.floor[b].toFixed(4).padStart(7),
		String(rawKicks[b]).padStart(4),
		mark
	);
}
