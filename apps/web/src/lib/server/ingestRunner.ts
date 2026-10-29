import { readFile, writeFile } from 'node:fs/promises';
import { BUILT_IN_EFFECTS, type Show } from '@mv/core';
import { handMapStale, isTransientFetchError, readMeta, showPath, type IngestStage } from '@mv/analysis';
import { refreshShow, lintShow } from '@mv/author-engine';
import { currentItem, nextItem, type ItemStatus, type QueueItem } from '$lib/queueModel.ts';
import { autopilot } from './autopilot.ts';
import { eveningGate } from './evening/gate.ts';
import { ingestDetached, narrationDetached } from './ingestDetached.ts';
import { readJudgements } from './judge.ts';
import { queue } from './queueStore.ts';

/** Map known ingest stages to queue states; unknown messages leave status unchanged. */
const STAGES: Record<IngestStage, ItemStatus> = {
	resolving: 'resolving',
	downloading: 'downloading',

	'looking the track up': 'analysing',
	cached: 'analysing',
	decoding: 'analysing',
	transcribing: 'analysing',
	analysing: 'analysing'
};

const LABELS: Record<IngestStage | 'composing', string> = {
	resolving: 'Resolving',
	downloading: 'Downloading',
	'looking the track up': 'Looking it up',
	cached: 'Reading cache',
	decoding: 'Decoding',
	transcribing: 'Transcribing',
	analysing: 'Analysing',
	composing: 'Composing the show'
};

/** What preparing a track needs to know about where it comes from. */
type Preparable = Pick<QueueItem, 'source' | 'trackId' | 'thumbnail'>;

