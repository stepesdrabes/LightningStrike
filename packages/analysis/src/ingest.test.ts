import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { ANALYSIS_VERSION, emptyContext, type TrackAnalysis } from '@mv/core';
import { analyzeTrack } from './analyze.ts';
import { decodeAudio, downloadAudio, probe } from './decode.ts';
import { artworkHue } from './artwork.ts';
import { enrichTrack } from './enrich.ts';
import { GenreClassifier } from './genreModel.ts';
import { handMapStale, ingest, type TrackMeta } from './ingest.ts';
import { Striker2, type Striker2Result } from './striker2.ts';

const cache = vi.hoisted(() => ({ dir: '' }));
vi.mock('./paths.ts', () => ({
	get CACHE_DIR() { return cache.dir; }, get MODEL_DIR() { return cache.dir; }, workerFile: () => null
}));
vi.mock('./decode.ts', () => ({ decodeAudio: vi.fn(), downloadAudio: vi.fn(), probe: vi.fn() }));
vi.mock('./analyze.ts', () => ({ analyzeTrack: vi.fn() }));
vi.mock('./artwork.ts', () => ({ artworkHue: vi.fn() }));
vi.mock('./enrich.ts', () => ({ enrichTrack: vi.fn() }));
vi.mock('./dsp.ts', () => ({ preludeBeside: vi.fn(async () => undefined) }));
vi.mock('./genreModel.ts', () => ({
	genreModelPresent: () => true, ensureGenreModel: vi.fn(),
	GenreClassifier: { create: vi.fn().mockRejectedValue(new Error('no model')) }
}));

const youtubeId = 'abcdefghijk';
const youtubeSource = `https://www.youtube.com/watch?v=${youtubeId}`;

/** The tiny Striker 2.0 export from striker-2's tools/m7_fixtures.py. */
const FIXTURE = join(import.meta.dirname, 'testdata', 'striker2');
const MODEL_NAME = JSON.parse(readFileSync(join(FIXTURE, 'striker2.json'), 'utf8')).name as string;

/** Installs the fixture model with its manifest edited. */
async function installStriker2(edit: (manifest: Record<string, any>) => void = () => {}) {
	const manifest = JSON.parse(await readFile(join(FIXTURE, 'striker2.json'), 'utf8'));
	edit(manifest);
	await copyFile(join(FIXTURE, 'striker2.onnx'), join(cache.dir, 'striker2.onnx'));
	await writeFile(join(cache.dir, 'striker2.json'), JSON.stringify(manifest));
}

async function preparation() {
	return JSON.parse(await readFile(join(cache.dir, `${youtubeId}.preparation.json`), 'utf8'));
}

function fixtureAnalysis(): TrackAnalysis {
	return {
		version: ANALYSIS_VERSION, striker: MODEL_NAME, hash: 'fixture', trackId: youtubeId, title: 'Saved track',
		duration: 160, bars: [], sections: [], beats: [], tempo: { beatsPerBar: 4 }
	} as unknown as TrackAnalysis;
}

beforeEach(async () => {
	vi.clearAllMocks();
	cache.dir = await mkdtemp(join(tmpdir(), 'lightningstrike-ingest-'));
	await installStriker2();
	vi.mocked(probe).mockRejectedValue(new Error('YouTube is unavailable'));
	vi.mocked(decodeAudio).mockResolvedValue({
		mono: new Float32Array(8), left: new Float32Array(8), right: new Float32Array(8),
		sampleRate: 22050, duration: 160, hash: 'fixture'
	});
	vi.mocked(analyzeTrack).mockImplementation((input) => ({
		...fixtureAnalysis(), trackId: input.trackId, title: input.title, hash: input.hash, striker: input.striker2.name
	}));
});

