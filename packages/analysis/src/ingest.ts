import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { CACHE_DIR } from './paths.ts';
import { createHash } from 'node:crypto';
import type { TrackAnalysis, TrackContext } from '@mv/core';
import { ANALYSIS_VERSION, CONTEXT_VERSION, gridTrust } from '@mv/core';
import { analyzeTrack } from './analyze.ts';
import { artworkHue } from './artwork.ts';
import { decodeAudio, downloadAudio, probe, resamplePcm, type ProbeResult } from './decode.ts';
import { enrichTrack } from './enrich.ts';
import { mapGenres } from './genreMap.ts';
import { handMapGrid, type DrawingGrid } from './gridedits.ts';
import { handMapFingerprint, type HandSection } from './handSections.ts';
import { medianPeriod } from './metricalLevel.ts';
import { KICK_CLAIMING_FAMILIES, familyCorroborated, loudKickRate } from './vocabulary.ts';
import { readDrumEvidence, writeDrumEvidence } from './drumEvidenceCache.ts';
import { onsetsBeside, preludeBeside } from './dsp.ts';
import type { SeparatedDrumAudio, SourceOnsets } from './separatedDrums.ts';

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const LOCAL_ID = /^file-[a-f0-9]{12}$/;

export function isValidId(id: string): boolean {
	return YT_ID.test(id) || LOCAL_ID.test(id);
}

function assertId(id: string): void {
	if (!isValidId(id)) throw new Error(`Invalid track id: ${id}`);
}

export function analysisPath(id: string): string {
	assertId(id);
	return join(CACHE_DIR, `${id}.analysis.json`);
}

export function showPath(id: string): string {
	assertId(id);
	return join(CACHE_DIR, `${id}.show.json`);
}

function metaPath(id: string): string {
	assertId(id);
	return join(CACHE_DIR, `${id}.meta.json`);
}

export function contextPath(id: string): string {
	assertId(id);
	return join(CACHE_DIR, `${id}.context.json`);
}

export async function readContext(id: string): Promise<TrackContext | null> {
	try {
		return JSON.parse(await readFile(contextPath(id), 'utf8')) as TrackContext;
	} catch {
		return null;
	}
}

/** Presentation metadata, kept out of TrackAnalysis, which is analysis only. */
export interface TrackMeta {
	id: string;
	title: string;
	uploader: string;
	thumbnail: string;
	webpageUrl: string;
	source: string;
	/** Seconds, cached here so library rows need not open large analysis blobs. */
	duration?: number;
	/** Cover hue in degrees, or null. Keep with artwork metadata so reanalysis need not fetch the image. */
	artHue?: number | null;
	/** Cached lounge-routing verdict. Absent means trusted for legacy analyses. */
	gridTrust?: { trusted: boolean; reasons: string[] };
	/** Listener override survives reanalysis while the grid evidence refreshes. */
	gridTrustOverride?: true;
}

/** Persist trust override on track metadata so pruning and requeueing cannot erase it. */
export async function markGridTrusted(id: string): Promise<void> {
	const meta = await readMeta(id);
	if (!meta) return;
	meta.gridTrustOverride = true;
	await writeFile(metaPath(id), JSON.stringify(meta, null, '\t'));
}

export async function readMeta(id: string): Promise<TrackMeta | null> {
	try {
		return JSON.parse(await readFile(metaPath(id), 'utf8')) as TrackMeta;
	} catch {
		return null;
	}
}

