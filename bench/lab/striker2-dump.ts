// node bench/lab/striker2-dump.ts MODEL_DIR IN.f32 OUT_PREFIX [--features=F.f32] [--repeat=N]
// The shipped Striker 2.0 path (packages/analysis/src/striker2.ts) on mono float32 PCM at 44.1 kHz,
// for striker-2's tools/m7_parity.py: writes OUT_PREFIX.<output>.f32 ([frames, width] float32,
// stitched as the app stitches) and OUT_PREFIX.events.json (every decoded stream), and prints one
// JSON line of timings. --features reads [frames, 179] float32 instead of computing them;
// --repeat=N times N more front end and graph runs (best front end, median graph).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { Striker2, decodeStriker2, readStriker2 } from '../../packages/analysis/src/striker2.ts';
import { dbnBeats } from '../../packages/analysis/src/striker2Dbn.ts';
import { striker2Features } from '../../packages/analysis/src/striker2Frontend.ts';

const [dir, input, prefix, ...rest] = process.argv.slice(2);
if (!dir || !input || !prefix) throw new Error('Usage: striker2-dump.ts MODEL_DIR IN.f32 OUT_PREFIX');
const flag = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const repeat = Number(flag('repeat') ?? 0);

function f32(path: string): Float32Array {
	const buf = readFileSync(path);
	return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const ms = (since: number) => Math.round(performance.now() - since);
let at = performance.now();
const model = await readStriker2(dir);
const verifyMs = ms(at);
const mono = f32(input);
const frontMs: number[] = [];
const given = flag('features');
let features = given ? { data: f32(given), frames: f32(given).length / 179, bins: 179 } : null;
for (let r = 0; !given && r <= repeat; r++) {
	at = performance.now();
	features = striker2Features(mono, model.taps);
	frontMs.push(ms(at));
}
if (!features) throw new Error('No features.');
at = performance.now();
const striker = await Striker2.create(model);
const sessionMs = ms(at);
const graphMs: number[] = [];
at = performance.now();
const outputs = await striker.outputs(features);
graphMs.push(ms(at));
for (let r = 0; r < repeat; r++) {
	at = performance.now();
	await striker.outputs(features);
	graphMs.push(ms(at));
}
await striker.close();
at = performance.now();
const result = decodeStriker2(model, outputs);
const decodeMs = ms(at);
at = performance.now();
dbnBeats(outputs.beat, outputs.beat_offset);
const dbnMs = ms(at);
for (const [name, data] of Object.entries(outputs)) writeFileSync(`${prefix}.${name}.f32`, Buffer.from(data.buffer));
const drums = Object.fromEntries(Object.entries(result.drums).map(([cls, s]) => [cls, { times: s.times, levels: s.levels }]));
writeFileSync(`${prefix}.events.json`, JSON.stringify({ ...result, drums }));
const warm = graphMs.length > 1 ? graphMs.slice(1).sort((a, b) => a - b) : graphMs;
console.log(JSON.stringify({
	name: result.name, frames: features.frames, bins: features.bins, chunk: model.chunk, border: model.border,
	widths: Object.fromEntries(Object.entries(outputs).map(([name, data]) => [name, data.length / features.frames])),
	verify_ms: verifyMs, frontend_ms: frontMs.length ? Math.min(...frontMs) : null, frontend_runs_ms: frontMs,
	session_ms: sessionMs, graph_ms: warm[Math.floor(warm.length / 2)], graph_runs_ms: graphMs,
	decode_ms: decodeMs, dbn_ms: dbnMs, warnings: model.warnings,
	ort: (createRequire(import.meta.url)('onnxruntime-node/package.json') as { version: string }).version
}));
