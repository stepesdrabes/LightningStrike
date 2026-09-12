// Per-10 ms band energies (dB) around a span, so kit plausibility can be judged per band instead
// of at the broadband energy peak: low (<200 Hz), body (150-400), crack (1.5-8 kHz), air (>6 kHz).
//   node bench/lab/bands.ts --id ID --from S --to S
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import { RealFft, hannWindow } from '../../packages/analysis/src/dsp/fft.ts';
import { benchmarkCache } from '../cache.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'bench', 'reports', 'audio-reliability', 'lab', 'bands');
const RATE = 44100;
const FFT = 2048;
const HOP = 441;
const PAD = 0.5;
export const BANDS = { low: [20, 200], body: [150, 400], crack: [1500, 8000], air: [6000, 20000], full: [20, 20000] } as const;
export type Band = keyof typeof BANDS;

const args = process.argv.slice(2);
const option = (flag: string) => {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : undefined;
};
const id = option('--id');
if (!id) throw new Error('Pass --id.');
const from = Math.max(0, Number(option('--from') ?? 0) - PAD);
const to = Number(option('--to') ?? 30) + PAD;
const cache = benchmarkCache();
const audio = readdirSync(cache).find((n) => n.startsWith(`${id}.`) && /\.(m4a|mp3|opus|webm|wav|flac)$/.test(n));
if (!audio) throw new Error(`no audio for ${id}`);

const wide = await decodeAudio(join(cache, audio), RATE);
const f0 = Math.floor(from * 100);
const f1 = Math.min(Math.floor(wide.mono.length / HOP), Math.ceil(to * 100));
const frames = Math.max(0, f1 - f0);
const fft = new RealFft(FFT);
const window = hannWindow(FFT);
const mags = new Float32Array(fft.bins);
const binHz = RATE / FFT;
const names = Object.keys(BANDS) as Band[];
const out: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, new Array<number>(frames)]));
for (let i = 0; i < frames; i++) {
	fft.magnitudes(wide.mono, (f0 + i) * HOP - FFT / 2, window, mags, 2 / FFT);
	const acc: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
	for (let k = 1; k < fft.bins; k++) {
		const hz = k * binHz;
		const p = mags[k] * mags[k];
		for (const n of names) if (hz >= BANDS[n][0] && hz < BANDS[n][1]) acc[n] += p;
	}
	for (const n of names) out[n][i] = Math.round(10 * Math.log10(Math.max(acc[n], 1e-12)) * 10) / 10;
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${id}.json`), JSON.stringify({ id, fps: 100, firstFrame: f0, frames, bands: out }));
console.error(`${id}: ${frames} frames from ${from.toFixed(2)} s`);
