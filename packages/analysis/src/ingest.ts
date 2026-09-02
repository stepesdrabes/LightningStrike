import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { CACHE_DIR } from './paths.ts';
import { createHash } from 'node:crypto';
import type { TrackAnalysis, TrackContext } from '@mv/core';
import { ANALYSIS_VERSION, CONTEXT_VERSION, gridTrust } from '@mv/core';
import { analyzeTrack } from './analyze.ts';
import { artworkHue } from './artwork.ts';
import { decodeAudio, downloadAudio, probe, type ProbeResult } from './decode.ts';
import { enrichTrack } from './enrich.ts';
import { mapGenres } from './genreMap.ts';
import { handMapGrid, type DrawingGrid } from './gridedits.ts';
import { handMapFingerprint, type HandSection } from './handSections.ts';
import { medianPeriod } from './metricalLevel.ts';
import { KICK_CLAIMING_FAMILIES, familyCorroborated, loudKickRate } from './vocabulary.ts';

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
	/**
	 * Seconds. Held here so a list of the cache can show run times without opening the
	 * analyses, which are around 400 kB each and would be tens of megabytes for one panel.
	 */
	duration?: number;
	/**
	 * Dominant hue of the cover, degrees, or null when it has no colour worth taking. Cached
	 * here because it is a property of the artwork rather than of the audio, so re-analysing
	 * the track should not re-download the image.
	 */
	artHue?: number | null;
	/**
	 * Whether the analysed grid deserves its authored show, held here so the queue can read
	 * it without opening a 400 kB analysis per row. A track this says not to trust runs in
	 * the lounge scenes instead; absent means trusted (analysed before the verdict existed).
	 */
	gridTrust?: { trusted: boolean; reasons: string[] };
	/**
	 * The owner overrode the verdict from the queue: run the authored show regardless. Kept
	 * beside the verdict so a re-analysis refreshes the evidence without erasing the answer.
	 */
	gridTrustOverride?: true;
}

/**
 * The owner's word beats the verdict: run this track's authored show from now on, whatever
 * the analyser thinks of its grid. On the meta rather than the queue row, so the answer
 * survives the row being pruned and the track being queued again next month.
 */
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

/**
 * The map itself, and the grid it was drawn on, or null when this track carries no map.
 * Separate from the reading below because the cached-analysis path needs only to ask whether
 * the map has changed, which must not depend on interpreting it.
 */
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

/**
 * What a cached analysis must carry to count as having heard this track's current marks -
 * the map and the movements together, since either changes what the analysis would be.
 */
async function handMapStamp(id: string): Promise<string | undefined> {
	const map = await readHandMap(id);
	if (!map) return undefined;
	const list = (xs: number[]) => xs.map((t) => Math.round(t * 100) / 100).join(',');
	const movements = list(map.movements);
	const vetoes = list(map.movementVetoes);
	return `${handMapFingerprint(map.sections)}${movements ? `;movements=${movements}` : ''}${vetoes ? `;vetoes=${vetoes}` : ''}`;
}

/**
 * What the hand-drawn map beside this cache says about the track, ready to spread into
 * `analyzeTrack`: the grid it implies and the sections it draws. The judgement is read as
 * data rather than imported as code - the app owns its full shape, this side needs the map -
 * and tolerated missing or malformed the way every judgement read is: a broken file is one
 * lost map, not a broken analysis.
 *
 * The map is read together with the analysis it was DRAWN ON, which is still the cached one
 * at this point (this runs before the fresh blob is written), because the grid reading
 * depends on it: `handMapGrid` carries a confirmed piecewise grid forward and only derives
 * new cuts from a uniform one. The judgement pins `analysisHash`, so a cache holding some
 * other grid than the map was drawn on is caught rather than trusted.
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
	// A positive list, after two denylist failures: a mid-session build cached raw
	// .instrumental.pcm beside the audio and served 16 MB of samples to the browser, and an
	// interrupted yt-dlp leaves .part/.ytdl files that would poison the track forever.
	// Only a container yt-dlp actually produces counts as the audio.
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
}

/**
 * Let the audio outvote the record shop.
 *
 * Store genres describe the artist; the classifier heard this track. The Weeknd is filed
 * under R&B while Blinding Lights is synthwave, and the room should light the record that
 * is playing. The middle of the track is classified rather than the start, because a
 * four-minute intro classifies as the ambient it genuinely is and the track is not that.
 *
 * Returns an updated context, or the same object when the audio had nothing confident to
 * add. Failures are swallowed: genre is an improvement, never a dependency.
 */
