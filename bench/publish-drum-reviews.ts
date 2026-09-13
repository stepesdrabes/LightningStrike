// node bench/publish-drum-reviews.ts --source-cache=DIR --target-cache=DIR --ids=ID,ID [--analysis-dir=DIR] [--apply --backup=NEW_DIR]
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TrackAnalysis } from '@mv/core';
import { decodeAudio } from '../packages/analysis/src/decode.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const validId = (id: string) => /^(?:[\w-]{11}|file-[a-f0-9]{12})$/.test(id);
async function optional(path: string): Promise<Buffer | null> {
	try { return await readFile(path); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
async function audioPath(directory: string, id: string): Promise<string | null> {
	const files = (await readdir(directory)).filter(f => f.startsWith(id + '.') && /\.(m4a|webm|opus|mp3|ogg|oga|aac|wav|flac|mp4|mka)$/.test(f));
	if (files.length > 1) throw new Error(`Ambiguous audio for ${id}.`);
	return files.length ? join(directory, files[0]) : null;
}
export interface PublicationTrack { trackId: string; sourceCache: string; analysisPath?: string }
interface Write { path: string; bytes: Buffer; previous: string | null; immutable?: boolean }

export async function publishDrumReviews(tracks: readonly PublicationTrack[], options: {
	targetCache: string; apply?: boolean; backup?: string; minimumVersion?: number;
	decode?: (path: string) => Promise<{ hash: string; duration: number }>;
}) {
	const target = resolve(options.targetCache);
	if (!(await stat(target)).isDirectory()) throw new Error('Target cache must already exist.');
	if (!tracks.length || new Set(tracks.map(t => t.trackId)).size !== tracks.length) throw new Error('Choose distinct tracks.');
	const writes: Write[] = [], snapshots = new Map<string, Buffer>();
	const summary: { trackId: string; title: string; version: number; analysisSha256: string; oldAnalysisSha256: string | null; audioSha256: string; added: boolean }[] = [];
	for (const track of tracks) {
		const id = track.trackId; if (!validId(id)) throw new Error('Invalid track ID.');
		const source = resolve(track.sourceCache);
		if (source === target) throw new Error('Source and target caches must differ.');
		const sourceAudio = await audioPath(source, id); if (!sourceAudio) throw new Error(`Missing source audio: ${id}`);
		const audio = await readFile(sourceAudio), audioHash = digest(audio);
		const raw = await readFile(track.analysisPath ?? join(source, id + '.analysis.json'));
		const analysis = JSON.parse(raw.toString('utf8')) as TrackAnalysis;
		if (analysis.trackId !== id || !Number.isFinite(analysis.duration) || analysis.duration <= 0 || !Number.isInteger(analysis.version)) throw new Error(`Invalid analysis identity: ${id}`);
		if (options.minimumVersion !== undefined && analysis.version < options.minimumVersion) throw new Error(`Analysis is older than the requested version: ${id}`);
		for (const kind of ['kick', 'snare'] as const) {
			const stream = analysis.onsets?.[kind];
			if (!stream || !Array.isArray(stream.times) || !Array.isArray(stream.levels) || stream.times.length !== stream.levels.length
				|| stream.times.some((t, i) => !Number.isFinite(t) || t < 0 || t > analysis.duration || (i > 0 && t < stream.times[i - 1]))
				|| stream.levels.some(level => !Number.isFinite(level) || level < 0 || level > 1)) throw new Error(`Invalid ${kind} events: ${id}`);
		}
		const decoded = await (options.decode ?? decodeAudio)(sourceAudio);
		if (decoded.hash !== analysis.hash || Math.abs(decoded.duration - analysis.duration) > .05 || digest(await readFile(sourceAudio)) !== audioHash) {
			throw new Error(`Analysis does not match decoded full audio: ${id}`);
		}
		const meta = await readFile(join(source, id + '.meta.json'));
		if (JSON.parse(meta.toString('utf8')).id !== id) throw new Error(`Metadata belongs to another song: ${id}`);
		const existingAudioPath = await audioPath(target, id);
		if (existingAudioPath && digest(await readFile(existingAudioPath)) !== audioHash) throw new Error(`Refusing to change reviewed audio: ${id}`);
		const current = await optional(join(target, id + '.analysis.json'));
		if (current && !existingAudioPath) throw new Error(`Existing analysis has no audio: ${id}`);
		for (const name of (await readdir(target)).filter(name => name.startsWith(id + '.'))) {
			if ((await stat(join(target, name))).isFile()) snapshots.set(name, await readFile(join(target, name)));
		}
		const oldHash = current ? digest(current) : null;
		if (current) {
			if (JSON.parse(current.toString('utf8')).trackId !== id) throw new Error(`Existing analysis identity mismatch: ${id}`);
			const stem = join(target, 'drum-review-analyses', `${id}.${oldHash}`);
			writes.push({ path: stem + '.identity.json', bytes: Buffer.from(JSON.stringify({ audioHash }, null, 2)), previous: null, immutable: true });
			writes.push({ path: stem + '.analysis.json', bytes: current, previous: null, immutable: true });
		}
		if (!existingAudioPath) {
			writes.push({ path: join(target, sourceAudio.slice(source.length + 1)), bytes: audio, previous: null });
		}
		for (const [extension, bytes] of [['meta.json', meta], ['context.json', await optional(join(source, id + '.context.json'))]] as const) {
			if (bytes && !await optional(join(target, `${id}.${extension}`))) writes.push({ path: join(target, `${id}.${extension}`), bytes, previous: null });
		}
		writes.push({ path: join(target, id + '.analysis.json'), bytes: raw, previous: oldHash });
		summary.push({ trackId: id, title: analysis.title, version: analysis.version, analysisSha256: digest(raw), oldAnalysisSha256: oldHash, audioSha256: audioHash, added: !existingAudioPath });
	}
	const reviewDirectory = join(target, 'drum-reviews');
	try {
		for (const name of await readdir(reviewDirectory)) if (name.endsWith('.json')) snapshots.set(join('drum-reviews', name), await readFile(join(reviewDirectory, name)));
	} catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
	for (const write of writes) {
		const held = await optional(write.path);
		if (write.immutable && held) {
			if (digest(held) !== digest(write.bytes)) throw new Error(`Conflicting archived identity: ${write.path}`);
			write.previous = digest(held);
		} else if ((held ? digest(held) : null) !== write.previous) throw new Error(`Target changed during preparation: ${write.path}`);
	}
	if (!options.apply) return { applied: false, targetCache: target, tracks: summary, reviewFilesPreserved: [...snapshots.keys()].filter(k => k.startsWith('drum-reviews')).length };
	if (!options.backup) throw new Error('--apply requires a new --backup directory.');
	const backup = resolve(options.backup);
	if (backup === target || backup.startsWith(target + '/') || backup.startsWith(target + '\\')) throw new Error('Backup must be outside the live cache.');
	await mkdir(backup);
	for (const [name, bytes] of snapshots) {
		const path = join(backup, name); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, bytes, { flag: 'wx' });
	}
	const manifest = { applied: false, targetCache: target, tracks: summary, originals: [...snapshots].map(([path, bytes]) => ({ path, sha256: digest(bytes) })) };
	await writeFile(join(backup, 'publication.json'), JSON.stringify(manifest, null, 2));
	for (const write of writes) {
		const held = await optional(write.path);
		if ((held ? digest(held) : null) !== write.previous) throw new Error(`Target changed before replacement: ${write.path}. Backup: ${backup}`);
		if (held && digest(held) === digest(write.bytes)) continue;
		await mkdir(resolve(write.path, '..'), { recursive: true });
		const temporary = write.path + `.${process.pid}.${randomUUID()}.tmp`;
		try { await writeFile(temporary, write.bytes, { flag: 'wx' }); await rename(temporary, write.path); }
		finally { await rm(temporary, { force: true }).catch(() => {}); }
	}
	await writeFile(join(backup, 'publication.json'), JSON.stringify({ ...manifest, applied: true }, null, 2));
	return { applied: true, targetCache: target, backup, tracks: summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
	if (process.argv.includes('--help')) console.log('node bench/publish-drum-reviews.ts --source-cache=DIR --target-cache=DIR --ids=ID,ID [--analysis-dir=DIR] [--minimum-version=N] [--apply --backup=NEW_DIR]');
	else {
		if (!arg('source-cache') || !arg('target-cache') || !arg('ids')) throw new Error('Pass source-cache, target-cache and ids.');
		const tracks = arg('ids')!.split(',').map(trackId => ({ trackId, sourceCache: arg('source-cache')!,
			analysisPath: arg('analysis-dir') ? join(arg('analysis-dir')!, trackId + '.analysis.json') : undefined }));
		const minimumVersion = arg('minimum-version') === undefined ? undefined : Number(arg('minimum-version'));
		if (minimumVersion !== undefined && (!Number.isInteger(minimumVersion) || minimumVersion < 1)) throw new Error('Invalid minimum version.');
		console.log(JSON.stringify(await publishDrumReviews(tracks, { targetCache: arg('target-cache')!, minimumVersion,
			apply: process.argv.includes('--apply'), backup: arg('backup') }), null, 2));
	}
}
