import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ANALYSIS_VERSION, emptyContext, type TrackAnalysis } from '@mv/core';
import { analyzeTrack } from './analyze.ts';
import { decodeAudio, downloadAudio, probe } from './decode.ts';
import { artworkHue } from './artwork.ts';
import { ingest, type TrackMeta } from './ingest.ts';

const cache = vi.hoisted(() => ({ dir: '' }));
vi.mock('./paths.ts', () => ({ get CACHE_DIR() { return cache.dir; } }));
vi.mock('./decode.ts', () => ({ decodeAudio: vi.fn(), downloadAudio: vi.fn(), probe: vi.fn() }));
vi.mock('./analyze.ts', () => ({ analyzeTrack: vi.fn() }));
vi.mock('./artwork.ts', () => ({ artworkHue: vi.fn() }));
vi.mock('./beatthis.ts', () => ({ BeatThis: { create: vi.fn().mockRejectedValue(new Error('no model')) } }));
vi.mock('./adtof.ts', () => ({ Adtof: { create: vi.fn().mockResolvedValue(null) } }));

const youtubeId = 'abcdefghijk';
const youtubeSource = `https://www.youtube.com/watch?v=${youtubeId}`;

function fixtureAnalysis(): TrackAnalysis {
	return {
		version: ANALYSIS_VERSION, hash: 'fixture', trackId: youtubeId, title: 'Saved track',
		duration: 160, bars: [], sections: [], beats: [], tempo: { beatsPerBar: 4 }
	} as unknown as TrackAnalysis;
}

beforeEach(async () => {
	vi.clearAllMocks();
	cache.dir = await mkdtemp(join(tmpdir(), 'lightningstrike-ingest-'));
	vi.mocked(probe).mockRejectedValue(new Error('YouTube is unavailable'));
	vi.mocked(decodeAudio).mockResolvedValue({
		mono: new Float32Array(8), left: new Float32Array(8), right: new Float32Array(8),
		sampleRate: 22050, duration: 160, hash: 'fixture'
	});
	vi.mocked(analyzeTrack).mockImplementation((input) => ({
		...fixtureAnalysis(), trackId: input.trackId, title: input.title, hash: input.hash
	}));
});

afterEach(async () => {
	await rm(cache.dir, { recursive: true, force: true });
});

async function saveTrack(id = youtubeId, source = youtubeSource, version = ANALYSIS_VERSION - 1) {
	const meta: TrackMeta = {
		id, source, title: 'Saved track', uploader: 'Saved artist', thumbnail: 'saved-cover',
		webpageUrl: source, duration: 160, artHue: 150, gridTrustOverride: true
	};
	const analysis = { ...fixtureAnalysis(), trackId: id, version };
	const context = { ...emptyContext(), sources: ['ytmeta', 'effnet'] };
	await Promise.all([
		writeFile(join(cache.dir, `${id}.meta.json`), JSON.stringify(meta)),
		writeFile(join(cache.dir, `${id}.analysis.json`), JSON.stringify(analysis)),
		writeFile(join(cache.dir, `${id}.context.json`), JSON.stringify(context)),
		writeFile(join(cache.dir, `${id}.m4a`), 'cached audio')
	]);
	return meta;
}

