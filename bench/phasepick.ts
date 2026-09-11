// Histogram the strongest onset's beat within each bar, weighted by strength, globally and at
// section starts.
// Beat-0 mass supports the current phase; beat-2 mass suggests a half-bar offset.
// MV_CACHE_DIR=<cache> node bench/phasepick.ts <trackId>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';

const id = process.argv[2];
if (!id) throw new Error('usage: node bench/phasepick.ts <trackId>');
const cache = benchmarkCache();

const files = readdirSync(cache);
const audioFile = files.find((x) => x.startsWith(`${id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
if (!audioFile) throw new Error(`no audio for ${id} in ${cache}`);
const blob = JSON.parse(readFileSync(join(cache, `${id}.analysis.json`), 'utf8')) as {
	tempo: { beatsPerBar: number; downbeatPhase: number; barTimes: number[]; meterConfidence: number };
	sections: { kind: string; startBar: number }[];
};
const { beatsPerBar, barTimes } = blob.tempo;

const decoded = await decodeAudio(join(cache, audioFile));
const loudness = measureLoudness(decoded.mono, decoded.sampleRate);
const mono = Float32Array.from(decoded.mono);
const gain = Math.pow(10, (-14 - loudness.integrated) / 20);
if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
	const g = Math.min(gain, 40);
	for (let i = 0; i < mono.length; i++) mono[i] *= g;
}
const features = extractFeatures(mono, decoded.sampleRate);
const odf = features.odf;
const fps = features.curves.fps;

/** Strongest odf value in [t0, t1), and the time it peaks at. */
function peakIn(t0: number, t1: number): { t: number; v: number } {
	let best = 0;
	let at = t0;
	for (let f = Math.max(0, Math.floor(t0 * fps)); f < Math.min(odf.length, Math.ceil(t1 * fps)); f++) {
		if (odf[f] > best) {
			best = odf[f];
			at = f / fps;
		}
	}
	return { t: at, v: best };
}

/** Beat index of time t within its bar (0..beatsPerBar-1, fractional). */
function beatPhaseOf(t: number, bar: number): number {
	const len = (barTimes[bar + 1] - barTimes[bar]) / beatsPerBar;
	return (t - barTimes[bar]) / len;
}

const mass = new Float64Array(beatsPerBar);
const barCount = barTimes.length - 1;
for (let b = 0; b < barCount; b++) {
	const { t, v } = peakIn(barTimes[b], barTimes[b + 1]);
	const phase = Math.round(beatPhaseOf(t, b)) % beatsPerBar;
	mass[phase] += v;
}
console.log(`${id}  meterConf ${blob.tempo.meterConfidence}  beatsPerBar ${beatsPerBar}`);
const total = mass.reduce((a, v) => a + v, 0) || 1;
console.log(
	'strongest-onset beat, mass share per beat:',
	[...mass].map((v, k) => `beat${k} ${(100 * v / total).toFixed(0)}%`).join('  ')
);

console.log('\nsection starts, strongest onset within [start-0.5 beat, +1.5 bars):');
for (const s of blob.sections) {
	const b = s.startBar;
	if (b <= 0 || b >= barCount - 1) continue;
	const beatLen = (barTimes[b + 1] - barTimes[b]) / beatsPerBar;
	const { t, v } = peakIn(barTimes[b] - beatLen / 2, barTimes[b] + 1.5 * (barTimes[b + 1] - barTimes[b]));
	const off = (t - barTimes[b]) / beatLen;
	console.log(
		`  ${s.kind}@${b}  bar line ${barTimes[b].toFixed(2)}s  strongest onset +${off.toFixed(2)} beats (${t.toFixed(2)}s, strength ${v.toFixed(2)})`
	);
}