/** Read raw marks separately from interpretation so cache invalidation can detect any map change. */
async function readHandMap(
	id: string
): Promise<{
	sections: HandSection[];
	movements: number[];
	movementVetoes: number[];
	pinnedHash: string | null;
} | null> {
	try {
		const raw = await readFile(join(CACHE_DIR, 'judge', `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`), 'utf8');
		const j = JSON.parse(raw) as {
			sections?: { kind?: string; startTime: number; offGrid?: boolean }[] | null;
			movements?: number[] | null;
			movementVetoes?: number[] | null;
			analysisHash?: string | null;
		};
		const sections = j.sections ?? [];
		const seconds = (xs: number[] | null | undefined) =>
			(xs ?? []).filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b);
		const movements = seconds(j.movements);
		const movementVetoes = seconds(j.movementVetoes);
		// Any mark is worth a read on its own: a track can be one song drawn in detail, three
		// songs with nothing drawn yet, or one song the analyser wrongly split.
		if (sections.length < 2 && movements.length === 0 && movementVetoes.length === 0) return null;
		return {
			sections: sections.map((s) => ({
				kind: s.kind ?? 'groove',
				startTime: s.startTime,
				offGrid: s.offGrid === true
			})),
			movements,
			movementVetoes,
			pinnedHash: j.analysisHash ?? null
		};
	} catch {
		return null;
	}
}

/** Cache stamp includes section and movement marks because either changes analysis. */
async function handMapStamp(id: string): Promise<string | undefined> {
	const map = await readHandMap(id);
	if (!map) return undefined;
	const list = (xs: number[]) => xs.map((t) => Math.round(t * 100) / 100).join(',');
	const movements = list(map.movements);
	const vetoes = list(map.movementVetoes);
	return `${handMapFingerprint(map.sections)}${movements ? `;movements=${movements}` : ''}${vetoes ? `;vetoes=${vetoes}` : ''}`;
}

/**
 * Read optional judgement data with the analysis it was drawn on before overwriting the cache.
 * The pinned analysisHash guards the drawing grid; preserve confirmed piecewise cuts.
 * Missing or malformed judgement files mean no map.
 */
export async function handMapInput(id: string): Promise<{
	gridCuts?: number[];
	sectionMapBoundaries?: number[];
	handSections?: HandSection[];
	movements?: number[];
	movementVetoes?: number[];
}> {
	const map = await readHandMap(id);
	if (!map) return {};
	const { sections, pinnedHash } = map;
	const movements = {
		...(map.movements.length > 0 ? { movements: map.movements } : {}),
		...(map.movementVetoes.length > 0 ? { movementVetoes: map.movementVetoes } : {})
	};
	if (sections.length < 2) return movements;
	let drawnOn: DrawingGrid | null = null;
	try {
		const cached = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
		if (pinnedHash === null || cached.hash === pinnedHash) {
			drawnOn = {
				beats: cached.beats,
				barTimes: cached.tempo.barTimes,
				beatsPerBar: cached.tempo.beatsPerBar
			};
		}
	} catch {
		// No blob yet, or unreadable: the map is all there is to go on.
	}
	return {
		...handMapGrid(
			sections.slice(1).map((s) => s.startTime),
			drawnOn,
			sections.slice(1).filter((s) => s.offGrid).map((s) => s.startTime)
		),
		handSections: sections,
		...movements
	};
}

/** yt-dlp errors are paragraphs; a row has one line. */
function firstLine(message: string): string {
	const line = message.split('\n').find((l) => l.includes('ERROR')) ?? message.split('\n')[0];
	return line.replace(/^.*ERROR:\s*/, '').trim().slice(0, 90);
}

/** The cached audio for a track, whatever container yt-dlp settled on. */
export async function findAudioFile(id: string): Promise<string | null> {
	assertId(id);
	if (!existsSync(CACHE_DIR)) return null;
	const files = await readdir(CACHE_DIR);
	// Accept known audio containers only; intermediate PCM and interrupted .part/.ytdl files are not audio.
	const AUDIO = /\.(m4a|webm|opus|mp3|ogg|oga|aac|wav|flac|mp4|mka)$/i;
	const hit = files.find((f) => f.startsWith(`${id}.`) && AUDIO.test(f));
	return hit ? join(CACHE_DIR, hit) : null;
}

export interface IngestResult {
	id: string;
	audioPath: string;
	analysis: TrackAnalysis;
	meta: TrackMeta;
	/** What the free metadata says the track is. Never null, possibly empty. */
	context: TrackContext;
	fromCache: boolean;
	/** Previous cached grid, sections and punctuation still match; retained shows must also lint. */
	arrangementUnchanged?: true;
	timings?: { totalMs: number; stagesMs: Record<string, number>; drumEvidenceCacheHit: boolean;
		drumProviders?: Record<string, string> };
}