/** Prepare audio and analysis, preserving an existing authored show on the same grid. */
export async function prepareTrack(item: Preparable, onStage: (stage: string) => void) {
	// Prefer the catalogue sleeve already on the row to yt-dlp's video still.
	const result = await ingestDetached(item.source, {
		cachedTrackId: item.trackId ?? undefined,
		onProgress: onStage,
		artwork: item.thumbnail || undefined
	});

	let existing: Show | null = null;
	try {
		existing = JSON.parse(await readFile(showPath(result.id), 'utf8')) as Show;
	} catch {
		// No readable saved show.
	}

	const candidate = refreshShow(result.analysis, {
		existing,
		analysisChanged: !result.fromCache,
		arrangementUnchanged: result.arrangementUnchanged,
		artHue: result.meta.artHue,
		context: result.context
	});
	let show: Show | null = candidate === existing ? existing : null;
	if (!show) {
		onStage('composing');
		const verdict = lintShow(candidate, {
			analysis: result.analysis,
			effects: new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e])),
			context: result.context
		});
		// A show the linter rejects would be rejected on load too; better to say so here.
		if (verdict.ok) {
			await writeFile(showPath(result.id), JSON.stringify(candidate, null, '\t'));
			show = candidate;
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
 * Bound whole-attempt retries beyond yt-dlp's short retries; transient 403s can take a minute
 * to clear.
 */
const QUEUE_ATTEMPTS = 3;
const RETRY_WAIT_MS = [20000, 60000];

/** The section editor saves on every drag; re-analyse once the edits pause. */
const EDIT_SETTLE_MS = 15000;

/**
 * Serialize ONNX analysis to avoid CPU contention and keep the next track ahead of speculative
 * work.
 */
class IngestRunner {
	/** Set the guard before the first await so simultaneous callers cannot both enter. */
	private busy = false;
	private swept = false;
	/** Tracks whose judgement marks changed since their analysis; queued rows come first. */
	private edited = new Set<string>();
	private settling = new Map<string, ReturnType<typeof setTimeout>>();
	private refreshed = new Set<(trackId: string) => void>();

	/** Re-prepare a track with its new hand edits; its rows play the previous show meanwhile. */
	editsChanged(trackId: string, settle = EDIT_SETTLE_MS): void {
		clearTimeout(this.settling.get(trackId));
		this.settling.set(
			trackId,
			setTimeout(() => {
				this.settling.delete(trackId);
				this.edited.add(trackId);
				void this.pump();
			}, settle)
		);
	}

	onRefreshed(listener: (trackId: string) => void): void {
		this.refreshed.add(listener);
	}

	/** Catch marks saved while the server was down or before edits re-prepared their track. */
	private async sweepEdits(): Promise<void> {
		for (const j of await readJudgements()) {
			if (await handMapStale(j.trackId)) this.editsChanged(j.trackId, 0);
		}
	}

	/** Prepare the current row, then the one after it, and stop. */
	async pump(): Promise<void> {
		if (!this.swept) {
			this.swept = true;
			void this.sweepEdits().catch(() => {});
		}
		if (this.busy) return;
		this.busy = true;
		let more = false;
		try {
			const state = await queue.ready();
			const ahead = eveningGate.active
				? eveningGate.ahead.map((key) => state.items.find((i) => i.key === key) ?? null)
				: [];
			const target = [currentItem(state), nextItem(state), ...ahead].find(
				(i): i is QueueItem => i !== null && i.status === 'pending'
			);
			if (target) {
				await this.run(target);
				more = true;
			} else if (this.edited.size > 0) {
				const [trackId] = this.edited;
				this.edited.delete(trackId);
				await this.refresh(trackId);
				more = true;
			} else if (!eveningGate.active) {
				// Ask radio when preparation empties, following requests rather than an unattended timer.
				more = await autopilot.topUp(Date.now());
			}
		} finally {
			this.busy = false;
		}
		// Recheck the queue after clearing the guard; it may have changed during preparation.
		if (more) void this.pump();
	}

	private async run(item: QueueItem): Promise<void> {
		if (item.kind === 'narration') {
			queue.patch(item.key, { status: 'analysing', message: 'Reading the narration' });
			try {
				const measured = await narrationDetached(item.source);
				queue.patch(item.key, { status: 'ready', message: '', duration: measured.duration });
			} catch (e) {
				queue.patch(item.key, { status: 'error', message: (e as Error).message.split('\n')[0].slice(0, 200) });
			}
			return;
		}
		queue.patch(item.key, { status: 'resolving', message: 'Resolving' });
		try {
			const { result, authored, loungeOnly, trustNote } = await prepareTrack(item, (stage) => {
				// Only recognised stages change status; free-text notes update the message.
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

			// Retry transient fetch failures inside the serial runner, with no detached timer left to wake
			// later.
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
			// Bound failed radio picks so network or yt-dlp failures cannot enqueue indefinitely.
			if (item.auto) autopilot.noteFailure();
		}
	}

	private async refresh(trackId: string): Promise<void> {
		const meta = await readMeta(trackId);
		if (!meta) return;
		// The playing row keeps the show and trust it started with.
		const rows = () =>
			queue.snapshot.items.filter(
				(i) => i.trackId === trackId && i.status === 'ready' && i.key !== queue.snapshot.currentKey
			);
		for (const row of rows()) queue.patch(row.key, { refreshing: true });
		let facts: Partial<QueueItem> = {};
		try {
			const { authored, loungeOnly, trustNote } = await prepareTrack(
				{ source: meta.source, trackId, thumbnail: '' },
				() => {}
			);
			facts = { authored, loungeOnly, trustNote };
		} catch (e) {
			console.warn(`re-preparing ${trackId} with its hand edits failed: ${(e as Error).message.split('\n')[0]}`);
		}
		for (const row of rows()) queue.patch(row.key, { ...facts, refreshing: undefined });
		for (const row of queue.snapshot.items.filter((i) => i.refreshing && i.trackId === trackId)) {
			queue.patch(row.key, { refreshing: undefined });
		}
		for (const listener of this.refreshed) listener(trackId);
	}

	/** Put a failed row back in line, which is what a retry button means. */
	async retry(key: string): Promise<void> {
		queue.patch(key, { status: 'pending', message: '', attempts: 0 });
		void this.pump();
	}
}

export const runner = new IngestRunner();
