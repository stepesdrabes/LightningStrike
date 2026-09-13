import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const option = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const reference = option('reference')!, candidate = option('candidate')!;
const read = (path: string) => { const b = readFileSync(path); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const sources = Object.fromEntries(['drums', 'kick', 'snare', 'cymbal'].map(name => {
 const a = read(join(reference, name + '.f32')), b = read(join(candidate, name + '.f32'));
 if (a.length !== b.length) throw new Error(`${name} length mismatch`);
 let maxError = 0, mse = 0, energy = 0, actual = 0, dot = 0;
 for (let i = 0; i < a.length; i++) {
  if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error(`${name} non-finite sample`);
  const error = a[i] - b[i]; maxError = Math.max(maxError, Math.abs(error));
  mse += error * error; energy += a[i] * a[i]; actual += b[i] * b[i]; dot += a[i] * b[i];
 }
 const relativeRms = energy > 0 ? Math.sqrt(mse / energy) : (mse === 0 ? 0 : Infinity);
 const correlation = energy * actual > 0 ? dot / Math.sqrt(energy * actual) : (mse === 0 ? 1 : 0);
 return [name, { samples: a.length, maxError, relativeRms, correlation, passed: relativeRms < .001 && correlation > .999999 }];
}));
const report = { reference, candidate, admission: { passed: Object.values(sources).every(s => s.passed), relativeRmsLimit: .001, correlationMinimum: .999999 }, sources };
writeFileSync(join(candidate, 'pcm-parity.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.admission.passed) process.exitCode = 1;