function sameArrangementLayout(previous: TrackAnalysis | null, analysis: TrackAnalysis): boolean {
	if (!previous || previous.hash !== analysis.hash || !Array.isArray(previous.tempo?.barTimes)
		|| !Array.isArray(previous.beats) || !Array.isArray(previous.sections)
		|| !Array.isArray(previous.bars) || previous.bars.some((bar) => !bar || typeof bar !== 'object')
		|| !Array.isArray(previous.moments)) return false;
	const layout = (a: TrackAnalysis) => [a.duration, a.tempo, a.beats, a.sections, a.movements,
		a.bars.map((bar) => [bar.bar, bar.t, bar.section, bar.events]), a.moments];
	return JSON.stringify(layout(previous)) === JSON.stringify(layout(analysis));
}

/**
 * Classify the middle of the track so a long intro does not dominate genre. Audio may outvote
 * artist metadata; uncertainty or failure retains the original context.
 */
export async function refineGenreFromAudio(
	context: TrackContext,
	mono22k: Float32Array,
	sampleRate: number
): Promise<TrackContext | null> {
	const top = await classifyAudioGenre(mono22k, sampleRate);
	return top && applyAudioGenre(context, top);
}

type GenreScores = { label: string; score: number }[];

async function classifyAudioGenre(mono22k: Float32Array, sampleRate: number): Promise<GenreScores | null> {
	try {
		const { GenreClassifier, ensureGenreModel, genreModelPresent } = await import('./genreModel.ts');
		if (!genreModelPresent()) await ensureGenreModel();
		const model = await GenreClassifier.create();
		try {
			const window = Math.min(mono22k.length, 180 * sampleRate);
			const start = Math.max(0, Math.floor((mono22k.length - window) / 2));
			return (await model.run(mono22k.subarray(start, start + window))).top;
		} finally {
			await model.close();
		}
	} catch {
		// Null says the model never spoke, which is different from having nothing to add:
		// only an actual run earns the cache marker that stops future attempts.
		return null;
	}
}

function applyAudioGenre(context: TrackContext, top: GenreScores): TrackContext {
	// Drop the Electronic parent because it obscures specific styles; retain informative parents
	// and weight votes by activation.
	const leading = top.slice(0, 5);
	const vote = mapGenres(
		leading.map((t) => t.label.replace(/^Electronic---/, '').replace('---', ' ')),
		leading.map((t) => t.score)
	);
	const confident = (top[0]?.score ?? 0) >= 0.15 && vote.family !== null;
	if (!confident || vote.family === context.genreFamily) return context;
	return {
		...context,
		genreFamily: vote.family,
		genreConfidence: Math.round(vote.confidence * 100) / 100,
		audioGenres: top.slice(0, 3).map((t) => t.label.replace('---', ' ')),
		sources: [...context.sources, 'effnet']
	};
}

/**
 * After analysis, remove genre families whose kick claim the loud-bar rate contradicts.
 * Re-vote the same labels and persist the correction. Analysis already gates club privileges
 * on that kick evidence, so changing the family cannot invalidate its vocabulary.
 */
export function correctGenreFamily(
	context: TrackContext,
	analysis: TrackAnalysis
): TrackContext | null {
	const kicks = Int32Array.from(analysis.bars, (b) => b.kicks);
	const energy = Float32Array.from(analysis.bars, (b) => b.energy);
	const rate = loudKickRate(kicks, energy, analysis.tempo.beatsPerBar);
	if (familyCorroborated(context.genreFamily, rate)) return null;
	const vote = mapGenres(
		[...(context.audioGenres ?? []), ...context.genres],
		undefined,
		KICK_CLAIMING_FAMILIES
	);
	if (vote.family === null || vote.family === context.genreFamily) return null;
	return {
		...context,
		genreFamily: vote.family,
		genreConfidence: Math.round(vote.confidence * 100) / 100
	};
}

