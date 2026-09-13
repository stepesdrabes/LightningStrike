import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { publishDrumReviews } from './publish-drum-reviews.ts';
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function fixture(existing = true) {
	const root = await mkdtemp(join(tmpdir(), 'lightning-publication-')); folders.push(root);
	const source = join(root, 'source'), target = join(root, 'target'), backup = join(root, 'backup');
	await mkdir(source); await mkdir(target);
	const id = 'abcdefghijk';
	const analysis = { trackId: id, title: 'Song', version: 37, hash: 'pcm', duration: 30,
		onsets: { kick: { times: [1], levels: [1] }, snare: { times: [2], levels: [.8] } } };
	const old = Buffer.from(JSON.stringify({ ...analysis, version: 35 }));
	await writeFile(join(source, id + '.analysis.json'), JSON.stringify(analysis));
	await writeFile(join(source, id + '.meta.json'), JSON.stringify({ id, title: 'Song' }));
	await writeFile(join(source, id + '.m4a'), 'same encoded audio');
	if (existing) {
		await writeFile(join(target, id + '.m4a'), 'same encoded audio');
		await writeFile(join(target, id + '.analysis.json'), old);
		await mkdir(join(target, 'drum-reviews'));
		await writeFile(join(target, 'drum-reviews', 'preserve.json'), 'exact user evidence');
	}
	const tracks = [{ trackId: id, sourceCache: source }];
	const options = { targetCache: target, decode: async () => ({ hash: 'pcm', duration: 30 }) };
	return { root, source, target, backup, id, old, tracks, options };
}
describe('review analysis publication', () => {
	it('dry run changes no files, then publication archives exact old bytes and preserves reviews', async () => {
		const f = await fixture(); const before = await readdir(f.target);
		expect((await publishDrumReviews(f.tracks, f.options)).applied).toBe(false);
		expect(await readdir(f.target)).toEqual(before);
		await publishDrumReviews(f.tracks, { ...f.options, apply: true, backup: f.backup });
		const hash = createHash('sha256').update(f.old).digest('hex');
		expect(await readFile(join(f.target, 'drum-review-analyses', `${f.id}.${hash}.analysis.json`))).toEqual(f.old);
		expect(await readFile(join(f.backup, f.id + '.analysis.json'))).toEqual(f.old);
		expect(await readFile(join(f.target, 'drum-reviews', 'preserve.json'), 'utf8')).toBe('exact user evidence');
		expect(await readFile(join(f.backup, 'drum-reviews', 'preserve.json'), 'utf8')).toBe('exact user evidence');
		expect(JSON.parse(await readFile(join(f.target, f.id + '.analysis.json'), 'utf8')).version).toBe(37);
	});
	it('rejects changed reviewed audio or an analysis from a different decode before publishing', async () => {
		const f = await fixture();
		await expect(publishDrumReviews(f.tracks, { ...f.options, decode: async () => ({ hash: 'other', duration: 30 }) })).rejects.toThrow('decoded full audio');
		await writeFile(join(f.target, f.id + '.m4a'), 'other audio');
		await expect(publishDrumReviews(f.tracks, { ...f.options, apply: true, backup: f.backup })).rejects.toThrow('reviewed audio');
		expect(await readFile(join(f.target, f.id + '.analysis.json'))).toEqual(f.old);
	});
	it('adds a prepared full song and refuses a reused backup directory', async () => {
		const f = await fixture(false);
		await publishDrumReviews(f.tracks, { ...f.options, apply: true, backup: f.backup });
		expect(await readFile(join(f.target, f.id + '.m4a'), 'utf8')).toBe('same encoded audio');
		expect(JSON.parse(await readFile(join(f.target, f.id + '.meta.json'), 'utf8')).id).toBe(f.id);
		await expect(publishDrumReviews(f.tracks, { ...f.options, apply: true, backup: f.backup })).rejects.toThrow();
	});
});
