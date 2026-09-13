import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as ort from 'onnxruntime-node';
import { join } from 'node:path';
import { DrumSeparator, SEPARATION_VERSION } from '../../packages/analysis/src/separation.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = flag('input') ?? 'bench/reports/audio-reliability/habibi-stem/mix.stereo.f32';
const out = flag('out') ?? 'bench/reports/audio-reliability/native-two-stage';
const raw = readFileSync(input);
const pcm = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const frames = pcm.length / 2;
mkdirSync(out, { recursive: true });
const sourceHash = createHash('sha256').update(raw).digest('hex');
const provider = (flag('provider') ?? 'cpu') as 'cpu' | 'dml';
const separator = await DrumSeparator.create(undefined, { threads: Number(flag('threads') ?? 4), provider });
if (!separator) throw new Error('Install the pinned HTDemucs and patched DrumSep exports first.');
const start = performance.now();
try {
	const progress = (p: unknown) => console.log(JSON.stringify(p));
	const stageFile = join(out, 'phase-drums.stereo.f32');
	const stageMeta = join(out, 'phase-drums.json');
	// Diagnostic instrumentation only: persist the expensive first stage before running kit.
	const instrumented = separator as unknown as {
		stage(...args: unknown[]): Promise<[Float32Array, Float32Array][]>;
	};
	const stage = instrumented.stage.bind(separator);
	instrumented.stage = async (...parameters: unknown[]) => {
		const result = await stage(...parameters);
		if (parameters[1] === 'drums') {
			writeFileSync(stageFile, Buffer.concat(result[0].map(channel => Buffer.from(channel.buffer))));
			writeFileSync(stageMeta, JSON.stringify({ sourceHash, frames, version: SEPARATION_VERSION, provider }));
		}
		return result;
	};
	let result;
	if (args.includes('--resume') && existsSync(stageFile) && existsSync(stageMeta)) {
		const metadata = JSON.parse(readFileSync(stageMeta, 'utf8'));
		if (metadata.sourceHash !== sourceHash || metadata.frames !== frames || metadata.version !== SEPARATION_VERSION || metadata.provider !== provider) throw new Error('First-stage cache does not match this input/runtime.');
		const saved = readFileSync(stageFile);
		if (saved.byteLength !== frames * 8) throw new Error('First-stage cache PCM is truncated.');
		const planar = new Float32Array(saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength));
		const drums: [Float32Array, Float32Array] = [planar.subarray(0, frames), planar.subarray(frames)];
		const [kick, snare, cymbal] = await stage(drums, 'kit', ort, progress);
		const mono = (stereo: [Float32Array, Float32Array]) => Float32Array.from(stereo[0], (v, i) => .5 * (v + stereo[1][i]));
		result = { sampleRate: 44100, drums: mono(drums), kick: mono(kick), snare: mono(snare), cymbal: mono(cymbal) };
	} else {
		result = await separator.run(pcm.subarray(0, frames), pcm.subarray(frames), progress);
	}
	for (const name of ['drums', 'kick', 'snare', 'cymbal'] as const) writeFileSync(join(out, name + '.f32'), Buffer.from(result[name].buffer));
	writeFileSync(join(out, 'manifest.json'), JSON.stringify({ input, frames, sampleRate: result.sampleRate, version: SEPARATION_VERSION, seconds: (performance.now() - start) / 1000 }, null, 2));
} finally { await separator.close(); }