export async function refineGenreFromAudio(
	context: TrackContext,
	mono22k: Float32Array,
	sampleRate: number
): Promise<TrackContext | null> {
	try {
		const { GenreClassifier, ensureGenreModel, genreModelPresent } = await import('./genreModel.ts');
		if (!genreModelPresent()) await ensureGenreModel();
		const model = await GenreClassifier.create();
		try {
			const window = Math.min(mono22k.length, 180 * sampleRate);
			const start = Math.max(0, Math.floor((mono22k.length - window) / 2));
			const result = await model.run(mono22k.subarray(start, start + window));
			// The "Electronic" parent is dropped before voting: it spans techno through ambient,
			// so as a keyword it only ever drowns the style beside it. The other parents (Hip
			// Hop, Rock, Folk) genuinely narrow the family and stay. Activations weight the
			// votes, so the style the model is sure of decides.
			const top = result.top.slice(0, 5);
			const vote = mapGenres(
				top.map((t) => t.label.replace(/^Electronic---/, '').replace('---', ' ')),
				top.map((t) => t.score)
			);
			const confident = (result.top[0]?.score ?? 0) >= 0.15 && vote.family !== null;
			if (!confident || vote.family === context.genreFamily) return context;
			return {
				...context,
				genreFamily: vote.family,
				genreConfidence: Math.round(vote.confidence * 100) / 100,
				audioGenres: result.top.slice(0, 3).map((t) => t.label.replace('---', ' ')),
				sources: [...context.sources, 'effnet']
			};
		} finally {
			await model.close();
		}
	} catch {
		// Null says the model never spoke, which is different from having nothing to add:
		// only an actual run earns the cache marker that stops future attempts.
		return null;
	}
}

/**
 * Take the genre verdict's drum claim to the record, and downgrade it where the record says
 * no. Returns a corrected context, or null when the verdict stands.
 *
 * The audio classifier hears a piano ballad as Tropical House and there is no ballot on
 * which it loses (`familyCorroborated` carries the numbers). What settles it is the kick
 * rate over the track's own loud bars - the measurement the drop vocabulary is already
 * gated on. The replacement family comes from the same labels with the kick-claiming ones
 * struck out, because the model was not hearing nothing: "Pop Ballad" was sitting third on
 * its own list all along.
 *
 * Runs AFTER the analysis, which is the only place the measurement exists. That order is
 * safe rather than lucky: every club privilege inside the analysis is kick-gated too, so a
 * verdict this pass downgrades had already been refused the drop vocabulary - the three
 * tracks it moves in the judged library were all labelled chorus/verse before it existed.
 * The corrected family is persisted, so the show, the picker and the panel all see it, and
 * a later re-analysis reads the corrected value from the start.
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
 * Whether the published tempo re-hears the detected one at another metrical level.
 *
 * Returns the factor to re-read the beats at, or null when the two already agree or
 * disagree by a ratio no metrical error produces - a published figure that is simply
 * wrong must not drag a good grid with it. Mirrors the correction the AI author has
 * always been allowed to make from research; this is the engine path getting the same
 * privilege from the same kind of evidence.
 *
 * Genre-gated, because catalogue tempi carry each genre's own notation convention:
 * hip-hop and RnB are routinely published at the hat count, double the felt pulse the
 * room should move at, so a "correction" there un-fixes a grid that was already right.
 * The slow families are barred from doubling for the same reason in the other direction.
 */
export function publishedLevel(
	beats: readonly number[],
	publishedBpm: number,
	genreFamily?: string | null
): number | null {
	if (genreFamily === 'hiphop' || genreFamily === 'rnb') return null;
	const period = medianPeriod(beats);
	if (!(period > 1e-6) || !(publishedBpm >= 50) || publishedBpm > 220) return null;
	const detected = 60 / period;
	for (const r of [1, 2, 0.5, 1.5, 2 / 3, 3, 1 / 3]) {
		if (Math.abs(detected * r - publishedBpm) / publishedBpm < 0.035) {
			if (r === 1) return null;
			if (r > 1 && (genreFamily === 'ballad' || genreFamily === 'ambient')) return null;
			return r;
		}
	}
	return null;
}