describe('queue cache refresh', () => {
	it('reports compatible arrangement inputs across fresh analysis without persisting that verdict', async () => {
		await saveTrack();
		const fresh = { ...fixtureAnalysis(), tempo: { ...fixtureAnalysis().tempo, barTimes: [0, 160] }, moments: [] };
		await writeFile(join(cache.dir, `${youtubeId}.analysis.json`), JSON.stringify({ ...fresh, version: ANALYSIS_VERSION - 1 }));
		vi.mocked(analyzeTrack).mockReturnValue(fresh);
		const result = await ingest(youtubeSource, { cachedTrackId: youtubeId, force: true });
		expect(result.fromCache).toBe(false);
		expect(result.arrangementUnchanged).toBe(true);
		const stored = JSON.parse(await readFile(join(cache.dir, `${youtubeId}.analysis.json`), 'utf8'));
		expect(stored.arrangementUnchanged).toBeUndefined();
	});

	it.each(['grid', 'sections', 'punctuation', 'malformed'] as const)('does not retain an arrangement after %s inputs change', async (kind) => {
		await saveTrack();
		const fresh = { ...fixtureAnalysis(), tempo: { ...fixtureAnalysis().tempo, barTimes: [0, 160] }, moments: [] };
		const previous = JSON.parse(JSON.stringify({ ...fresh, version: ANALYSIS_VERSION - 1 }));
		if (kind === 'grid') previous.tempo.barTimes[1] = 159;
		if (kind === 'sections') previous.sections = [{ kind: 'intro', startBar: 0, endBar: 1 }];
		if (kind === 'punctuation') previous.moments = [{ kind: 'crash', bar: 0 }];
		if (kind === 'malformed') previous.bars = [null];
		await writeFile(join(cache.dir, `${youtubeId}.analysis.json`), JSON.stringify(previous));
		vi.mocked(analyzeTrack).mockReturnValue(fresh);
		const result = await ingest(youtubeSource, { cachedTrackId: youtubeId });
		expect(result.arrangementUnchanged).toBeUndefined();
	});

	it('reanalyses downloaded audio without resolving an unavailable YouTube source', async () => {
		await saveTrack();
		const result = await ingest(youtubeSource, { cachedTrackId: youtubeId });
		expect(result.fromCache).toBe(false);
		expect(result.analysis.version).toBe(ANALYSIS_VERSION);
		expect(decodeAudio).toHaveBeenCalledWith(join(cache.dir, `${youtubeId}.m4a`));
		expect(probe).not.toHaveBeenCalled();
		expect(downloadAudio).not.toHaveBeenCalled();
		expect(artworkHue).not.toHaveBeenCalled();
		expect(result.meta).toMatchObject({ title: 'Saved track', artHue: 150, gridTrustOverride: true });
		const stored = JSON.parse(await readFile(join(cache.dir, `${youtubeId}.analysis.json`), 'utf8'));
		expect(stored.version).toBe(ANALYSIS_VERSION);
		const meta = JSON.parse(await readFile(join(cache.dir, `${youtubeId}.meta.json`), 'utf8'));
		expect(meta.gridTrustOverride).toBe(true);
	});

	it('refreshes an imported track after its original file has moved', async () => {
		const source = join(cache.dir, 'original-no-longer-here.wav');
		const id = `file-${createHash('sha256').update(source).digest('hex').slice(0, 12)}`;
		await saveTrack(id, source);
		const result = await ingest(source, { cachedTrackId: id });
		expect(result.id).toBe(id);
		expect(result.analysis.version).toBe(ANALYSIS_VERSION);
		expect(result.fromCache).toBe(false);
		expect(decodeAudio).toHaveBeenCalledWith(join(cache.dir, `${id}.m4a`));
		await expect(ingest(source)).rejects.toThrow('No such file');
	});

	it('reapplies listener section edits and leaves saved shows and settings untouched', async () => {
		await saveTrack();
		const analysisFile = join(cache.dir, `${youtubeId}.analysis.json`);
		const saved = JSON.parse(await readFile(analysisFile, 'utf8')) as TrackAnalysis;
		saved.beats = Array.from({ length: 320 }, (_, i) => i * 0.5);
		saved.tempo.barTimes = Array.from({ length: 81 }, (_, i) => i * 2);
		await writeFile(analysisFile, JSON.stringify(saved));
		await mkdir(join(cache.dir, 'judge'));
		const artifacts = [
			[join(cache.dir, 'judge', `${youtubeId}.json`), JSON.stringify({
				analysisHash: saved.hash,
				sections: [{ kind: 'intro', startTime: 0 }, { kind: 'verse', startTime: 8 }],
				movements: [64], movementVetoes: [100]
			})],
			[join(cache.dir, `${youtubeId}.show.json`), '{"seed":7654321,"saved":"owner choice"}'],
			[join(cache.dir, 'settings.json'), '{"outputBrightness":0.61,"outputOffsetMs":17}']
		];
		for (const [path, body] of artifacts) await writeFile(path, body);
		await ingest(youtubeSource, { cachedTrackId: youtubeId });
		expect(analyzeTrack).toHaveBeenCalledWith(expect.objectContaining({
			handSections: [
				{ kind: 'intro', startTime: 0, offGrid: false },
				{ kind: 'verse', startTime: 8, offGrid: false }
			],
			movements: [64], movementVetoes: [100]
		}));
		for (const [path, body] of artifacts) expect(await readFile(path, 'utf8')).toBe(body);
	});

	it('does not redo analysis when the saved version is already current', async () => {
		await saveTrack(youtubeId, youtubeSource, ANALYSIS_VERSION);
		const result = await ingest(youtubeSource, { cachedTrackId: youtubeId });
		expect(result.fromCache).toBe(true);
		expect(decodeAudio).not.toHaveBeenCalled();
		expect(probe).not.toHaveBeenCalled();
	});

	it('keeps explicit source ingest on its original resolution path', async () => {
		await saveTrack();
		await expect(ingest(youtubeSource, { force: true })).rejects.toThrow('YouTube is unavailable');
		expect(probe).toHaveBeenCalled();
		expect(decodeAudio).not.toHaveBeenCalled();
	});

	it('does not use another saved track for an unrelated source', async () => {
		await saveTrack();
		await expect(ingest('https://www.youtube.com/watch?v=othertrack1', {
			cachedTrackId: youtubeId
		})).rejects.toThrow('YouTube is unavailable');
		expect(probe).toHaveBeenCalled();
		expect(decodeAudio).not.toHaveBeenCalled();
	});

	it('resolves normally when the known track has no cache yet', async () => {
		await expect(ingest(youtubeSource, { cachedTrackId: youtubeId })).rejects.toThrow('YouTube is unavailable');
		expect(probe).toHaveBeenCalled();
	});

	it('does not report missing cached audio as a prepared track', async () => {
		await saveTrack();
		await rm(join(cache.dir, `${youtubeId}.m4a`));
		await expect(ingest(youtubeSource, { cachedTrackId: youtubeId })).rejects.toThrow('YouTube is unavailable');
		expect(probe).toHaveBeenCalled();
		expect(analyzeTrack).not.toHaveBeenCalled();
	});

	it('reports corrupt audio and leaves the old analysis available', async () => {
		await saveTrack();
		vi.mocked(decodeAudio).mockRejectedValueOnce(new Error('ffmpeg: invalid audio data'));
		await expect(ingest(youtubeSource, { cachedTrackId: youtubeId })).rejects.toThrow('invalid audio data');
		expect(probe).not.toHaveBeenCalled();
		const stored = JSON.parse(await readFile(join(cache.dir, `${youtubeId}.analysis.json`), 'utf8'));
		expect(stored.version).toBe(ANALYSIS_VERSION - 1);
	});

	it('reports malformed metadata without silently resolving a replacement', async () => {
		await saveTrack();
		const path = join(cache.dir, `${youtubeId}.meta.json`);
		await writeFile(path, '{broken');
		await expect(ingest(youtubeSource, { cachedTrackId: youtubeId })).rejects.toThrow();
		expect(await readFile(path, 'utf8')).toBe('{broken');
		expect(probe).not.toHaveBeenCalled();
	});

	it('rejects an invalid cache path or a mismatched metadata ID', async () => {
		await expect(ingest(youtubeSource, { cachedTrackId: '../outside' })).rejects.toThrow('Invalid track id');
		const meta = await saveTrack();
		await writeFile(join(cache.dir, `${youtubeId}.meta.json`), JSON.stringify({ ...meta, id: 'othertrack1' }));
		await expect(ingest(youtubeSource, { cachedTrackId: youtubeId })).rejects.toThrow('Invalid cached metadata');
		expect(probe).not.toHaveBeenCalled();
		expect(decodeAudio).not.toHaveBeenCalled();
	});
});
