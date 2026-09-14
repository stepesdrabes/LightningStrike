// node bench/lab/review-separated.ts --dir=DIR --id=TRACK --offset=32
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Adtof } from '../../packages/analysis/src/adtof.ts';
import { analyzeTrack } from '../../packages/analysis/src/analyze.ts';
import { decodeAudio, resamplePcm } from '../../packages/analysis/src/decode.ts';
import { benchmarkCache } from '../cache.ts';
import { readF32 } from './mdb.ts';

const option = (key: string) => process.argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const dir = resolve(option('dir')!);
const id = option('id')!;
const offset = Number(option('offset') ?? 0);
const cache = benchmarkCache();
const baseline = JSON.parse(readFileSync(join(cache, `${id}.analysis.json`), 'utf8'));
const rawKick = readF32(join(dir, 'kick.f32'));
const rawSnare = readF32(join(dir, 'snare.f32'));
const length = rawKick.length;
const audio = await decodeAudio(join(cache, `${id}.m4a`), 44100);
const start = Math.round(offset * 44100);
const mix = audio.mono.slice(start, start + length);
const model = await Adtof.create();
const drums = model ? await model.run(mix) : undefined;
await model?.close();
const mono = await resamplePcm(mix, 44100);
const kick = await resamplePcm(rawKick, 44100);
const snare = await resamplePcm(rawSnare, 44100);
const hat = existsSync(join(dir, 'hat.f32')) ? await resamplePcm(readF32(join(dir, 'hat.f32')), 44100) : undefined;
const cymbal = existsSync(join(dir, 'cymbal.f32')) ? await resamplePcm(readF32(join(dir, 'cymbal.f32')), 44100) : undefined;
const duration = mono.length / 22050;
const beats = baseline.beats.filter((time: number) => time >= offset && time < offset + duration).map((time: number) => time - offset);
const analysis = analyzeTrack({ mono, sampleRate: 22050, duration, hash: audio.hash, trackId: id,
	title: baseline.title, beats, drums, separatedDrums: { kick, snare, hat, cymbal, sampleRate: 22050 } });
for (const kind of ['kick', 'snare', 'hat'] as const) analysis.onsets[kind].times = analysis.onsets[kind].times.map((time) => time + offset);
writeFileSync(join(dir, 'review-analysis.json'), JSON.stringify(analysis, null, 2));
console.log(JSON.stringify({ id, offset, duration, snare: analysis.onsets.snare }, null, 2));