/**
 * Every stage an ingest reports, as a closed set.
 *
 * A union rather than free text because the queue maps each one to a row status: when
 * `looking the track up` and `transcribing drums` were merely emitted and not mapped, a row
 * sat reading "Downloading" through the whole enrichment. Callers type their tables against
 * this, so the compiler catches the next one instead of a listener noticing months later.
 *
 * The same channel also carries free-text notes - a model that failed to load, a grid being
 * re-read at a corrected level - which are messages rather than stages and leave the row's
 * status where it was. That is why the type is widened rather than closed.
 */
export type IngestStage =
	| 'resolving'
	| 'downloading'
	| 'looking the track up'
	| 'cached'
	| 'decoding'
	| 'tracking beats'
	| 'transcribing drums'
	| 'analysing';

export interface IngestOptions {
	/** Re-analyse even when a current cached analysis exists. */
	force?: boolean;
	/**
	 * Re-read the beats at a different metrical level: 2 doubles, 0.5 halves, 1.5 reads three
	 * where the tracker read two. Implies `force`, since the cached grid is what is being
	 * disagreed with.
	 */
	metricalLevel?: number;
	/**
	 * Cover art, when the caller knows it better than the rip does.
	 *
	 * yt-dlp reports a video still, and for an art track that is the square sleeve pillarboxed
	 * into 16:9 on a flat fill - nearly half the image is a colour the record does not contain,
	 * which both muddies the blurred backdrop and drags `artHue` toward the fill.
	 */
	artwork?: string;
	onProgress?: (stage: IngestStage | (string & {})) => void;
}

