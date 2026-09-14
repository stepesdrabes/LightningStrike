// node bench/lab/profile-separation.ts --provider=cpu --lanes=2 --out=DIR
// Reuses the production chunking/FFT path; only session options are overridden.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { arch, cpus, platform, release } from 'node:os';
import * as ort from 'onnxruntime-node';
import { DrumSeparator, SEPARATION_VERSION } from '../../packages/analysis/src/separation.ts';
import { hashFile } from '../../packages/analysis/src/cpuGraphCache.ts';
import { openSession } from '../../packages/analysis/src/onnxSession.ts';

const option = (key: string) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const provider = option('provider') ?? 'cpu';
if (!['cpu', 'dml', 'coreml', 'webgpu'].includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
if (!ort.listSupportedBackends().some(backend => backend.name === provider && backend.bundled)) {
 throw new Error(`Requested provider is not bundled in this runtime: ${provider}`);
}
const threads = Number(option('threads') ?? 4);
const lanes = option('lanes') ? Number(option('lanes')) : undefined;
if (option('graph-cache') && (provider !== 'cpu' || option('arena') || option('spinning') || option('save-optimized') || option('kit-model'))) {
 throw new Error('--graph-cache profiles production CPU options; do not combine it with provider/session overrides.');
}
const input = option('input') ?? 'bench/reports/audio-reliability/habibi-stem/mix.stereo.f32';
const onlyStage = option('stage');
if (onlyStage && !['drums', 'kit'].includes(onlyStage)) throw new Error(`Unsupported stage: ${onlyStage}`);
const kitModel = option('kit-model');
const out = option('out') ?? `bench/reports/audio-reliability/separation-performance/${provider}-${threads}`;
mkdirSync(out, { recursive: true });
const buffer = readFileSync(input);
const pcm = new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
const frames = pcm.length / 2;
const report: any = { provider, threads, input, frames, version: SEPARATION_VERSION,
 kitModel: kitModel ? { path: kitModel, sha256: await hashFile(kitModel) } : undefined,
 inputHash: createHash('sha256').update(buffer).digest('hex'), args: process.argv.slice(2),
 environment: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, ort: ort.env.versions, backends: ort.listSupportedBackends() }, stages: [] };
const before = performance.now();
const separator = await DrumSeparator.create(undefined, { threads, lanes, graphCacheDir: option('graph-cache'),
 provider: provider === 'dml' ? 'dml' : undefined });
if (!separator) throw new Error('Missing models');
report.verificationMs = performance.now() - before;
const internal = separator as any;
report.lanes = internal.lanes;
const stage = internal.stage.bind(separator);
internal.stage = async (audio: unknown, kind: string, productionOpen: (path: string, options: any) => Promise<any>, progress: unknown) => {
 const stats: any = { stage: kind, calls: [], loadMs: 0, inferenceMs: 0, sessions: 0 };
 report.stages.push(stats);
 const started = performance.now();
 // Profiling needs endProfiling on this thread; every other measurement uses production worker lanes.
 const open = async (path: string, options: any) => {
  const mark = performance.now();
  const optimized = option('save-optimized');
  const profiling = option('ort-profile');
  if (optimized) mkdirSync(optimized, { recursive: true });
  if (profiling) mkdirSync(profiling, { recursive: true });
  const sessionOptions = { ...options,
   ...(optimized ? { optimizedModelFilePath: join(optimized, `${kind}-${stats.sessions}.onnx`) } : {}),
   ...(profiling ? { enableProfiling: true, profileFilePrefix: join(profiling, `${kind}-${stats.sessions}`) } : {}),
   ...(option('arena') ? { enableCpuMemArena: option('arena') === 'true' } : {}),
   extra: { ...(options.extra ?? {}),
    ...(option('spinning') === 'false' ? { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } } : {}),
    ...(provider === 'dml' && kind === 'drums' ? { ep: { dml: { disable_graph_fusion: '1' } } } : {}) },
   executionProviders: provider === 'cpu' ? ['cpu'] : provider === 'coreml'
    ? [{ name: 'coreml', coreMlFlags: Number(option('coreml-flags') ?? 24) }, 'cpu'] : [provider as any, 'cpu'],
   ...(provider === 'dml' ? { enableMemPattern: false, executionMode: 'sequential' as const } : {})
  };
  const model = kind === 'kit' && kitModel ? kitModel : path;
  let session: any;
  // Production DirectML compiles each model ahead of its stage; reuse those sessions.
  if (provider === 'dml' && !(kind === 'kit' && kitModel) && !profiling && !optimized && !option('arena') && !option('spinning')) {
   session = await productionOpen(path, options);
  } else if (profiling) {
   const native = await ort.InferenceSession.create(model, sessionOptions);
   session = { inputMetadata: native.inputMetadata, detached: false,
    run: (feeds: any) => native.run(Object.fromEntries(Object.entries(feeds).map(([name, tensor]: [string, any]) =>
     [name, new ort.Tensor('float32', tensor.data, tensor.dims)]))),
    release: async () => { native.endProfiling(); await native.release(); } };
  } else session = await openSession(model, sessionOptions);
  stats.sessions++;
  stats.loadMs += performance.now() - mark;
  console.log(JSON.stringify({ stage: kind, loadMs: performance.now() - mark, inputs: session.inputMetadata }));
  return { ...session, run: async (feeds: any, runOptions: any) => {
   const started = performance.now(); const predicted = await session.run(feeds, runOptions);
   const ms = performance.now() - started; stats.calls.push(ms); stats.inferenceMs += ms;
   stats.retainedRss = Math.max(stats.retainedRss ?? 0, process.memoryUsage().rss);
   stats.maxRssKb = process.resourceUsage().maxRSS;
   console.log(JSON.stringify({ stage: kind, call: stats.calls.length, ms, rss: process.memoryUsage().rss, maxRssKb: stats.maxRssKb }));
   return predicted;
  }, release: () => session.release() };
 };
 const result = await stage(audio, kind, open, progress);
 stats.totalMs = performance.now() - started;
 // With several lanes, summed call time exceeds wall time and hostMs is not a host cost.
 stats.hostMs = stats.totalMs - stats.loadMs - stats.inferenceMs;
 return result;
};
try {
 const started = performance.now();
 let result;
 if (onlyStage) {
  // Production DirectML opens HTDemucs during verification; a drums-only run uses that session too.
  const warmOrOpen = (path: string, options: any) => {
   const warm = onlyStage === 'drums' ? internal.warmDrums : null;
   if (!warm) return openSession(path, options);
   internal.warmDrums = null;
   return warm;
  };
  const stereo = await internal.stage([pcm.subarray(0, frames), pcm.subarray(frames)], onlyStage, warmOrOpen);
  const names = onlyStage === 'drums' ? ['drums'] : ['kick', 'snare', 'hat', 'cymbal'];
  result = Object.fromEntries(stereo.map((s: Float32Array[], i: number) => [names[i], Float32Array.from(s[0], (v, f) => .5 * (v + s[1][f]))]));
 } else result = await separator.run(pcm.subarray(0, frames), pcm.subarray(frames));
 report.totalMs = performance.now() - started;
 for (const kind of ['drums', 'kick', 'snare', 'hat', 'cymbal'] as const) {
  if (result[kind]) writeFileSync(join(out, `${kind}.f32`), Buffer.from(result[kind].buffer));
 }
} catch (error) {
 report.error = String(error);
 throw error;
} finally {
 await separator.close();
 writeFileSync(join(out, 'profile.json'), JSON.stringify(report, null, 2));
 console.log(JSON.stringify(report, null, 2));
}
