import { readFile, writeFile } from 'node:fs/promises';
import { BUILT_IN_EFFECTS, SHOW_VERSION, type Show } from '@mv/core';
import { isTransientFetchError, showPath, type IngestStage } from '@mv/analysis';
import { composeShow, lintShow } from '@mv/author-engine';
import { currentItem, nextItem, type ItemStatus, type QueueItem } from '$lib/queueModel.ts';
import { autopilot } from './autopilot.ts';
import { ingestDetached } from './ingestDetached.ts';
import { queue } from './queueStore.ts';

/**
 * yt-dlp's own stage words, and the analyser's, mapped onto the four the queue row draws.
 * Anything unrecognised leaves the status alone and only updates the message, so a new stage
 * appearing upstream shows up as text rather than as a wrong chip.
 */
const STAGES: Record<IngestStage, ItemStatus> = {
	resolving: 'resolving',
	downloading: 'downloading',
	// Everything past the download is analysis as far as a row is concerned. Enrichment used
	// to be missing here, which left the chip reading "Downloading" for the whole lookup.
	'looking the track up': 'analysing',
	cached: 'analysing',
	decoding: 'analysing',
	'tracking beats': 'analysing',
	'transcribing drums': 'analysing',
	analysing: 'analysing'
};

const LABELS: Record<IngestStage | 'composing', string> = {
	resolving: 'Resolving',
	downloading: 'Downloading',
	'looking the track up': 'Looking it up',
	cached: 'Reading cache',
	decoding: 'Decoding',
	'tracking beats': 'Tracking beats',
	'transcribing drums': 'Transcribing drums',
	analysing: 'Analysing',
	composing: 'Composing the show'
};

/**
 * Prepare a track: download it if needed, analyse it, and compose the engine's show so the
 * room is lit the moment the audio is.
 *
 * Lifted from the ingest route unchanged in behaviour. An existing show for the same grid is
 * left alone because it may be one Claude has already revised.
 */
async function prepare(item: QueueItem, onStage: (stage: string) => void) {
	// The row already carries the sleeve YouTube Music listed it with, which is squarer and
	// cleaner than the still yt-dlp would find for the same track.
	const result = await ingestDetached(item.source, {
		onProgress: onStage,
		artwork: item.thumbnail || undefined
	});

	let show: Show | null = null;
	try {
		const existing = JSON.parse(await readFile(showPath(result.id), 'utf8')) as Show;
		const author = existing.authoredBy ?? (existing.generatedEffects.length > 0 ? 'claude' : 'engine');
		// A model-authored show is kept across engine versions - it is the one artifact money
		// was spent on. An engine show is kept only while nothing under it has moved: an older
		// build's show never hears an engine fix, and the audio hash cannot see a re-analysis -
		// the same file gains a different section table, and cues composed against the old one
		// keep pounding through a passage the analyser has since relabelled.
		if (
			existing.analysisHash === result.analysis.hash &&
			(author !== 'engine' || (existing.version === SHOW_VERSION && result.fromCache))
		) {
			show = existing;
		}
	} catch {
		// No show yet, or one written against a grid that has since been re-analysed.
	}

	if (!show) {
		onStage('composing');
		const composed = composeShow(result.analysis, {
			artHue: result.meta.artHue,
			context: result.context
		});
		const verdict = lintShow(composed, {
			analysis: result.analysis,
			effects: new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e])),
			context: result.context
		});
		// A show the linter rejects would be rejected on load too; better to say so here.
		if (verdict.ok) {
			await writeFile(showPath(result.id), JSON.stringify(composed, null, '\t'));
			show = composed;
		}
	}

	const authored: QueueItem['authored'] = show
		? (show.authoredBy ?? (show.generatedEffects.length > 0 ? 'claude' : 'engine'))
		: 'none';

	const trust = result.meta.gridTrust;
	const loungeOnly = trust?.trusted === false && !result.meta.gridTrustOverride;

	return { result, authored, loungeOnly, trustNote: trust?.reasons.join('; ') || undefined };
}

/**
 * How many times a row is fetched before it is called failed, counting the first.
 *
 * Two layers, deliberately: the fetcher retries three times seconds apart inside one attempt,
 * and this spaces whole attempts a minute or so apart. Of fifty tracks fetched in one sitting
 * twelve returned 403 and a later re-run recovered seven, so the slow layer is the one that
 * actually pays.
 */
