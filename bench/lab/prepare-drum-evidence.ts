// Source-only preparation in an isolated cache; no detector or user-analysis writes.
import { copyFile, mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { decodeAudio, resamplePcm } from '../../packages/analysis/src/decode.ts';
import { DrumSeparator, SEPARATION_VERSION } from '../../packages/analysis/src/separation.ts';
import { NO_TRANSCRIBER, readDrumEvidence, writeDrumEvidence } from '../../packages/analysis/src/drumEvidenceCache.ts';
import { hashFile } from '../../packages/analysis/src/cpuGraphCache.ts';
import { benchmarkCache } from '../cache.ts';

const option = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const sourceCache = resolve(benchmarkCache(option('cache')));
const root = resolve(option('out') ?? 'bench/reports/audio-reliability/judgement-correction');
if (root === sourceCache || root.startsWith(sourceCache + '/') || root.startsWith(sourceCache + '\\')) {
 throw new Error('Output must be outside the source cache.');
}
const ids = (option('ids') ?? option('id') ?? '').split(',').filter(Boolean);
if (!ids.length || ids.some(id => !/^[\w-]{11}$/.test(id))) throw new Error('Pass --id=ID or --ids=ID,ID.');
if (ids.length > 1) {
 for (const id of ids) await new Promise<void>((accept, reject) => {
  const child = spawn(process.execPath, [import.meta.filename, `--id=${id}`, `--cache=${sourceCache}`, `--out=${root}`],
   { stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? accept() : reject(new Error(`${id} preparation exited ${code}`)));
 });
 process.exit(0);
}
const id = ids[0], cache = join(root, 'cache'), output = join(root, 'sources', id);
await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true });
const files = (await readdir(sourceCache)).filter(name => name.startsWith(id + '.') &&
 /\.(m4a|webm|opus|mp3|ogg|oga|aac|wav|flac|mp4|mka|analysis\.json|meta\.json|context\.json)$/.test(name));
const audio = files.filter(name => /\.(m4a|webm|opus|mp3|ogg|oga|aac|wav|flac|mp4|mka)$/.test(name));
if (audio.length !== 1) throw new Error(`${id}: expected one cached audio file, found ${audio.length}`);
for (const file of files) if (!existsSync(join(cache, file))) await copyFile(join(sourceCache, file), join(cache, file));
if (await hashFile(join(sourceCache, audio[0])) !== await hashFile(join(cache, audio[0]))) throw new Error('Scratch audio differs from source.');
const judgement = join(sourceCache, 'judge', id + '.json');
if (existsSync(judgement) && !existsSync(join(cache, 'judge', id + '.json'))) {
 await mkdir(join(cache, 'judge'), { recursive: true });
 await copyFile(judgement, join(cache, 'judge', id + '.json'));
}
const audioPath = join(cache, audio[0]);
const wide = await decodeAudio(audioPath, 44100);
const key = { audioHash: wide.hash, modelVersion: `${SEPARATION_VERSION}:dml`, frames44k: wide.left.length,
 stemModel: NO_TRANSCRIBER };
const manifestPath = join(output, 'manifest.json');
if (existsSync(manifestPath)) {
 const previous = JSON.parse(await readFile(manifestPath, 'utf8'));
 if (JSON.stringify(previous.evidenceKey) === JSON.stringify(key) && await readDrumEvidence(join(cache, 'drum-evidence'), key)) {
  console.log(JSON.stringify({ id, reused: true, output, evidenceKey: key })); process.exit(0);
 }
 throw new Error(`${id}: existing source output is incompatible; choose a new output directory.`);
}
const raw = (pcm: Float32Array) => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
const pcmHash = createHash('sha256').update(raw(wide.left)).update(raw(wide.right)).digest('hex');
await writeFile(join(output, 'mix.stereo.f32'), raw(wide.left));
await appendFile(join(output, 'mix.stereo.f32'), raw(wide.right));
await writeFile(join(output, 'mix.f32'), raw(wide.mono));
const mono22 = await decodeAudio(audioPath, 22050);
await writeFile(join(output, 'mix22.f32'), raw(mono22.mono));
const runtimeFiles = ['packages/analysis/src/separation.ts', 'packages/analysis/src/dsp/separationFft.ts',
 'packages/analysis/src/dsp/mdxFft.ts'];
const runtimeHashes = Object.fromEntries(await Promise.all(runtimeFiles.map(async file => [file, await hashFile(file)])));
const started = performance.now();
const providers: Record<string, string> = {};
const separator = await DrumSeparator.create(undefined, { provider: 'dml', threads: 4 });
if (!separator) throw new Error('Verified optional separator models are required.');
const internal = separator as any, stage = internal.stage.bind(separator);
internal.stage = async (...parameters: unknown[]) => {
 const result = await stage(...parameters);
 if (parameters[1] === 'drums') {
  await writeFile(join(output, 'phase-drums.stereo.f32'), raw(result[0][0]));
  await appendFile(join(output, 'phase-drums.stereo.f32'), raw(result[0][1]));
 }
 return result;
};
try {
 const separated = await separator.run(wide.left, wide.right, p => {
  providers[p.stage] = p.provider;
  if (p.completed === 0 || p.completed === p.total || p.completed % 5 === 0) console.log(JSON.stringify({ id, ...p }));
 });
 for (const name of ['drums', 'kick', 'snare', 'hat', 'cymbal'] as const) {
  await writeFile(join(output, name + '.f32'), raw(separated[name]));
 }
 const kick = await resamplePcm(separated.kick, 44100), snare = await resamplePcm(separated.snare, 44100);
 const hat = await resamplePcm(separated.hat, 44100), cymbal = await resamplePcm(separated.cymbal, 44100);
 for (const [name, pcm] of Object.entries({ kick, snare, hat, cymbal })) {
  await writeFile(join(output, name + '22.f32'), raw(pcm));
 }
 await writeDrumEvidence(join(cache, 'drum-evidence'), key,
  { sources: { sampleRate: 22050, kick, snare, hat, cymbal } });
 if (!await readDrumEvidence(join(cache, 'drum-evidence'), key)) throw new Error('Evidence cache read-back failed.');
 for (const file of runtimeFiles) if (await hashFile(file) !== runtimeHashes[file]) throw new Error('Separator changed during source preparation.');
 const manifest = { id, title: JSON.parse(await readFile(join(cache, id + '.meta.json'), 'utf8')).title,
  audioPath, audioSha256: await hashFile(audioPath), planar44kSha256: pcmHash, evidenceKey: key,
  frames: wide.left.length, sampleRate: 44100, analysisHash: mono22.hash, duration: wide.duration,
  version: SEPARATION_VERSION, provider: 'dml', actualProviders: providers, runtimeHashes,
  seconds: (performance.now() - started) / 1000, maxRssKb: process.resourceUsage().maxRSS,
  evidenceDirectory: join(cache, 'drum-evidence'), output };
 await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
 console.log(JSON.stringify({ completed: true, ...manifest }));
} finally { await separator.close(); }