afterEach(async () => {
	vi.restoreAllMocks();
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
	it('prepares with Striker 2.0 alone, its beats and downbeats included', async () => {
		await saveTrack();
		await ingest(youtubeSource, { cachedTrackId: youtubeId, force: true });
		expect(decodeAudio).toHaveBeenCalledWith(join(cache.dir, `${youtubeId}.m4a`), 44100);
		const input = vi.mocked(analyzeTrack).mock.lastCall![0];
		expect(input.striker2).toMatchObject({ name: MODEL_NAME, drums: expect.any(Object), bass: expect.any(Object) });
		const heard = input.striker2 as Striker2Result;
		expect(input.beats).toBe(heard.beats);
		expect(input.downbeats).toBe(heard.downbeats);
		const stamp = await preparation();
		expect(stamp).toMatchObject({ striker: MODEL_NAME, striker2: { name: MODEL_NAME } });
		expect(Object.keys(stamp.stagesMs)).toEqual(['sourceAndMetadata', 'decode', 'genre', 'striker2', 'analysis', 'persistence']);
		// Eight samples are too few beats for a grid: the onset tracker reads one, and the note says so.
		expect(stamp.striker2.warnings).toContainEqual(expect.stringMatching(/^it heard \d+ beats, so the onset tracker sets the grid$/));
	});

	it.each([
		['is not installed', async () => { await rm(join(cache.dir, 'striker2.json')); },
			/^Striker 2\.0 is not installed: put striker2\.onnx and striker2\.json in /],
		['fails its hash check', () => installStriker2((m) => { m.sha256 = '0'.repeat(64); }),
			/^Striker 2\.0 cannot be used: .*SHA-256/],
		['fails on the song', async () => { vi.spyOn(Striker2, 'create').mockRejectedValueOnce(new Error('no session')); },
			/^Striker 2\.0 failed on this song: no session$/]
	])('fails the preparation visibly when Striker 2.0 %s', async (_, breakIt, message) => {
		await saveTrack();
		await breakIt();
		const progress = vi.fn();
		await expect(ingest(youtubeSource, { cachedTrackId: youtubeId, onProgress: progress })).rejects.toThrow(message);
		expect(analyzeTrack).not.toHaveBeenCalled();
		expect(progress).toHaveBeenCalledWith(expect.stringMatching(message));
		const stamp = await preparation();
		expect(stamp.error).toMatch(message);
		expect(stamp.analysisVersion).toBe(ANALYSIS_VERSION);
		const stored = JSON.parse(await readFile(join(cache.dir, `${youtubeId}.analysis.json`), 'utf8'));
		expect(stored.version).toBe(ANALYSIS_VERSION - 1);
	});

	it('prepares with Striker 2.0 Small once the settings choose it, never with the other model', async () => {
		await saveTrack(youtubeId, youtubeSource, ANALYSIS_VERSION);
		await writeFile(join(cache.dir, 'settings.json'), JSON.stringify({ analysisModel: 'striker2-small' }));
		// While Small cannot run the song keeps its analysis, and preparing it again says why.
		expect((await ingest(youtubeSource, { cachedTrackId: youtubeId })).fromCache).toBe(true);
		await expect(ingest(youtubeSource, { cachedTrackId: youtubeId, force: true })).rejects.toThrow(
			`Striker 2.0 Small is not installed: put striker2-small.onnx and striker2-small.json in ${cache.dir}.`);
		expect(analyzeTrack).not.toHaveBeenCalled();
		const manifest = JSON.parse(await readFile(join(FIXTURE, 'striker2.json'), 'utf8'));
		await copyFile(join(FIXTURE, 'striker2.onnx'), join(cache.dir, 'striker2-small.onnx'));
		await writeFile(join(cache.dir, 'striker2-small.json'),
			JSON.stringify({ ...manifest, name: 'Striker 2.0 Small (fixture)', file: 'striker2-small.onnx' }));
		const result = await ingest(youtubeSource, { cachedTrackId: youtubeId });
		expect(result.fromCache).toBe(false);
		expect(result.analysis.striker).toBe('Striker 2.0 Small (fixture)');
		expect((await preparation()).striker2).toMatchObject({ model: 'striker2-small', name: 'Striker 2.0 Small (fixture)' });
		expect((await ingest(youtubeSource, { cachedTrackId: youtubeId })).fromCache).toBe(true);
	});

	it('re-analyses songs another model made, and keeps them while no model is usable', async () => {
		await saveTrack(youtubeId, youtubeSource, ANALYSIS_VERSION);
		const reusedAfter = async (striker?: string) => {
			const analysis = { ...fixtureAnalysis(), trackId: youtubeId, striker };
			await writeFile(join(cache.dir, `${youtubeId}.analysis.json`), JSON.stringify(analysis));
			return (await ingest(youtubeSource, { cachedTrackId: youtubeId })).fromCache;
		};
		expect(await reusedAfter(MODEL_NAME)).toBe(true);
		expect(await reusedAfter('Striker 2.0 (00000000)')).toBe(false);
		expect(await reusedAfter(undefined)).toBe(false);
		await writeFile(join(cache.dir, 'striker2.json'), '{"format": "striker2-model"');
		expect(await reusedAfter('Striker 2.0 (00000000)')).toBe(true);
		await rm(join(cache.dir, 'striker2.json'));
		expect(await reusedAfter(MODEL_NAME)).toBe(true);
		await expect(reusedAfter(undefined)).rejects.toThrow('Striker 2.0 is not installed');
	});

	it('checks a published tempo octave against the snares Striker 2.0 heard', async () => {
		await saveTrack();
		const beats = Array.from({ length: 200 }, (_, i) => i * 0.8);
		const downbeats = beats.filter((_, i) => i % 4 === 0);
		const snares = beats.filter((_, i) => i % 2 === 1);
		const none = { times: [], levels: [] };
		const heard = (snare: number[]) => ({
			run: async () => ({
				name: MODEL_NAME, beats, downbeats, bass: none,
				drums: { kick: none, snare: { times: snare, levels: snare.map(() => 0.8) }, hat: none, cymbal: none, tom: none },
				activity: { drums: [], bass: [], vocals: [], other: [] }
			}),
			close: async () => {}
		}) as unknown as Striker2;
		const context = JSON.stringify({ ...emptyContext(), publishedBpm: 150, sources: ['deezer', 'effnet'] });
		await writeFile(join(cache.dir, `${youtubeId}.context.json`), context);
		// A backbeat on two and four at 75 bpm says a published 150 counts the hats; one between
		// the beats says 150 is the pulse.
		vi.spyOn(Striker2, 'create').mockResolvedValueOnce(heard(snares));
		await ingest(youtubeSource, { cachedTrackId: youtubeId, force: true });
		expect(vi.mocked(analyzeTrack).mock.lastCall![0].metricalLevel).toBeUndefined();
		vi.spyOn(Striker2, 'create').mockResolvedValueOnce(heard(beats.map((t) => t + 0.4)));
		await ingest(youtubeSource, { cachedTrackId: youtubeId, force: true });
		expect(vi.mocked(analyzeTrack).mock.lastCall![0].metricalLevel).toBe(2);
	});

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

	it('flags judgement marks the analysis has not read, movement marks included, until it reads them', async () => {
		await saveTrack(youtubeId, youtubeSource, ANALYSIS_VERSION);
		expect(await handMapStale(youtubeId)).toBe(false);
		await mkdir(join(cache.dir, 'judge'));
		const judgement = join(cache.dir, 'judge', `${youtubeId}.json`);
		await writeFile(judgement, JSON.stringify({
			analysisHash: 'another grid',
			sections: [{ kind: 'intro', startTime: 0 }, { kind: 'verse', startTime: 8 }], movements: [64]
		}));
		expect(await handMapStale(youtubeId)).toBe(true);
		expect((await ingest(youtubeSource, { cachedTrackId: youtubeId })).fromCache).toBe(false);
		expect(await handMapStale(youtubeId)).toBe(false);
		expect((await ingest(youtubeSource, { cachedTrackId: youtubeId })).fromCache).toBe(true);
		await rm(judgement);
		expect(await handMapStale(youtubeId)).toBe(true);
	});

	it('does not redo analysis when the saved version is already current', async () => {
		await saveTrack(youtubeId, youtubeSource, ANALYSIS_VERSION);
		const result = await ingest(youtubeSource, { cachedTrackId: youtubeId });
		expect(result.fromCache).toBe(true);
		expect(decodeAudio).not.toHaveBeenCalled();
		expect(probe).not.toHaveBeenCalled();
	});

	it('asks the audio model again when a cached track gets a rebuilt context', async () => {
		await saveTrack(youtubeId, youtubeSource, ANALYSIS_VERSION);
		const outdated = { ...emptyContext(), version: 0, sources: ['itunes', 'effnet'], genreFamily: 'ambient' };
		await writeFile(join(cache.dir, `${youtubeId}.context.json`), JSON.stringify(outdated));
		vi.mocked(enrichTrack).mockResolvedValueOnce({ ...emptyContext(), sources: ['itunes'] });
		vi.mocked(GenreClassifier.create).mockResolvedValueOnce({
			run: vi.fn(async () => ({ top: [{ label: 'Electronic---Ambient', score: 0.6 }] })), close: vi.fn()
		} as unknown as GenreClassifier);
		const result = await ingest(youtubeSource, { cachedTrackId: youtubeId });
		expect(result.fromCache).toBe(true);
		expect(analyzeTrack).not.toHaveBeenCalled();
		expect(result.context).toMatchObject({ genreFamily: 'ambient', sources: ['itunes', 'effnet'] });
		const stored = JSON.parse(await readFile(join(cache.dir, `${youtubeId}.context.json`), 'utf8'));
		expect(stored).toMatchObject({ genreFamily: 'ambient', sources: ['itunes', 'effnet'] });
	});

	it('keeps a cached track playable when its audio cannot be decoded for the genre vote', async () => {
		await saveTrack(youtubeId, youtubeSource, ANALYSIS_VERSION);
		await writeFile(join(cache.dir, `${youtubeId}.context.json`), JSON.stringify({ ...emptyContext(), version: 0 }));
		vi.mocked(enrichTrack).mockResolvedValueOnce({ ...emptyContext(), sources: ['itunes'] });
		vi.mocked(decodeAudio).mockRejectedValueOnce(new Error('ffmpeg: invalid audio data'));
		const result = await ingest(youtubeSource, { cachedTrackId: youtubeId });
		expect(decodeAudio).toHaveBeenCalled();
		expect(result.fromCache).toBe(true);
		expect(result.context.sources).toEqual(['itunes']);
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

	it('decodes audio while catalogue lookups are still running and keeps their result', async () => {
		await saveTrack();
		const unenriched = JSON.stringify({ ...emptyContext(), sources: [] });
		await writeFile(join(cache.dir, `${youtubeId}.context.json`), unenriched);
		let decodeStarted!: () => void;
		const decoding = new Promise<void>((resolve) => { decodeStarted = resolve; });
		const fallback = vi.mocked(decodeAudio).getMockImplementation();
		vi.mocked(decodeAudio).mockImplementationOnce(async (...args) => {
			decodeStarted();
			return fallback!(...args);
		});
		vi.mocked(enrichTrack).mockImplementationOnce(async () => {
			await decoding;
			return { ...emptyContext(), publishedBpm: 124, sources: ['deezer'] };
		});
		const result = await ingest(youtubeSource, { cachedTrackId: youtubeId });
		expect(result.context.publishedBpm).toBe(124);
		expect(analyzeTrack).toHaveBeenCalledWith(expect.objectContaining({
			context: expect.objectContaining({ publishedBpm: 124 })
		}));
		const stored = JSON.parse(await readFile(join(cache.dir, `${youtubeId}.context.json`), 'utf8'));
		expect(stored.publishedBpm).toBe(124);
	});

	it('keeps finished lookups when the audio cannot be decoded', async () => {
		await saveTrack();
		const unenriched = JSON.stringify({ ...emptyContext(), sources: [] });
		await writeFile(join(cache.dir, `${youtubeId}.context.json`), unenriched);
		vi.mocked(decodeAudio).mockRejectedValueOnce(new Error('ffmpeg: invalid audio data'));
		vi.mocked(enrichTrack).mockImplementationOnce(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return { ...emptyContext(), sources: ['itunes'] };
		});
		await expect(ingest(youtubeSource, { cachedTrackId: youtubeId })).rejects.toThrow('invalid audio data');
		const stored = JSON.parse(await readFile(join(cache.dir, `${youtubeId}.context.json`), 'utf8'));
		expect(stored.sources).toEqual(['itunes']);
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
