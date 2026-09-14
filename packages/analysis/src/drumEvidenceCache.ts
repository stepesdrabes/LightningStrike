import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { allFinite } from './dsp/stats.ts';
import type { SeparatedDrumAudio } from './separatedDrums.ts';

/** Four separated sources, then transcription activations of the drum stem and of each source. */
const FORMAT = 3;
const SOURCES = ['kick', 'snare', 'hat', 'cymbal'] as const;
const TRANSCRIBED = ['stem', ...SOURCES] as const;
const LIMIT = 2 * 1024 ** 3;
const FILE = /^[a-f0-9]{64}\.drums$/;
const TEMPORARY = /^[a-f0-9]{64}\.drums\.(\d+)\.[a-f0-9-]{36}\.tmp$/;
/** ADTOF frames at 100 Hz from 44.1 kHz, five classes each. */
const ACTIVATION_HOP = 441;
const ACTIVATION_CLASSES = 5;

async function removeInterruptedWrites(root: string): Promise<void> {
	for (const name of await readdir(root)) {
		const match = TEMPORARY.exec(name);
		if (!match) continue;
		try {
			process.kill(Number(match[1]), 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
				await unlink(join(root, name)).catch(() => {});
			}
		}
	}
}

/** `stemModel` when no transcription model is installed: the entry holds the sources alone. */
export const NO_TRANSCRIBER = 'none';

export interface DrumEvidenceKey {
	audioHash: string;
	modelVersion: string;
	frames44k: number;
	/** Identity of the transcription model that produced the activations, or NO_TRANSCRIBER. */
	stemModel: string;
}

export interface DrumEvidence {
	sources: SeparatedDrumAudio & { hat: Float32Array; cymbal: Float32Array };
	/** ADTOF activations, frames x 5 at 100 Hz; present exactly when the key names a transcriber. */
	activations?: Record<typeof TRANSCRIBED[number], Float32Array>;
}

const stemLength = (frames44k: number) => (1 + Math.floor(frames44k / ACTIVATION_HOP)) * ACTIVATION_CLASSES;
const transcribed = (key: DrumEvidenceKey) => (key.stemModel === NO_TRANSCRIBER ? 0 : TRANSCRIBED.length);

function pathFor(root: string, key: DrumEvidenceKey): string {
	const digest = createHash('sha256').update(JSON.stringify([
		FORMAT, key.audioHash, key.modelVersion, key.frames44k, key.stemModel, 'ffmpeg-22050-filter64-cutoff98'
	])).digest('hex');
	return join(root, digest + '.drums');
}

/** Derived evidence survives detector revisions; invalid or incomplete entries are cache misses. */
export async function readDrumEvidence(root: string, key: DrumEvidenceKey): Promise<DrumEvidence | null> {
	try {
		const path = pathFor(root, key);
		const info = await stat(path);
		const stem = stemLength(key.frames44k);
		const largest = ((Math.ceil(key.frames44k / 2) + 1) * SOURCES.length + stem * transcribed(key)) * 4 + 4100;
		if (info.size > largest) return null;
		const file = await readFile(path);
		const headerSize = file.readUInt32LE(0);
		if (headerSize > 4096 || headerSize < 2 || headerSize + 4 > file.length) return null;
		const header = JSON.parse(file.toString('utf8', 4, 4 + headerSize));
		const payload = file.subarray(4 + headerSize);
		if (header.format !== FORMAT || header.audioHash !== key.audioHash
			|| header.modelVersion !== key.modelVersion || header.frames44k !== key.frames44k
			|| header.stemModel !== key.stemModel
			|| header.sampleRate !== 22050 || !Number.isSafeInteger(header.frames) || header.frames < 1
			|| Math.abs(header.frames - key.frames44k / 2) > 1
			|| payload.length !== (header.frames * SOURCES.length + stem * transcribed(key)) * 4
			|| createHash('sha256').update(payload).digest('hex') !== header.sha256) return null;
		const values = payload.byteOffset % 4 === 0
			? new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4)
			: new Float32Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
		if (!allFinite(values)) return null;
		const now = new Date();
		await utimes(path, now, now).catch(() => {});
		const frames = header.frames;
		// Copies, not views: a view sent to a worker would clone the whole file buffer.
		const slice = (start: number, length: number) => values.slice(start, start + length);
		const sources = Object.fromEntries(SOURCES.map((name, i) => [name, slice(i * frames, frames)]));
		const offset = SOURCES.length * frames;
		const activations = transcribed(key) ? Object.fromEntries(TRANSCRIBED.map((name, i) =>
			[name, slice(offset + i * stem, stem)])) as DrumEvidence['activations'] : undefined;
		const evidence = { sources: { sampleRate: 22050, ...sources } as DrumEvidence['sources'] };
		return activations ? { ...evidence, activations } : evidence;
	} catch {
		return null;
	}
}

export async function writeDrumEvidence(
	root: string, key: DrumEvidenceKey, evidence: DrumEvidence, limitBytes = LIMIT
): Promise<void> {
	const { sources } = evidence;
	const pcm = SOURCES.map((name) => sources[name]);
	if (Boolean(evidence.activations) !== Boolean(transcribed(key))) return;
	const activations = evidence.activations ? TRANSCRIBED.map((name) => evidence.activations![name]) : [];
	const frames = sources.kick.length;
	if (sources.sampleRate !== 22050 || !frames || pcm.some((values) => values.length !== frames)
		|| Math.abs(frames - key.frames44k / 2) > 1
		|| activations.some((values) => values.length !== stemLength(key.frames44k))
		|| [...pcm, ...activations].some(values => !allFinite(values))) return;
	const payload = [...pcm, ...activations].map(values =>
		Buffer.from(values.buffer, values.byteOffset, values.byteLength));
	const hasher = createHash('sha256');
	for (const buffer of payload) hasher.update(buffer);
	const json = Buffer.from(JSON.stringify({ format: FORMAT, ...key, sampleRate: sources.sampleRate,
		frames, sha256: hasher.digest('hex') }));
	const header = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
	json.copy(header);
	const size = Buffer.alloc(4);
	size.writeUInt32LE(header.length);
	if (size.length + header.length + payload.reduce((sum, buffer) => sum + buffer.length, 0) > limitBytes) return;
	await mkdir(root, { recursive: true });
	await removeInterruptedWrites(root);
	const path = pathFor(root, key);
	const temporary = path + '.' + process.pid + '.' + randomUUID() + '.tmp';
	try {
		const file = await open(temporary, 'wx');
		try {
			for (const buffer of [size, header, ...payload]) await file.writeFile(buffer);
		} finally {
			await file.close();
		}
		await rename(temporary, path);
	} finally {
		await unlink(temporary).catch(() => {});
	}
	// This directory holds only disposable evidence. Audio, reviews and shows are elsewhere.
	const candidates = await Promise.all((await readdir(root)).filter(name => FILE.test(name)).map(async name => {
		const file = join(root, name);
		const info = await stat(file).catch(() => null);
		return info ? { file, size: info.size, modified: info.mtimeMs } : null;
	}));
	const entries = candidates.filter(entry => entry !== null);
	let total = entries.reduce((sum, entry) => sum + entry.size, 0);
	for (const entry of entries.sort((a, b) => a.modified - b.modified)) {
		if (total <= limitBytes) break;
		if (entry.file === path) continue;
		await unlink(entry.file).catch(() => {});
		total -= entry.size;
	}
}
