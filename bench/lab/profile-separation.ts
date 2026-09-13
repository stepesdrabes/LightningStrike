// node bench/lab/profile-separation.ts --provider=cpu --threads=4 --out=DIR
// Reuses the production chunking/FFT path; only session options are overridden.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { arch, cpus, platform, release } from 'node:os';
import * as ort from 'onnxruntime-node';
import { DrumSeparator, SEPARATION_VERSION } from '../../packages/analysis/src/separation.ts';
import { hashFile } from '../../packages/analysis/src/cpuGraphCache.ts';

const option = (key: string) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const provider = option('provider') ?? 'cpu';
if (!['cpu', 'dml', 'coreml', 'webgpu'].includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
if (!ort.listSupportedBackends().some(backend => backend.name === provider && backend.bundled)) {
 throw new Error(`Requested provider is not bundled in this runtime: ${provider}`);
}
const threads = Number(option('threads') ?? 4);
if (option('graph-cache') && (provider !== 'cpu' || option('arena') || option('spinning') || option('save-optimized') || option('kit-model'))) {
 throw new Error('--graph-cache profiles production CPU options; do not combine it with provider/session overrides.');
}
const input = option('input') ?? 'bench/reports/audio-reliability/habibi-stem/mix.stereo.f32';
const onlyStage = option('stage');
if (onlyStage && !['drums', 'kit'].includes(onlyStage)) throw new Error(`Unsupported stage: ${onlyStage}`);
const kitModel = option('kit-model');
if (provider === 'coreml' && onlyStage !== 'drums' && !kitModel) {
 throw new Error('CoreML static testing requires --kit-model=PATH to the fixed-eight-second export; Node ignores freeDimensionOverrides.');
}
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
const separator = await DrumSeparator.create(undefined, { threads, graphCacheDir: option('graph-cache') });
if (!separator) throw new Error('Missing models');
report.verificationMs = performance.now() - before;
const internal = separator as any;
const stage = internal.stage.bind(separator);
internal.stage = async (audio: unknown, kind: string, _ort: unknown, progress: unknown) => {
 const stats: any = { stage: kind, calls: [], loadMs: 0, inferenceMs: 0 };
 report.stages.push(stats);
 const started = performance.now();
 const wrapped = { Tensor: ort.Tensor, env: ort.env, InferenceSession: { create: async (path: string, options: any) => {
  const mark = performance.now();
  const optimized = option('save-optimized');
  const profiling = option('ort-profile');
  if (optimized) mkdirSync(optimized, { recursive: true });
  if (profiling) mkdirSync(profiling, { recursive: true });
  const session = await ort.InferenceSession.create(kind === 'kit' && kitModel ? kitModel : path, { ...options,
   ...(optimized ? { optimizedModelFilePath: join(optimized, `${kind}.onnx`) } : {}),
   ...(profiling ? { enableProfiling: true, profileFilePrefix: join(profiling, kind) } : {}),
   ...(option('arena') ? { enableCpuMemArena: option('arena') === 'true' } : {}),
   extra: { ...(options.extra ?? {}),
    ...(option('spinning') === 'false' ? { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } } : {}),
    ...(provider === 'dml' && kind === 'drums' ? { ep: { dml: { disable_graph_fusion: '1' } } } : {}) },
   executionProviders: provider === 'cpu' ? ['cpu'] : provider === 'coreml'
    ? [{ name: 'coreml', coreMlFlags: Number(option('coreml-flags') ?? 24) }, 'cpu'] : [provider as any, 'cpu'],
   ...(provider === 'dml' ? { enableMemPattern: false, executionMode: 'sequential' as const } : {})
  });
  stats.loadMs = performance.now() - mark;
  console.log(JSON.stringify({ stage: kind, loadMs: stats.loadMs, inputs: session.inputMetadata }));
  return { run: async (feeds: any) => {
   const started = performance.now(); const predicted = await session.run(feeds);
   const ms = performance.now() - started; stats.calls.push(ms); stats.inferenceMs += ms;
   stats.retainedRss = Math.max(stats.retainedRss ?? 0, process.memoryUsage().rss);
   stats.maxRssKb = process.resourceUsage().maxRSS;
   console.log(JSON.stringify({ stage: kind, call: stats.calls.length, ms, rss: process.memoryUsage().rss, maxRssKb: stats.maxRssKb }));
   return predicted;
  }, release: async () => { if (profiling) session.endProfiling(); await session.release(); } };
 } } };
 const result = await stage(audio, kind, wrapped, progress);
 stats.totalMs = performance.now() - started;
 stats.hostMs = stats.totalMs - stats.loadMs - stats.inferenceMs;
 return result;
};
try {
 const started = performance.now();
 let result;
 if (onlyStage) {
  const stereo = await internal.stage([pcm.subarray(0, frames), pcm.subarray(frames)], onlyStage, ort);
  const names = onlyStage === 'drums' ? ['drums'] : ['kick', 'snare', 'cymbal'];
  result = Object.fromEntries(stereo.map((s: Float32Array[], i: number) => [names[i], Float32Array.from(s[0], (v, f) => .5 * (v + s[1][f]))]));
 } else result = await separator.run(pcm.subarray(0, frames), pcm.subarray(frames));
 report.totalMs = performance.now() - started;
 for (const kind of ['drums', 'kick', 'snare', 'cymbal'] as const) {
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
