import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, analysisPath, findAudioFile, isValidId } from '@mv/analysis';
import type { TrackAnalysis } from '@mv/core';
import { validateDrumPatch, type DrumReview } from '../drumReview.ts';

export class ReviewError extends Error {
	constructor(message: string, public status = 400) { super(message); }
}

export class DrumReviewStore {
	private writing = new Map<string, Promise<unknown>>();
	constructor(private directory: string) {}
	private path(trackId: string, hash: string): string {
		if (!isValidId(trackId) || !/^[a-f0-9]{64}$/.test(hash)) throw new ReviewError('Invalid review.');
		return join(this.directory, `${trackId}.${hash}.json`);
	}
	async read(trackId: string, hash: string): Promise<DrumReview | null> {
		try { return JSON.parse(await readFile(this.path(trackId, hash), 'utf8')); }
		catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
	}
	async versions(trackId: string): Promise<string[]> {
		if (!isValidId(trackId)) throw new ReviewError('Invalid track.');
		try { return (await readdir(this.directory)).filter((f) => f.startsWith(`${trackId}.`) &&
			f.endsWith('.json')).map((f) => f.slice(trackId.length + 1, -5)).filter((h) => /^[a-f0-9]{64}$/.test(h)); }
		catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
	}
	async save(fresh: DrumReview, body: unknown): Promise<DrumReview> {
		let patch;
		try { patch = validateDrumPatch(body, fresh); }
		catch (e) { throw new ReviewError((e as Error).message); }
		const path = this.path(fresh.trackId, fresh.analysis.sha256);
		const operation = (this.writing.get(path) ?? Promise.resolve()).catch(() => {}).then(async () => {
			const held = await this.read(fresh.trackId, fresh.analysis.sha256);
			if ((held?.revision ?? 0) !== patch.baseRevision) {
				throw new ReviewError('Another window saved this review. Export your notes, then reload.', 409);
			}
			const result: DrumReview = { ...fresh, annotations: patch.annotations, range: patch.range,
				revision: patch.baseRevision + 1, updatedAt: Date.now() };
			await mkdir(this.directory, { recursive: true });
			const temp = `${path}.${process.pid}.tmp`;
			await writeFile(temp, JSON.stringify(result, null, '\t'));
			await rename(temp, path);
			return result;
		});
		this.writing.set(path, operation);
		try { return await operation; }
		finally { if (this.writing.get(path) === operation) this.writing.delete(path); }
	}
}

export const drumReviewStore = new DrumReviewStore(join(CACHE_DIR, 'drum-reviews'));

export function reviewFromAnalysis(raw: string, trackId: string, audioHash: string): DrumReview {
	const analysis: TrackAnalysis = JSON.parse(raw);
	if (analysis.trackId !== trackId) throw new ReviewError('The analysis belongs to another song.');
	return { schema: 1, trackId, title: analysis.title, duration: analysis.duration,
		audioHash, analysis: {
			sha256: createHash('sha256').update(raw).digest('hex'), hash: analysis.hash, version: analysis.version
		}, markers: Object.fromEntries((['kick', 'snare'] as const).map((kind) => [kind, {
			times: analysis.onsets[kind].times, levels: analysis.onsets[kind].levels
		}])) as DrumReview['markers'], revision: 0, updatedAt: 0,
		range: { start: 0, end: Math.min(12, analysis.duration) }, annotations: [] };
}

export async function pinnedDrumReview(directory: string, store: DrumReviewStore, trackId: string,
	hash: string, audioHash: string): Promise<DrumReview> {
	if (!isValidId(trackId) || !/^[a-f0-9]{64}$/.test(hash)) throw new ReviewError('Invalid review.');
	const saved = await store.read(trackId, hash);
	if (saved) {
		if (saved.audioHash !== audioHash || saved.trackId !== trackId || saved.analysis.sha256 !== hash) {
			throw new ReviewError('The song changed. This earlier review cannot be edited.', 409);
		}
		return saved;
	}
	const stem = join(directory, `${trackId}.${hash}`);
	let raw: string, identity: { audioHash: string };
	try {
		raw = await readFile(stem + '.analysis.json', 'utf8');
		identity = JSON.parse(await readFile(stem + '.identity.json', 'utf8'));
	} catch { throw new ReviewError('Earlier analysis not found.', 404); }
	if (identity.audioHash !== audioHash || createHash('sha256').update(raw).digest('hex') !== hash) {
		throw new ReviewError('The earlier analysis or song changed.', 409);
	}
	return reviewFromAnalysis(raw, trackId, audioHash);
}

export async function drumReviewVersions(trackId: string): Promise<string[]> {
	const versions = await drumReviewStore.versions(trackId);
	try {
		for (const file of await readdir(join(CACHE_DIR, 'drum-review-analyses'))) {
			if (file.startsWith(trackId + '.') && file.endsWith('.analysis.json')) {
				const hash = file.slice(trackId.length + 1, -14);
				if (/^[a-f0-9]{64}$/.test(hash)) versions.push(hash);
			}
		}
	} catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
	return [...new Set(versions)];
}

export async function freshDrumReview(trackId: string, pinned?: string): Promise<DrumReview> {
	if (!isValidId(trackId)) throw new ReviewError('Invalid track.');
	const audio = await findAudioFile(trackId);
	if (!audio) throw new ReviewError('Prepare this track before reviewing it.', 404);
	let raw: string;
	try { raw = await readFile(analysisPath(trackId), 'utf8'); }
	catch { throw new ReviewError('Prepare this track before reviewing it.', 404); }
	const hasher = createHash('sha256');
	for await (const chunk of createReadStream(audio)) hasher.update(chunk);
	const audioHash = hasher.digest('hex');
	if (pinned && pinned !== createHash('sha256').update(raw).digest('hex')) {
		return pinnedDrumReview(join(CACHE_DIR, 'drum-review-analyses'), drumReviewStore, trackId, pinned, audioHash);
	}
	return reviewFromAnalysis(raw, trackId, audioHash);
}