/** A YouTube URL or a local audio file path. */
export async function ingest(source: string, opts: IngestOptions = {}): Promise<IngestResult> {
	const log = opts.onProgress ?? (() => {});
	await mkdir(CACHE_DIR, { recursive: true });

	let id: string;
	let title: string;
	let audioPath: string | null;
	let meta: TrackMeta;
	let probed: ProbeResult | null = null;

	if (/^https?:\/\//.test(source)) {
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

		// Copy into the cache rather than referencing in place, so every artifact for a track
		// lives in one directory and the audio route can serve local files the same way it
		// serves downloads.
		audioPath = join(CACHE_DIR, `${id}${extname(original)}`);
		if (!existsSync(audioPath)) await copyFile(original, audioPath);

		meta = { id, title, uploader: 'Local file', thumbnail: '', webpageUrl: '', source };
	}

	// Read from the previous meta rather than re-fetched: the network is the slowest thing in
	// this function. A different image is a different hue, though, so a track re-ingested with
	// better art than it was first stored with has to measure again.
	const previous = await readMeta(id);
	const sameArt = previous?.thumbnail === meta.thumbnail;
	meta.artHue =
		sameArt && previous?.artHue !== undefined
			? previous.artHue
			: ((await artworkHue(meta.thumbnail)).hue ?? null);
	meta.duration ??= previous?.duration;
	await writeFile(metaPath(id), JSON.stringify(meta, null, '\t'));

	// Enrichment runs once per track and its result is cached like everything else. A context
	// whose lookups all failed is retried on the next ingest, so one offline evening does not
	// leave a track contextless forever. 'effnet' does not count as a lookup here: it is the
	// local model's marker, gets stamped even on an offline run, and counting it once made a
	// failed enrichment permanent - no published tempo, no lyrics, ever, for that track.
	let context = await readContext(id);
	const enriched = (c: TrackContext) => c.sources.some((s) => s !== 'effnet');
	if (!context || context.version !== CONTEXT_VERSION || !enriched(context)) {
		log('looking the track up');
		context = await enrichTrack({
			title: meta.title,
			uploader: meta.uploader,
			duration: meta.duration ?? 0,
			webpageUrl: meta.webpageUrl || undefined,
			ytArtist: probed?.artist,
			ytTrack: probed?.track,
			channel: probed?.channel,
			tags: probed?.tags,
			onProgress: log
		});
		await writeFile(contextPath(id), JSON.stringify(context, null, '\t'));
	}

	const relevel = opts.metricalLevel !== undefined && Math.abs(opts.metricalLevel - 1) > 1e-6;
	if (!opts.force && !relevel) {
		// Only the READ is allowed to fail quietly. Everything the cached blob is then put
		// through used to sit inside this catch, where one undefined reference turned into a
		// silent full re-analysis on every play - a 40-second bug that looked like a policy.
		let cached: TrackAnalysis | null = null;
		try {
			cached = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
		} catch {
			// No cache, or unreadable. Fall through and analyse.
		}
		// A stale blob is silently wrong rather than obviously broken: same shape, different
		// meaning. Version mismatch has to discard it - and so does a hand-drawn map the blob
		// has not heard, which is how a map drawn on a current analysis takes effect on the
		// very next play instead of waiting for a version bump it may never get.
		if (cached && cached.version === ANALYSIS_VERSION && cached.handMap === (await handMapStamp(id))) {
			log('cached');
			// Tracks analysed before meta carried a duration or a trust verdict get them
			// here, so a list of the cache does not have to open a 400 kB analysis per row.
			if (!meta.duration || !meta.gridTrust) {
				meta.duration = meta.duration || cached.duration;
				meta.gridTrust = meta.gridTrust ?? gridTrust(cached);
				await writeFile(metaPath(id), JSON.stringify(meta, null, '\t'));
			}
			context = await settleGenreFamily(id, context, cached);
			return { id, audioPath, analysis: cached, meta, context, fromCache: true };
		}
	}

	log('decoding');
	const decoded = await decodeAudio(audioPath);

	// The audio's own genre vote, once the audio exists to ask. The cache remembers whether
	// the model has spoken - and only whether it actually spoke: a failed model run returns
	// null and earns no marker, so the next ingest asks again.
	if (!context.sources.includes('effnet')) {
		const refined = await refineGenreFromAudio(context, decoded.mono, decoded.sampleRate);
		if (refined !== null) {
			context = refined === context ? { ...context, sources: [...context.sources, 'effnet'] } : refined;
			await writeFile(contextPath(id), JSON.stringify(context, null, '\t'));
		}
	}

	// The model finds the beats; everything after it is unchanged. If the weights are missing
	// or the graph fails, the in-repo tracker runs instead: a worse grid is a worse show, a
	// crash here is no show at all.
	let tracked: { beats: number[]; downbeats: number[] } | null = null;
	try {
		log('tracking beats');
		const { BeatThis } = await import('./beatthis.ts');
		const model = await BeatThis.create();
		try {
			tracked = await model.run(decoded.mono);
		} finally {
			await model.close();
		}
	} catch (e) {
		log(`beat model unavailable, falling back: ${e instanceof Error ? e.message : String(e)}`);
	}

	// A published tempo that re-hears the tracked one at a clean ratio settles the octave
	// automatically, which until now only happened when the AI author researched the track.
	// An explicit request still wins: it is a listener's correction, which outranks a catalogue.
	let metricalLevel = opts.metricalLevel;
	if (metricalLevel === undefined && tracked && context.publishedBpm) {
		const level = publishedLevel(tracked.beats, context.publishedBpm, context.genreFamily);
		if (level !== null) {
			log(`re-reading the grid at ${level}x toward a published ${context.publishedBpm} bpm`);
			metricalLevel = level;
		}
	}

	// The drum model hears the kit through the whole mix where the band-flux DSP hears
	// bands; like the beat model it is optional, and its absence is the DSP path working
	// exactly as before. It listens at the training frontend's rate, so it decodes its own
	// copy rather than resampling the analysis one upward, which would be inventing octaves.
	let drums: import('./adtof.ts').AdtofOnsets | undefined;
	try {
		const { Adtof } = await import('./adtof.ts');
		const model = await Adtof.create();
		if (model) {
			log('transcribing drums');
			try {
				const wide = await decodeAudio(audioPath, 44100);
				drums = await model.run(wide.mono);
			} finally {
				await model.close();
			}
		}
	} catch (e) {
		log(`drum model unavailable, falling back: ${e instanceof Error ? e.message : String(e)}`);
	}

	log('analysing');
	const analysis = analyzeTrack({
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
		metricalLevel,
		context,
		...(await handMapInput(id))
	});

	await writeFile(analysisPath(id), JSON.stringify(analysis, null, '\t'));
	// A fresh grid means a fresh verdict on it; the override, being the owner's, survives.
	meta.duration = meta.duration || analysis.duration;
	meta.gridTrust = gridTrust(analysis);
	await writeFile(metaPath(id), JSON.stringify(meta, null, '\t'));
	context = await settleGenreFamily(id, context, analysis);
	return { id, audioPath, analysis, meta, context, fromCache: false };
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
