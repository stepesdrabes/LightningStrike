import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDrumEvidence, writeDrumEvidence } from './drumEvidenceCache.ts';

let root: string;
const key = { audioHash: 'audio-one', modelVersion: 'separator-v3', frames44k: 8 };
const sources = { sampleRate: 22050, kick: new Float32Array([0, .1, -.2, 0]),
	snare: new Float32Array([0, .000001, -.000002, 0]), cymbal: new Float32Array([0, .3, -.4, 0]) };
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'drum-evidence-')); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe('reusable drum evidence', () => {
	it('preserves even tiny source residues exactly and distinguishes audio/model revisions', async () => {
		await writeDrumEvidence(root, key, sources);
		expect(await readDrumEvidence(root, key)).toEqual(sources);
		expect(await readDrumEvidence(root, { ...key, audioHash: 'audio-two' })).toBeNull();
		expect(await readDrumEvidence(root, { ...key, modelVersion: 'separator-v4' })).toBeNull();
		expect(await readDrumEvidence(root, { ...key, frames44k: 9 })).toBeNull();
	});
	it('discards corrupted or truncated payloads', async () => {
		await writeDrumEvidence(root, key, sources);
		const path = join(root, (await readdir(root))[0]);
		const file = await readFile(path);
		file[file.length - 1] ^= 1;
		await writeFile(path, file);
		expect(await readDrumEvidence(root, key)).toBeNull();
		await writeFile(path, file.subarray(0, 7));
		expect(await readDrumEvidence(root, key)).toBeNull();
	});
	it('prunes old evidence within its budget without touching unrelated user files', async () => {
		await writeFile(join(root, 'settings.json'), '{"keep":true}');
		await writeDrumEvidence(root, key, sources);
		const first = (await readdir(root)).find(name => name.endsWith('.drums'))!;
		const oldPath = join(root, first);
		const size = (await readFile(oldPath)).length;
		await utimes(oldPath, new Date(0), new Date(0));
		const next = { ...key, audioHash: 'audio-two' };
		await writeDrumEvidence(root, next, sources, size + 10);
		expect(await readDrumEvidence(root, key)).toBeNull();
		expect(await readDrumEvidence(root, next)).toEqual(sources);
		expect(await readFile(join(root, 'settings.json'), 'utf8')).toBe('{"keep":true}');
	});
	it('does not cache malformed source lengths, nonfinite PCM, or oversized entries', async () => {
		await writeDrumEvidence(root, key, { ...sources, cymbal: new Float32Array([1]) });
		await writeDrumEvidence(root, key, { ...sources, kick: new Float32Array([0, NaN, 0, 0]) });
		await writeDrumEvidence(root, key, sources, 8);
		expect(await readdir(root)).toEqual([]);
	});
	it('removes interrupted writes only when their owning process is gone', async () => {
		const prefix = 'a'.repeat(64) + '.drums.';
		const suffix = '.12345678-1234-1234-1234-123456789abc.tmp';
		const names = [prefix + '1001' + suffix, prefix + '1002' + suffix,
			prefix + '1003' + suffix, 'user-notes.tmp'];
		for (const name of names) await writeFile(join(root, name), 'keep unless interrupted');
		const probe = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
			expect(signal).toBe(0);
			if (pid === 1001) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
			if (pid === 1003) throw Object.assign(new Error('unavailable'), { code: 'EPERM' });
			return true;
		});
		await writeDrumEvidence(root, key, sources);
		const remaining = await readdir(root);
		expect(remaining).not.toContain(names[0]);
		for (const name of names.slice(1)) expect(remaining).toContain(name);
		expect(probe).toHaveBeenCalledTimes(3);
		expect(await readDrumEvidence(root, key)).toEqual(sources);
	});
});
