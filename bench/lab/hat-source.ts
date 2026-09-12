// MV_CACHE_DIR=<library> node bench/lab/hat-source.ts [--ids=ID,ID]
// Per library track: DSP hats per beat, model hats per beat, the share of DSP hats the model
// hat class half-hears, and which stream the analyser's deafness rule would ship.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TrackAnalysis, TrackContext } from '@mv/core';
import { CACHE_DIR, decodeAudio } from '@mv/analysis';
import { onsetsFromActivations } from '../../packages/analysis/src/adtof.ts';
import { detectDrums, mergeStreams, modelDeafToHats } from '../../packages/analysis/src/drums.ts';
import { extractFeatures } from '../../packages/analysis/src/features.ts';
import { normalised, readF32 } from './mdb.ts';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--ids='))?.slice(6).split(',').filter(Boolean) ?? [];
const files = readdirSync(CACHE_DIR);
const ids = files.filter((f) => f.endsWith('.analysis.json')).map((f) => f.slice(0, -14))
	.filter((id) => only.length === 0 || only.includes(id));
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
console.log('title                          genre    dsp/b model/b heard  ship');
for (const id of ids) {
	const a = read<TrackAnalysis>(join(CACHE_DIR, `${id}.analysis.json`));
	const ctxPath = join(CACHE_DIR, `${id}.context.json`);
	const genre = (files.includes(`${id}.context.json`) ? read<TrackContext>(ctxPath).genreFamily : null) ?? '-';
	const audio = files.find((f) => f.startsWith(`${id}.`) && /\.(m4a|mp3|wav|flac|ogg|opus|webm)$/i.test(f));
	const actPath = join('bench/reports/audio-reliability/library-activations', `${id}.f32`);
	if (!audio) continue;
	const decoded = await decodeAudio(join(CACHE_DIR, audio));
	const f = extractFeatures(normalised(decoded.mono, decoded.sampleRate), decoded.sampleRate);
	const dsp = detectDrums(f.spec, { beatPeriod: a.tempo.beatPeriod, odf: f.odf });
	const model = onsetsFromActivations(readF32(actPath));
	const beats = Math.max(1, a.beats.length);
	const verdict = modelDeafToHats(mergeStreams(model.hat, model.cymbal, 0.03), dsp.hat, beats);
	console.log(`${a.title.slice(0, 30).padEnd(30)} ${String(genre).padEnd(8)} ${(dsp.hat.times.length / beats).toFixed(2).padStart(5)} ${(mergeStreams(model.hat, model.cymbal, 0.03).times.length / beats).toFixed(2).padStart(7)} ${(100 * verdict.heard).toFixed(0).padStart(4)}%  ${verdict.deaf ? 'DSP' : 'model'}`);
}