const QUEUE_ATTEMPTS = 3;
const RETRY_WAIT_MS = [20000, 60000];

/**
 * One ingest at a time, ever.
 *
 * The beat tracker is an ONNX graph that will happily take every core it is offered, so two
 * of them running together is slower than the same two in sequence and starves the render
 * loop besides. Serialising also means the track about to play is never queued behind three
 * speculative ones.
 */
class IngestRunner {
	/**
	 * Set before the first await, not after it.
	 *
	 * Checking a flag and then awaiting before setting it is not a guard at all: two calls in
	 * the same turn both pass. Two browsers connecting at once is enough to do it, and every
	 * mutation path calls this.
	 */
	private busy = false;

	/** Prepare the current row, then the one after it, and stop. */
	async pump(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		let more = false;
		try {
			const state = await queue.ready();
			const target = [currentItem(state), nextItem(state)].find(
				(i): i is QueueItem => i !== null && i.status === 'pending'
			);
			if (target) {
				await this.run(target);
				more = true;
			} else {
				// Nothing left to prepare is exactly when the queue is about to run out, so it is
				// also when the radio gets its turn. Here rather than on a timer or a queue
				// subscription: this already runs after every mutation, and nothing fires without
				// an inbound request, so a flag left on cannot wake the machine at four in the
				// morning with nobody in the room.
				more = await autopilot.topUp(Date.now());
			}
		} finally {
			this.busy = false;
		}
		// The queue may have moved on while that was happening, so ask again rather than
		// assuming the next candidate is the one that was next when this started. Outside the
		// finally, or the flag would still be set when the recursion re-enters.
		if (more) void this.pump();
	}

	private async run(item: QueueItem): Promise<void> {
		queue.patch(item.key, { status: 'resolving', message: 'Resolving' });
		try {
			const { result, authored, loungeOnly, trustNote } = await prepare(item, (stage) => {
				// A stage moves the chip; a free-text note (a retry, a model that failed to load)
				// only changes what the row says, leaving the status where it was.
				const status = STAGES[stage as IngestStage];
				const message = LABELS[stage as IngestStage] ?? stage;
				queue.patch(item.key, status ? { status, message } : { message });
			});

			queue.patch(item.key, {
				status: 'ready',
				message: '',
				trackId: result.id,
				title: result.meta.title,
				uploader: result.meta.uploader,
				thumbnail: result.meta.thumbnail,
				duration: result.meta.duration ?? result.analysis.duration,
				authored,
				loungeOnly,
				trustNote,
				genre: result.context?.genreFamily ?? undefined
			});
			if (item.auto) autopilot.noteSuccess();
		} catch (e) {
			// yt-dlp and ffmpeg messages are the useful part; keep them rather than a generic one.
			const raw = (e as Error).message;
			const reason = raw.split('\n')[0].slice(0, 200);
			const spent = (item.attempts ?? 1) + 1;

			// The fetcher already tried three times inside one prepare, seconds apart. YouTube
			// hands out 403s that outlast that and clear a minute later, so the row goes back in
			// line rather than stopping - bounded, and only for a failure worth asking again.
			// The wait is taken here, inside the serialised runner, so nothing is left armed to
			// wake the machine on its own.
			if (isTransientFetchError(raw) && spent <= QUEUE_ATTEMPTS) {
				queue.patch(item.key, {
					status: 'pending',
					attempts: spent,
					message: `Retrying (${spent} of ${QUEUE_ATTEMPTS})`
				});
				await new Promise((r) => setTimeout(r, RETRY_WAIT_MS[spent - 2] ?? 20000));
				return;
			}

			queue.patch(item.key, { status: 'error', attempts: spent, message: reason });
			// A radio pick that will not download is usually the network or a stale yt-dlp
			// rather than that track, so the count is what stops it queueing all night into
			// the same failure.
			if (item.auto) autopilot.noteFailure();
		}
	}

	/** Put a failed row back in line, which is what a retry button means. */
	async retry(key: string): Promise<void> {
		queue.patch(key, { status: 'pending', message: '', attempts: 0 });
		void this.pump();
	}
}

export const runner = new IngestRunner();
