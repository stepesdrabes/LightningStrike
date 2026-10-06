// node bench/lab/metal-compare.ts --id=TRACK --stage=drums|kit [--cache=DIR] [--graphs=DIR] [--offset=40]
//   [--runs=3] [--profile]
// One separator chunk of a cached track on ONNX Runtime's CPU kernels and on the Metal plan,
// both reading the optimized CPU graph the app caches. Every output must match bit for bit.
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as ort from 'onnxruntime-node';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import { MDX_BINS, MDX_HOP, mdxFrames, mdxSpec } from '../../packages/analysis/src/dsp/mdxFft.ts';
import { demucsSpec } from '../../packages/analysis/src/dsp/separationFft.ts';
import { loadMetalAddon } from '../../packages/analysis/src/metal/addon.ts';
import { mlasParallelism } from '../../packages/analysis/src/metal/mlas.ts';
import { readOnnx } from '../../packages/analysis/src/metal/onnx.ts';
import { MetalPlan, type OrtRuntime } from '../../packages/analysis/src/metal/plan.ts';
import { benchmarkCache } from '../cache.ts';

const option = (key: string) => process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const id = option('id') ?? '';
const stage = option('stage') ?? 'drums';
if (!id || !['drums', 'kit'].includes(stage)) throw new Error('Pass --id=TRACK and --stage=drums|kit.');
const cache = resolve(benchmarkCache(option('cache')));
const graphs = resolve(option('graphs') ?? join(cache, 'separator-graphs'));
const prefix = stage === 'drums' ? 'htdemucs.cpu-v2.' : 'drumsep-mdx23c.cpu-v2.';
const graph = readdirSync(graphs).filter((f) => f.startsWith(prefix) && f.endsWith('.onnx'))
	.map((f) => join(graphs, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!graph) throw new Error(`No cached ${stage} graph in ${graphs}; prepare a track in the app first.`);
const audio = readdirSync(cache).find((f) => f.startsWith(`${id}.`) && /\.(m4a|webm|opus|mp3|ogg|wav|flac)$/.test(f));
if (!audio) throw new Error(`No cached audio for ${id} in ${cache}.`);
const addon = loadMetalAddon();
if (!addon) throw new Error('The Metal binding is not built: npm run build:metal -w @mv/analysis');

const { left, right } = await decodeAudio(join(cache, audio), 44100);
const offset = Math.round(44100 * Number(option('offset') ?? 40));
const segment = stage === 'drums' ? 343980 : MDX_HOP * 1023;
if (offset + segment > left.length) throw new Error('The offset leaves no full chunk.');
const mix = new Float32Array(2 * segment);
mix.set(left.subarray(offset, offset + segment));
mix.set(right.subarray(offset, offset + segment), segment);
const feeds: Record<string, { data: Float32Array; dims: number[] }> = stage === 'drums'
	? { mix: { data: mix, dims: [1, 2, segment] },
		magnitude: { data: demucsSpec(mix, segment), dims: [1, 4, 2048, Math.ceil(segment / 1024)] } }
	: { spec: { data: mdxSpec(mix, segment), dims: [1, 4, MDX_BINS, mdxFrames(segment)] } };

const cpu = { executionProviders: ['cpu'], graphOptimizationLevel: 'disabled', enableCpuMemArena: false,
	intraOpNumThreads: 4, interOpNumThreads: 1 } as const;
const session = await ort.InferenceSession.create(graph, cpu);
let started = performance.now();
const reference = await session.run(Object.fromEntries(Object.entries(feeds)
	.map(([name, t]) => [name, new ort.Tensor('float32', t.data.slice(), t.dims)])));
console.log(`ONNX Runtime CPU: ${Math.round(performance.now() - started)} ms`);
await session.release();

started = performance.now();
const plan = await MetalPlan.create(addon, readOnnx(graph), {
	parallelism: mlasParallelism(cpu.intraOpNumThreads), cpu, ort: ort as unknown as OrtRuntime
});
console.log(`plan: ${Math.round(performance.now() - started)} ms`);
const inputs = Object.fromEntries(Object.entries(feeds).map(([name, t]) => [name, t.data]));
if (process.argv.includes('--profile')) {
	const steps = Object.entries(await plan.profile(inputs)).sort((a, b) => b[1] - a[1]);
	for (const [name, ms] of steps.slice(0, 25)) console.log(`${ms.toFixed(1).padStart(8)} ms  ${name}`);
}
let failed = false;
for (let run = 0; run < Number(option('runs') ?? 3); run++) {
	started = performance.now();
	const result = await plan.run(inputs);
	const wall = performance.now() - started;
	if ('doubt' in result) {
		console.log(`run ${run}: not provably exact (${result.doubt}); the app would run this chunk on the CPU`);
		continue;
	}
	const report = Object.entries(reference).map(([name, tensor]) => {
		const want = new Uint32Array((tensor.data as Float32Array).buffer);
		const got = new Uint32Array(result.outputs[name].buffer);
		let differing = 0;
		for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) differing++;
		failed ||= differing > 0;
		return `${name} ${differing}/${want.length} differ`;
	});
	console.log(`run ${run}: ${Math.round(wall)} ms (GPU ${Math.round(result.gpuMs)}, CPU steps ${Math.round(result.islandMs)}) | ${report.join(' | ')}`);
}
await plan.release();
if (failed) process.exitCode = 1;
