import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { demucsIspec } from '../../packages/analysis/src/dsp/separationFft.ts';
import { RealFft, hannWindow } from '../../packages/analysis/src/dsp/fft.ts';

// Frozen two-transform baseline for comparison, independent of the production helper.
function before(spec: Float32Array, length: number, sources: number): Float32Array {
 const n = 4096, bins = n / 2, frames = Math.ceil(length / 1024), window = hannWindow(n);
 const fft = new RealFft(n), unit = new Float32Array(n).fill(1);
 const result = new Float32Array(sources * 2 * length), weight = new Float64Array(length);
 const real = new Float32Array(n), imaginary = new Float32Array(n);
 const rr = new Float32Array(bins + 1), ri = new Float32Array(bins + 1);
 const ir = new Float32Array(bins + 1), ii = new Float32Array(bins + 1);
 for (let t = -2; t < frames + 2; t++) {
  const start = t * 1024 - 1536;
  for (let j = Math.max(0, -start); j < Math.min(n, length - start); j++) weight[start + j] += window[j] ** 2;
 }
 for (let c = 0; c < sources * 2; c++) {
  const out = result.subarray(c * length, (c + 1) * length);
  for (let t = 0; t < frames; t++) {
   real.fill(0); imaginary.fill(0);
   for (let f = 0; f < bins; f++) {
    const re = spec[(c * 2 * bins + f) * frames + t];
    const im = spec[((c * 2 + 1) * bins + f) * frames + t];
    real[f] = re;
    if (f) { real[n - f] = re; imaginary[f] = im; imaginary[n - f] = -im; }
   }
   fft.forward(real, 0, unit, rr, ri); fft.forward(imaginary, 0, unit, ir, ii);
   const start = t * 1024 - 1536;
   for (let j = Math.max(0, -start); j < Math.min(n, length - start); j++) {
    const k = j <= bins ? j : n - j;
    out[start + j] += (rr[k] + (j <= bins ? ii[k] : -ii[k])) / 64 * window[j];
   }
  }
  for (let j = 0; j < length; j++) out[j] /= weight[j] || 1;
 }
 return result;
}

const root = 'bench/reports/audio-reliability/';
const input = root + 'onnx-drumsep-portable8/output-freq.f32';
const buffer = existsSync(input) ? readFileSync(input) : undefined;
const spectrum = buffer ? new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
 : Float32Array.from({ length: 3 * 4 * 2048 * 345 }, (_, i) => Math.sin(i * .731) / (1 + i % 2048));
const times = { before: [] as number[], after: [] as number[] };
let reference!: Float32Array, actual!: Float32Array;
for (let trial = 0; trial < 3; trial++) {
 for (const variant of trial % 2 ? ['after', 'before'] as const : ['before', 'after'] as const) {
  const start = performance.now();
  const result = (variant === 'before' ? before : demucsIspec)(spectrum, 352800, 3);
  times[variant].push(performance.now() - start);
  if (variant === 'before') reference = result; else actual = result;
 }
}
let maxError = 0, mse = 0, energy = 0;
for (let i = 0; i < reference.length; i++) {
 const error = actual[i] - reference[i];
 maxError = Math.max(maxError, Math.abs(error)); mse += error * error; energy += reference[i] ** 2;
}
const report = { input: buffer ? input : 'deterministic synthetic spectrum', times, maxError,
 rmsError: Math.sqrt(mse / reference.length), relativeRms: Math.sqrt(mse / energy) };
mkdirSync(root + 'separation-performance', { recursive: true });
writeFileSync(root + 'separation-performance/fft-profile.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
