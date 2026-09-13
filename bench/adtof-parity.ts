/** node bench/adtof-parity.ts [--audio PATH] [--seconds 30] [--baseline DIR] [--out DIR] [--no-inference] */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { adtofFilterbank, adtofSpectrogram, activationStream, filterbankSpans } from '../packages/analysis/src/adtof.ts';
import { decodeAudio } from '../packages/analysis/src/decode.ts';
import { MODEL_DIR } from '../packages/analysis/src/paths.ts';
import * as ort from 'onnxruntime-node';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
	const i = args.indexOf(name);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const out = resolve(option('--out') ?? 'bench/reports/audio-reliability/parity');
const audio = option('--audio');
const seconds = Number(option('--seconds') ?? 30);
const baseline = option('--baseline');
const skipInference = args.includes('--no-inference');
mkdirSync(out, { recursive: true });
const writeFloats = (path: string, values: Float32Array) =>
	writeFileSync(path, Buffer.from(values.buffer, values.byteOffset, values.byteLength));
const readFloats = (path: string): Float32Array => {
	const b = readFileSync(path);
	return Float32Array.from({ length: b.length / 4 }, (_, i) => b.readFloatLE(i * 4));
};
function residual(a: Float32Array, b: Float32Array) {
	if (a.length !== b.length) throw new Error(`Shape mismatch ${a.length} != ${b.length}`);
	let max = 0;
	let abs = 0;
	let sq = 0;
	let changed = 0;
	for (let i = 0; i < a.length; i++) {
		const d = Math.abs(a[i] - b[i]);
		max = Math.max(max, d);
		abs += d;
		sq += d * d;
		if (d > 0) changed++;
	}
	return { max, mae: abs / a.length, rmse: Math.sqrt(sq / a.length), changed };
}
const signal = new Float32Array(44100 * 4);
let state = 7;
for (let i = 0; i < signal.length; i++) {
	state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
	const time = i / 44100;
	const envelope = Math.exp(-((time % 0.5) * 55));
	signal[i] = envelope * (0.2 * (state / 2 ** 32 - 0.5) + 0.4 * Math.sin(2 * Math.PI * 73 * time));
}
signal[0] = 1;
signal[signal.length - 1] = 0.75;
const cases = [
	{ id: 'silence', pcm: new Float32Array(signal.length) },
	{ id: 'impulses-tones-noise-exact-hop', pcm: signal },
	{ id: 'impulses-tones-noise-non-hop', pcm: signal.subarray(0, signal.length - 7) }
];
if (audio) {
	const decoded = await decodeAudio(audio, 44100);
	cases.push({ id: 'real-opening', pcm: decoded.mono.subarray(0, Math.min(decoded.mono.length, seconds * 44100)) });
}
const bank = adtofFilterbank();
writeFloats(join(out, 'typescript-bank.f32'), bank.filters);
for (const item of cases) writeFloats(join(out, item.id + '.pcm.f32'), item.pcm);
writeFileSync(join(out, 'inputs.json'), JSON.stringify({ audio, cases: cases.map(({ id, pcm }) => ({ id, samples: pcm.length })) }, null, 2));
const oracle = spawnSync('uv', ['run', '--no-project', '--python', '3.12', '--with', 'numpy', '--with', 'librosa',
	'python', 'bench/adtof-parity.py', out], { stdio: 'inherit', shell: false });
if (oracle.status !== 0) throw new Error(`Python oracle exited ${oracle.status}`);
const originalFilters = readFloats(join(out, 'original-bank.f32'));
const original = { filters: originalFilters, nBins: 84, fftBins: 1024, ...filterbankSpans(originalFilters, 84, 1024) };
const portBankParity = residual(bank.filters, readFloats(join(out, 'port-bank.f32')));
if (portBankParity.max > 1e-7) throw new Error('Port filterbank parity failed');
const reports: object[] = [];
const modelPath = join(MODEL_DIR, 'adtof_frame_rnn.onnx');
const session = skipInference ? null : await ort.InferenceSession.create(modelPath, { intraOpNumThreads: 1 });
const infer = async (spec: Float32Array) => {
	const start = performance.now();
	const result = await session!.run({ spectrogram: new ort.Tensor('float32', spec, [1, spec.length / 84, 84, 1]) });
	return { activations: result.activations.data as Float32Array, ms: performance.now() - start };
};
try {
	for (const item of cases) {
		const start = performance.now();
		const spec = adtofSpectrogram(item.pcm, bank);
		const frontendMs = performance.now() - start;
		const portParity = residual(spec, readFloats(join(out, item.id + '.port-reference.f32')));
		if (portParity.max > 3e-6) throw new Error(`${item.id} port spectrogram parity failed: ${portParity.max}`);
		const originalFrames = Math.ceil(item.pcm.length / 441);
		const originalSpec = adtofSpectrogram(item.pcm, original).subarray(0, originalFrames * 84);
		const originalParity = residual(originalSpec, readFloats(join(out, item.id + '.original-reference.f32')));
		if (originalParity.max > 3e-6) throw new Error(`${item.id} original spectrogram parity failed: ${originalParity.max}`);
		const row: Record<string, unknown> = { id: item.id, seconds: item.pcm.length / 44100, frontendMs,
			portFrames: spec.length / 84, originalFrames, portParity, originalParity,
			frontendDifference: residual(spec.subarray(0, originalSpec.length), originalSpec) };
		if (session) {
			const portAct = await infer(spec);
			const originalAct = await infer(originalSpec);
			row.inferenceMs = { port: portAct.ms, original: originalAct.ms };
			row.activationDifference = residual(portAct.activations.subarray(0, originalAct.activations.length), originalAct.activations);
			row.detections = [0, 1].map((channel) => {
				const stream = (a: Float32Array) => activationStream(Float32Array.from({ length: a.length / 5 }, (_, i) => a[i * 5 + channel]), channel ? 0.24 : 0.22);
				const port = stream(portAct.activations);
				const orig = stream(originalAct.activations);
				return { class: channel ? 'snare' : 'kick', port: { times: port.times, levels: port.levels },
					original: { times: orig.times, levels: orig.levels } };
			});
			if (baseline) {
				process.env.MV_MODEL_DIR = MODEL_DIR;
				const { Adtof } = await import(pathToFileURL(join(resolve(baseline), 'packages/analysis/src/adtof.ts')).href);
				const oldModel = await Adtof.create();
				try {
					const probe: { activations?: Float32Array } = {};
					await oldModel.run(item.pcm, probe);
					row.baselineActivationParity = residual(portAct.activations, probe.activations!);
					if ((row.baselineActivationParity as { max: number }).max > 1e-6) throw new Error('Shipping activation parity failed');
				} finally { await oldModel.close(); }
			}
		}
		reports.push(row);
		console.log(JSON.stringify(row));
	}
} finally { await session?.release(); }
const report = { date: new Date().toISOString(), model: modelPath,
	modelSha256: createHash('sha256').update(readFileSync(modelPath)).digest('hex'),
	portBankParity, oracle: JSON.parse(readFileSync(join(out, 'oracle.json'), 'utf8')), cases: reports,
	interpretation: 'Numerical parity and sensitivity only. Detection changes have no accuracy meaning without independent labels.' };
writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2));