/**
 * Return a corroborated metrical ratio or null. Genre gates respect catalogue notation:
 * hip-hop/RnB may publish the hat count, and slow families must not be doubled into a wrong pulse.
 */
export function publishedLevel(
	beats: readonly number[],
	publishedBpm: number,
	genreFamily?: string | null,
	/** Optional model downbeats and snares let the backbeat disambiguate catalogue tempo octaves. */
	kit?: { downbeats?: readonly number[]; snares?: readonly number[] }
): number | null {
	if (genreFamily === 'hiphop' || genreFamily === 'rnb') return null;
	const period = medianPeriod(beats);
	if (!(period > 1e-6) || !(publishedBpm >= 50) || publishedBpm > 220) return null;
	const detected = 60 / period;
	for (const r of [1, 2, 0.5, 1.5, 2 / 3, 3, 1 / 3]) {
		if (Math.abs(detected * r - publishedBpm) / publishedBpm < 0.035) {
			if (r === 1) return null;
			// Metal is listed at its double-time drums: Stranded is published at 184.6, the
			// model hears its 92 bpm riff, and the owner's map runs in whole bars of 2.6 s.
			// Punk that really plays at 186 (American Idiot) the model tracks there itself.
			if (r > 1 && (genreFamily === 'ballad' || genreFamily === 'ambient' || genreFamily === 'metal')) return null;
			// Check the faster grid for snares on beats two/four. A backbeat there supports doubling and
			// rejects halving; its absence supports the converse.
			if ((r === 2 || r === 0.5) && kit?.downbeats && kit.snares) {
				const share = backbeatShare(beats, r === 2 ? 2 : 1, kit.downbeats, kit.snares);
				if (share !== null && (r === 2 ? share < BACKBEAT_SHARE : share >= BACKBEAT_SHARE)) return null;
			}
			return r;
		}
	}
	return null;
}

/** Under this share of snares on beats two and four, the grid is not at the backbeat's level. */
const BACKBEAT_SHARE = 0.5;
/** Fewer snares or downbeats than this cannot say where the backbeat is. */
const BACKBEAT_MIN_SNARES = 24;
const BACKBEAT_MIN_DOWNBEATS = 8;

/**
 * Snare share on beats two/four at mult times tracked tempo, using model downbeat phase.
 * Null when kit evidence is insufficient.
 */
function backbeatShare(
	beats: readonly number[],
	mult: 1 | 2,
	downbeats: readonly number[],
	snares: readonly number[]
): number | null {
	if (beats.length < 8 || snares.length < BACKBEAT_MIN_SNARES || downbeats.length < BACKBEAT_MIN_DOWNBEATS) return null;
	const last = beats.length - 1;
	const indexAt = (t: number): number | null => {
		if (t < beats[0] || t > beats[last]) return null;
		let lo = 0;
		let hi = last;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (beats[mid] <= t) lo = mid;
			else hi = mid;
		}
		const span = beats[hi] - beats[lo];
		const frac = span > 1e-6 ? (t - beats[lo]) / span : 0;
		return Math.round(mult * (lo + frac));
	};
	const votes = new Int32Array(4);
	for (const d of downbeats) {
		const i = indexAt(d);
		if (i !== null) votes[i % 4]++;
	}
	let phase = 0;
	for (let k = 1; k < 4; k++) if (votes[k] > votes[phase]) phase = k;
	let onBackbeat = 0;
	let counted = 0;
	for (const t of snares) {
		const i = indexAt(t);
		if (i === null) continue;
		counted++;
		const position = (((i - phase) % 4) + 4) % 4;
		if (position === 1 || position === 3) onBackbeat++;
	}
	return counted >= BACKBEAT_MIN_SNARES ? onBackbeat / counted : null;
}

/**
 * Known stages are typed for exhaustive queue-status mapping. Free-text notes share the
 * progress channel without changing the current stage.
 */
export type IngestStage =
	| 'resolving'
	| 'downloading'
	| 'looking the track up'
	| 'cached'
	| 'decoding'
	| 'tracking beats'
	| 'transcribing drums'
	| 'separating drums'
	| 'analysing';

