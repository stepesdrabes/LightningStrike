// Cached per-track model evidence for drum evaluation, keyed by the decoded audio itself.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, type CorpusTrack } from './corpus.ts';

export const EVAL_ROOT = join(ROOT, 'bench', 'reports', 'drumeval');
const EVIDENCE_ROOT = join(EVAL_ROOT, 'evidence');

export function evidenceDir(track: Pick<CorpusTrack, 'corpus' | 'name'>): string {
	return join(EVIDENCE_ROOT, track.corpus, track.name);
}

export const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export function readF32(path: string): Float32Array {
	const raw = readFileSync(path);
	const out = new Float32Array(raw.byteLength / 4);
	new Uint8Array(out.buffer).set(raw);
	return out;
}

function atomic(path: string, data: string | Buffer): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, data);
	renameSync(temp, path);
}

export function writeF32(path: string, data: Float32Array): void {
	atomic(path, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

export function writeJson(path: string, value: unknown): void {
	atomic(path, JSON.stringify(value, null, '\t'));
}

export function readJson<T>(path: string): T | null {
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null;
}

export interface AudioRecord {
	audioSha256: string;
	/** decodeAudio hashes at 22050 and 44100 Hz. */
	hash22: string;
	hash44: string;
	duration: number;
	frames44k: number;
}

export interface BeatsRecord {
	hash22: string;
	beats: number[];
	downbeats: number[];
}

export interface ModelRecord {
	/** Hash of the PCM the model consumed. */
	input: string;
	frames: number;
	model: string;
	seconds: number;
}

export interface SeparationRecord {
	hash44: string;
	version: string;
	/** Hash of the stereo drum stem the kit stage consumed. */
	drums?: string;
	provider: string;
	actualProviders: Record<string, string>;
	seconds: number;
}

export const files = {
	audio: 'audio.json',
	beats: 'beats.json',
	adtofMix: 'adtof-mix.f32',
	adtofMixMeta: 'adtof-mix.json',
	separation: 'separation.json',
	drums44: 'drums44.f32',
	/** Planar left then right. */
	drumsStereo44: 'drums-stereo44.f32',
	kick22: 'kick22.f32',
	snare22: 'snare22.f32',
	hat22: 'hat22.f32',
	cymbal22: 'cymbal22.f32',
	adtofDrums: 'adtof-drums.f32',
	adtofDrumsMeta: 'adtof-drums.json',
	/** ADTOF on each 44.1 kHz separated source, written by the separation stage. */
	adtofKick: 'adtof-kick.f32',
	adtofSnare: 'adtof-snare.f32',
	adtofHat: 'adtof-hat.f32',
	adtofCymbal: 'adtof-cymbal.f32'
} as const;

export const pcmHash = (pcm: Float32Array) =>
	createHash('sha256').update(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)).digest('hex').slice(0, 16);
