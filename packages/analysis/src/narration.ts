import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MeasuredAudio } from '@mv/core';
import { decodeAudio } from './decode.ts';
import { computeSpectrogram, logFilterBank } from './dsp/spectrogram.ts';
import { levelTrack } from './level.ts';
import { measureLoudness } from './loudness.ts';
import { CACHE_DIR } from './paths.ts';
import { spectrumTrack } from './spectrum.ts';
import { analyseStereo } from './stereo.ts';

const NARRATION_DIR = join(CACHE_DIR, 'narration');
/** Bump when what a narration's measurement contains changes. */
const NARRATION_VERSION = 1;

const round2 = (v: number) => Math.round(v * 100) / 100;

async function cachePath(path: string): Promise<string> {
	const info = await stat(path);
	const key = createHash('sha256').update(`${NARRATION_VERSION}|${path}|${info.size}|${info.mtimeMs}`).digest('hex').slice(0, 24);
	return join(NARRATION_DIR, `${key}.json`);
}

/** The narration's measurement if it has been prepared, without decoding anything. */
export async function preparedNarration(path: string): Promise<MeasuredAudio | null> {
	try {
		return JSON.parse(await readFile(await cachePath(path), 'utf8')) as MeasuredAudio;
	} catch {
		return null;
	}
}

/**
 * Level, spectrum and stereo image of a spoken audio file, without the beat and drum models a
 * voice has no use for. The whole file is its own loud reference.
 */
export async function prepareNarration(path: string): Promise<MeasuredAudio> {
	const target = await cachePath(path);
	const cached = await preparedNarration(path);
	if (cached) return cached;

	const audio = await decodeAudio(path);
	const hop = Math.max(1, Math.round(audio.sampleRate / 100));
	const spec = computeSpectrogram(audio.mono, audio.sampleRate, {
		fftSize: 2048,
		hop,
		bank: logFilterBank(2048, audio.sampleRate, 24, 30, 17000)
	});
	const everywhere = () => 'groove' as const;
	const stereo = analyseStereo(audio.left, audio.right, audio.sampleRate);
	const measured: MeasuredAudio = {
		duration: audio.duration,
		level: levelTrack(audio.mono, audio.sampleRate, audio.duration, everywhere),
		spectrum: spectrumTrack(spec, audio.duration, everywhere),
		stereo: { fps: stereo.fps, pan: Array.from(stereo.pan, round2), width: Array.from(stereo.width, round2) },
		integratedLufs: Math.round(measureLoudness(audio.mono, audio.sampleRate).integrated * 10) / 10
	};

	await mkdir(NARRATION_DIR, { recursive: true });
	const tmp = `${target}.${process.pid}.tmp`;
	await writeFile(tmp, JSON.stringify(measured));
	await rename(tmp, target);
	return measured;
}
