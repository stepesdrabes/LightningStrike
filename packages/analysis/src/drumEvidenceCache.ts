import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { allFinite } from './dsp/stats.ts';
import type { SeparatedDrumAudio } from './separatedDrums.ts';

const FORMAT = 1;
const LIMIT = 2 * 1024 ** 3;
const FILE = /^[a-f0-9]{64}\.drums$/;
const TEMPORARY = /^[a-f0-9]{64}\.drums\.(\d+)\.[a-f0-9-]{36}\.tmp$/;

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

export interface DrumEvidenceKey {
	audioHash: string;
	modelVersion: string;
	frames44k: number;
}

function pathFor(root: string, key: DrumEvidenceKey): string {
	const digest = createHash('sha256').update(JSON.stringify([
		FORMAT, key.audioHash, key.modelVersion, key.frames44k, 'ffmpeg-22050-filter64-cutoff98'
	])).digest('hex');
	return join(root, digest + '.drums');
}

/** Derived PCM survives detector revisions; invalid or incomplete entries are cache misses. */
export async function readDrumEvidence(root: string, key: DrumEvidenceKey): Promise<SeparatedDrumAudio | null> {
	try {
		const path = pathFor(root, key);
		const info = await stat(path);
		if (info.size > (Math.ceil(key.frames44k / 2) + 1) * 12 + 4100) return null;
		const file = await readFile(path);
		const headerSize = file.readUInt32LE(0);
		if (headerSize > 4096 || headerSize < 2 || headerSize + 4 > file.length) return null;
		const header = JSON.parse(file.toString('utf8', 4, 4 + headerSize));
		const payload = file.subarray(4 + headerSize);
		if (header.format !== FORMAT || header.audioHash !== key.audioHash
			|| header.modelVersion !== key.modelVersion || header.frames44k !== key.frames44k
			|| header.sampleRate !== 22050 || !Number.isSafeInteger(header.frames) || header.frames < 1
			|| Math.abs(header.frames - key.frames44k / 2) > 1
			|| payload.length !== header.frames * 12
			|| createHash('sha256').update(payload).digest('hex') !== header.sha256) return null;
		const pcm = payload.byteOffset % 4 === 0
			? new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / 4)
			: new Float32Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
		if (!allFinite(pcm)) return null;
		const now = new Date();
		await utimes(path, now, now).catch(() => {});
		return { sampleRate: 22050, kick: pcm.subarray(0, header.frames),
			snare: pcm.subarray(header.frames, header.frames * 2), cymbal: pcm.subarray(header.frames * 2) };
	} catch {
		return null;
	}
}

export async function writeDrumEvidence(
	root: string, key: DrumEvidenceKey, sources: SeparatedDrumAudio, limitBytes = LIMIT
): Promise<void> {
	const { kick, snare, cymbal, sampleRate } = sources;
	if (!cymbal || sampleRate !== 22050 || !kick.length || snare.length !== kick.length
		|| cymbal.length !== kick.length || Math.abs(kick.length - key.frames44k / 2) > 1
		|| [kick, snare, cymbal].some(pcm => !allFinite(pcm))) return;
	const payload = [kick, snare, cymbal].map(pcm => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
	const hasher = createHash('sha256');
	for (const buffer of payload) hasher.update(buffer);
	const json = Buffer.from(JSON.stringify({ format: FORMAT, ...key, sampleRate,
		frames: kick.length, sha256: hasher.digest('hex') }));
	const header = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
	json.copy(header);
	const size = Buffer.alloc(4);
	size.writeUInt32LE(header.length);
	if (size.length + header.length + kick.byteLength * 3 > limitBytes) return;
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