export interface IngestOptions {
	/** Reuse this queue track's saved audio and identity before resolving its original source. */
	cachedTrackId?: string;
	/** Re-analyse even when a current cached analysis exists. */
	force?: boolean;
	/** Metrical multiplier: 2 doubles, 0.5 halves, 1.5 reads three for two. Implies force. */
	metricalLevel?: number;
	/** Prefer caller-supplied square cover art; yt-dlp stills may contain pillarbox fill that biases hue. */
	artwork?: string;
	onProgress?: (stage: IngestStage | (string & {})) => void;
}

/** A YouTube URL or a local audio file path. */
export async function ingest(source: string, opts: IngestOptions = {}): Promise<IngestResult> {
	const log = opts.onProgress ?? (() => {});
	const started = performance.now();
	const stagesMs: Record<string, number> = {};
	await mkdir(CACHE_DIR, { recursive: true });

	let id: string;
	let title: string;
	let audioPath: string | null;
	let meta: TrackMeta;
	let probed: ProbeResult | null = null;
	let saved: TrackMeta | null = null;
	let savedAudio: string | null = null;
	if (opts.cachedTrackId) {
		const path = metaPath(opts.cachedTrackId);
		if (existsSync(path)) {
			const candidate = JSON.parse(await readFile(path, 'utf8')) as TrackMeta;
			if (candidate.id !== opts.cachedTrackId || typeof candidate.source !== 'string' ||
				typeof candidate.title !== 'string') {
				throw new Error(`Invalid cached metadata for ${opts.cachedTrackId}`);
			}
			if (source === candidate.source || source === candidate.webpageUrl) {
				savedAudio = await findAudioFile(candidate.id);
				if (savedAudio) saved = candidate;
			}
		}
	}

	if (saved && savedAudio) {
		id = saved.id;
		title = saved.title;
		audioPath = savedAudio;
		meta = { ...saved, thumbnail: opts.artwork || saved.thumbnail };
	} else if (/^https?:\/\//.test(source)) {
		log('resolving');
		probed = await probe(source, (n, of, why) =>
			log(`resolving - retrying (${n + 1} of ${of}): ${firstLine(why)}`)
		);
		id = probed.id;
		title = probed.title;
		assertId(id);
		meta = {
			id,
			title,
			uploader: probed.uploader,
			thumbnail: opts.artwork || probed.thumbnail,
			webpageUrl: probed.webpageUrl,
			source,
			duration: probed.duration
		};
		audioPath = await findAudioFile(id);
		if (!audioPath) {
			log('downloading');
			await downloadAudio(source, join(CACHE_DIR, `${id}.%(ext)s`), (n, of, why) =>
				log(`downloading - retrying (${n + 1} of ${of}): ${firstLine(why)}`)
			);
			audioPath = await findAudioFile(id);
			if (!audioPath) throw new Error('yt-dlp reported success but wrote no audio file');
		}
	} else {
		const original = resolve(source);
		if (!existsSync(original)) throw new Error(`No such file: ${original}`);
		const hash = createHash('sha256').update(original).digest('hex').slice(0, 12);
		id = `file-${hash}`;
		title = basename(original, extname(original));

		// Copy local audio into cache so serving and artifact ownership match downloaded tracks.
		audioPath = join(CACHE_DIR, `${id}${extname(original)}`);
		if (!existsSync(audioPath)) await copyFile(original, audioPath);

		meta = { id, title, uploader: 'Local file', thumbnail: '', webpageUrl: '', source };
	}

	// Read from the previous meta rather than re-fetched: the network is the slowest thing in
	// this function. A different image is a different hue, though, so a track re-ingested with
	// better art than it was first stored with has to measure again.
	const previous = await readMeta(id);
	const knownHue = previous?.thumbnail === meta.thumbnail ? previous.artHue : undefined;
	// Keep the saved key order; the hue replaces this placeholder before meta is written.
	meta.artHue = knownHue;
	meta.duration ??= previous?.duration;
	const metaWritten = (knownHue !== undefined ? Promise.resolve(knownHue)
		: artworkHue(meta.thumbnail).then(({ hue }) => hue ?? null)).then((hue) => {
		meta.artHue = hue;
		return writeFile(metaPath(id), JSON.stringify(meta, null, '\t'));
	});

	// Retry contexts with no successful remote lookup. The local effnet marker must not count,
	// or one offline run would permanently suppress tempo and lyric enrichment.
	const savedContext = await readContext(id);
	const enriched = (c: TrackContext) => c.sources.some((s) => s !== 'effnet');
	const stale = !savedContext || savedContext.version !== CONTEXT_VERSION || !enriched(savedContext);
	// Lookups and cover art need no audio, so they run beside it and must not overwrite its progress.
	let audioStarted = false;
	const contextReady = !stale ? Promise.resolve(savedContext) : (async () => {
		log('looking the track up');
		const fresh = await enrichTrack({
			title: meta.title,
			uploader: meta.uploader,
			duration: meta.duration ?? 0,
			webpageUrl: meta.webpageUrl || undefined,
			ytArtist: probed?.artist,
			ytTrack: probed?.track,
			channel: probed?.channel,
			tags: probed?.tags,
			onProgress: (stage) => { if (!audioStarted) log(stage); }
		});
		await writeFile(contextPath(id), JSON.stringify(fresh, null, '\t'));
		return fresh;
	})();
	const metadata = Promise.all([metaWritten, contextReady]);
	metadata.catch(() => {});

	const relevel = opts.metricalLevel !== undefined && Math.abs(opts.metricalLevel - 1) > 1e-6;
	let cached: TrackAnalysis | null = null;
	try {
		cached = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
	} catch {
		// No readable previous analysis.
	}
	if (!opts.force && !relevel) {
		// Invalidate stale versions and changed hand maps even when their JSON shape still looks compatible.
		if (cached && cached.version === ANALYSIS_VERSION && cached.handMap === (await handMapStamp(id))) {
			let [, context] = await metadata;
			log('cached');
			// Backfill legacy duration/trust metadata to avoid analysis reads for every library row.
			if (!meta.duration || !meta.gridTrust) {
				meta.duration = meta.duration || cached.duration;
				meta.gridTrust = meta.gridTrust ?? gridTrust(cached, context.publishedBpm);
				await writeFile(metaPath(id), JSON.stringify(meta, null, '\t'));
			}
			context = await settleGenreFamily(id, context, cached);
			return { id, audioPath, analysis: cached, meta, context, fromCache: true };
		}
	}

	stagesMs.sourceAndMetadata = Math.round(performance.now() - started);
	const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
		const began = performance.now();
		try {
			return await work();
		} finally {
			stagesMs[stage] = Math.round(performance.now() - began);
		}
	};
	try {
		audioStarted = true;
		log('decoding');
		const decoding = timed('decode', () => decodeAudio(audioPath));
		// Decode model drums at their training rate; upsampling the analysis PCM cannot restore lost bands.
		const wide = decodeAudio(audioPath, 44100);
		wide.catch(() => {});
		// Separation progress is the long wait; model stages report only while it is not running.
		let separating = false;
		const modelLog = (stage: string) => { if (!separating) log(stage); };

		let separatedDrums: SeparatedDrumAudio | undefined;
		let separatedOnsets: Promise<Record<'kick' | 'snare', SourceOnsets> | undefined> =
			Promise.resolve(undefined);
		let drumSeparation: string | undefined;
		let drumEvidenceCacheHit = false;
		const drumProviders: Record<string, string> = {};
		const separation = timed('separation', async () => {
			try {
				const { DrumSeparator, SEPARATION_VERSION } = await import('./separation.ts');
				const provider = process.env.MV_DRUM_PROVIDER ?? 'cpu';
				if (provider !== 'cpu' && provider !== 'dml') {
					throw new Error(`Unsupported drum provider: ${provider}`);
				}
				const arena = process.env.MV_DRUM_CPU_ARENA;
				if (arena !== undefined && arena !== 'true' && arena !== 'false') {
					throw new Error('MV_DRUM_CPU_ARENA must be true or false.');
				}
				const lanes = process.env.MV_DRUM_CPU_LANES;
				if (lanes !== undefined && !/^[1-4]$/.test(lanes)) {
					throw new Error('MV_DRUM_CPU_LANES must be 1 to 4.');
				}
				const separator = await DrumSeparator.create(undefined, {
					graphCacheDir: join(CACHE_DIR, 'separator-graphs'), provider,
					cpuArena: arena === undefined ? undefined : arena === 'true',
					lanes: lanes === undefined ? undefined : Number(lanes)
				});
				if (!separator) return;
				separating = true;
				log('separating drums');
				try {
					const audio = await wide;
					const evidenceDir = join(CACHE_DIR, 'drum-evidence');
					const evidenceKey = { audioHash: audio.hash,
						modelVersion: provider === 'cpu' ? SEPARATION_VERSION : `${SEPARATION_VERSION}:${provider}`,
						frames44k: audio.left.length };
					separatedDrums = await readDrumEvidence(evidenceDir, evidenceKey) ?? undefined;
					drumEvidenceCacheHit = separatedDrums !== undefined;
					if (separatedDrums) {
						log('Reusing separated drums');
					} else {
						const isolated = await separator.run(audio.left, audio.right, (progress) => {
							const { stage, completed, total, provider: actualProvider } = progress;
							if (actualProvider) drumProviders[stage] = actualProvider;
							const label = stage === 'drums' ? 'Isolating drums (1/2)'
								: 'Separating kicks and snares (2/2)';
							log(`${label}: ${Math.round(100 * completed / Math.max(1, total))}%`);
						});
						const [kick, snare, cymbal] = await Promise.all([
							resamplePcm(isolated.kick, isolated.sampleRate),
							resamplePcm(isolated.snare, isolated.sampleRate),
							isolated.cymbal ? resamplePcm(isolated.cymbal, isolated.sampleRate) : undefined
						]);
						separatedDrums = { kick, snare, cymbal, sampleRate: 22050 };
					}
					// Analysis waits for these onset curves, not for the cache write below.
					const { kick, snare, sampleRate } = separatedDrums;
					separatedOnsets = Promise.all([onsetsBeside(kick, sampleRate), onsetsBeside(snare, sampleRate)])
						.then(([k, s]) => k && s ? { kick: k, snare: s } : undefined);
					if (!drumEvidenceCacheHit) {
						await writeDrumEvidence(evidenceDir, evidenceKey, separatedDrums).catch(e =>
							log(`Could not cache separated drums: ${e instanceof Error ? e.message : String(e)}`));
					}
					drumSeparation = SEPARATION_VERSION;
				} finally {
					separating = false;
					await separator.close();
				}
			} catch (e) {
				log(`drum separation unavailable, falling back: ${e instanceof Error ? e.message : String(e)}`);
			}
		});

		const decoded = await decoding;
		const prelude = preludeBeside(decoded.mono, decoded.left, decoded.right, decoded.sampleRate);

		const needsGenre = stale || !savedContext.sources.includes('effnet');
		const models = (async () => {
			const genre = needsGenre
				? await timed('genre', () => classifyAudioGenre(decoded.mono, decoded.sampleRate)) : null;
			stagesMs.genre ??= 0;

			// The model finds the beats; everything after it is unchanged. If the weights are missing
			// or the graph fails, the in-repo tracker runs instead: a worse grid is a worse show, a
			// crash here is no show at all.
			const tracked = await timed('beats', async () => {
				try {
					modelLog('tracking beats');
					const { BeatThis } = await import('./beatthis.ts');
					const model = await BeatThis.create();
					try {
						return await model.run(decoded.mono);
					} finally {
						await model.close();
					}
				} catch (e) {
					log(`beat model unavailable, falling back: ${e instanceof Error ? e.message : String(e)}`);
					return null;
				}
			});

			const drums = await timed('transcription', async () => {
				try {
					const { Adtof } = await import('./adtof.ts');
					const model = await Adtof.create();
					if (!model) return undefined;
					modelLog('transcribing drums');
					try {
						return await model.run((await wide).mono);
					} finally {
						await model.close();
					}
				} catch (e) {
					log(`drum model unavailable, falling back: ${e instanceof Error ? e.message : String(e)}`);
					return undefined;
				}
			});
			return { genre, tracked, drums };
		})();

		const [{ genre, tracked, drums }] = await Promise.all([models, separation]);
		let [, context] = await metadata;
		// Record effnet only after successful classification so failures retry on later ingests.
		if (genre) {
			const refined = applyAudioGenre(context, genre);
			context = refined === context ? { ...context, sources: [...context.sources, 'effnet'] } : refined;
			await writeFile(contextPath(id), JSON.stringify(context, null, '\t'));
		}

		// Catalogue metrical corrections follow drum inference for the snare check; explicit listener
		// corrections retain precedence.
		let metricalLevel = opts.metricalLevel;
		if (metricalLevel === undefined && tracked && context.publishedBpm) {
			const level = publishedLevel(tracked.beats, context.publishedBpm, context.genreFamily, {
				downbeats: tracked.downbeats,
				snares: drums?.snare.times
			});
			if (level !== null) {
				log(`re-reading the grid at ${level}x toward a published ${context.publishedBpm} bpm`);
				metricalLevel = level;
			}
		}

		log('analysing');
		const handMap = await handMapInput(id);
		const analysis = await timed('analysis', async () => analyzeTrack({
			mono: decoded.mono,
			left: decoded.left,
			right: decoded.right,
			sampleRate: decoded.sampleRate,
			duration: decoded.duration,
			hash: decoded.hash,
			trackId: id,
			title,
			beats: tracked?.beats,
			downbeats: tracked?.downbeats,
			drums,
			separatedDrums,
			separatedOnsets: await separatedOnsets,
			prelude: await prelude,
			metricalLevel,
			context,
			...handMap
		}));

		if (drumSeparation) analysis.drumSeparation = drumSeparation;
		await timed('persistence', async () => {
			await writeFile(analysisPath(id), JSON.stringify(analysis, null, '\t'));
			// A fresh grid means a fresh verdict on it; the override, being the owner's, survives.
			meta.duration = meta.duration || analysis.duration;
			meta.gridTrust = gridTrust(analysis, context.publishedBpm);
			await writeFile(metaPath(id), JSON.stringify(meta, null, '\t'));
			context = await settleGenreFamily(id, context, analysis);
		});
		const order = ['sourceAndMetadata', 'decode', 'genre', 'beats', 'transcription', 'separation',
			'analysis', 'persistence'];
		const timings = { totalMs: Math.round(performance.now() - started),
			stagesMs: Object.fromEntries(order.filter((stage) => stage in stagesMs)
				.map((stage) => [stage, stagesMs[stage]])),
			drumEvidenceCacheHit,
			drumProviders: Object.keys(drumProviders).length ? drumProviders : undefined };
		await writeFile(join(CACHE_DIR, `${id}.preparation.json`), JSON.stringify({
			trackId: id, audioHash: analysis.hash, analysisVersion: analysis.version,
			drumSeparation, preparedAt: new Date().toISOString(), ...timings
		}, null, '\t')).catch(() => {});
		return { id, audioPath, analysis, meta, context, fromCache: false,
			timings,
			...(sameArrangementLayout(cached, analysis) ? { arrangementUnchanged: true as const } : {}) };
	} catch (error) {
		// Metadata that finished beside failed audio work is kept, as when lookups ran first.
		await metadata.catch(() => {});
		throw error;
	}
}

/** `correctGenreFamily`, persisted. Both ingest paths end here, cached blob or fresh one. */
async function settleGenreFamily(
	id: string,
	context: TrackContext,
	analysis: TrackAnalysis
): Promise<TrackContext> {
	const corrected = correctGenreFamily(context, analysis);
	if (!corrected) return context;
	await writeFile(contextPath(id), JSON.stringify(corrected, null, '\t'));
	return corrected;
}
