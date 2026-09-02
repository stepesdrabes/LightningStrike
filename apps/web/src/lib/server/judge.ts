import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from '@mv/analysis';

/**
 * One listening note, anchored to a moment rather than to the track as a whole.
 *
 * The bar is captured beside the time because the two answer different questions later: the
 * time replays the moment, the bar names the cue and the section the complaint is about.
 */
export interface MomentNote {
	/** Seconds into the track when the mark was dropped. */
	t: number;
	/** The bar under the playhead at that moment; null when no analysis was loaded. */
	bar: number | null;
	/**
	 * A hard hit belongs at (or was wrong at) this moment. Absent on a plain mark; the free
	 * text says which way the complaint runs, the kind makes it minable.
	 */
	hit?: 'strobe' | 'slam' | 'blackout' | null;
	text: string;
}

/**
 * One section of the owner's hand-drawn ground-truth map.
 *
 * Times are the authoritative coordinates: a re-analysis moves every bar, and the whole
 * point of a hand-drawn map is to outlive the grid it corrects. Bars are carried beside
 * them, computed on the grid named by the judgement's `analysisHash`, so a mining session
 * can read the map against the blob it was drawn over without redoing the arithmetic.
 */
export interface JudgedSection {
	/** Section vocabulary word; a plain string so old maps survive vocabulary changes. */
	kind: string;
	startTime: number;
	endTime: number;
	/** Fractional bars on the pinned grid - a hand mark is allowed to sit mid-bar. */
	startBar: number;
	endBar: number;
	/**
	 * This section's start was placed BETWEEN bar lines on purpose (the editor's fine drag).
	 *
	 * It is the difference between "the ear says the change is here" and "the drag landed
	 * near here": the grid moves to a deliberate mark, and rounds an incidental one. Absent
	 * on every map drawn before the editor snapped to bars, which is why it is a flag rather
	 * than something inferred from the times - those maps are full of beat-snapped boundaries
	 * nobody meant as metrical statements.
	 */
	offGrid?: boolean;
}

/**
 * The owner's verdict on one track's show, written by the judge panel.
 *
 * `analysisHash` and `showSeed` pin the feedback to the exact artifacts that were heard:
 * a complaint about a show that has since been recomposed is history, not a bug report,
 * and without the pin the two are indistinguishable.
 */
export interface Judgement {
	trackId: string;
	title: string;
	/** 1..5; null until scored. Half the value is knowing which tracks were heard at all. */
	rating: number | null;
	/** Which aspects failed, from the panel's fixed vocabulary, so reports aggregate. */
	tags: string[];
	notes: MomentNote[];
	comment: string;
	/** The hand-drawn section map, when the owner has adjusted one; absent otherwise. */
	sections?: JudgedSection[] | null;
	/**
	 * Seconds where a new song starts inside this one, for a track that is several stitched
	 * together. Marked by hand because both automatic signals were measured and refused - a
	 * local tempo step fires on a quarter of the library, and the spectral break at SICKO
	 * MODE's own switch is smaller than that track's average moment.
	 */
	movements?: number[] | null;
	/**
	 * Seconds near which the owner refused a movement the analyser found on its own. Kept
	 * apart from the marks because a veto and a mark answer different questions, and the
	 * analysis reads both.
	 */
	movementVetoes?: number[] | null;
	analysisHash: string | null;
	showSeed: number | null;
	authoredBy: string | null;
	updatedAt: number;
}

const JUDGE_DIR = join(CACHE_DIR, 'judge');

/** Track ids are cache filenames elsewhere too, but this one comes from the network. */
function safeId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function readJudgements(): Promise<Judgement[]> {
	if (!existsSync(JUDGE_DIR)) return [];
	const files = (await readdir(JUDGE_DIR)).filter((f) => f.endsWith('.json'));
	const out: Judgement[] = [];
	for (const f of files) {
		try {
			out.push(JSON.parse(await readFile(join(JUDGE_DIR, f), 'utf8')) as Judgement);
		} catch {
			// A truncated file is one lost judgement, not a broken panel.
		}
	}
	return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * A judgement written over what is already on disk, without erasing what the writer did not
 * carry.
 *
 * Three writers share one file - the panel (rating, tags, notes, movements), the section
 * editor (the map) and the mining scripts - and each sends a whole judgement built from
 * whatever it happened to know. A field that simply is not there must therefore mean "leave
 * it", never "delete it": a hand-drawn map is an hour of listening, and it was possible to
 * lose one by pressing a star. Only an explicit `null` erases, which is what the discard
 * button sends.
 */
/** A judgement write carries only the fields its writer owns; everything else is a patch. */
export type JudgementPatch = Partial<Judgement> & { trackId: string };

/**
 * A patch written over what is already on disk.
 *
 * Three writers share one file - the judge panel (rating, tags, notes, comment, movements),
 * the section editor (the map), and the mining scripts - and each knows only its own half.
 * So the rule is PATCH, not replace: a field that is absent means "leave it", a value means
 * "take it", and null means "erase it". An empty array is a value: it is how the panel says
 * the last movement mark is gone.
 *
 * The rule an earlier version used - keep the held value whenever the incoming array was
 * empty - looked equivalent and was not. It could not tell a writer that carried nothing
 * from a writer that carried a STALE something, and the client is full of long-lived
 * snapshots: a map redrawn in the editor was reverted by pressing a star, because the
 * panel's draft still held the map as it had been when the panel opened. Writers now send
 * only what they own, and this merge trusts absence rather than emptiness.
 */
export function mergeJudgement(patch: JudgementPatch, held: Partial<Judgement> | null): Judgement {
	const base: Partial<Judgement> = held ?? {};
	const merged: Partial<Judgement> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
	}
	return {
		trackId: patch.trackId,
		title: merged.title ?? '',
		rating: merged.rating ?? null,
		tags: merged.tags ?? [],
		notes: merged.notes ?? [],
		comment: merged.comment ?? '',
		sections: merged.sections ?? null,
		movements: merged.movements ?? null,
		movementVetoes: merged.movementVetoes ?? null,
		analysisHash: merged.analysisHash ?? null,
		showSeed: merged.showSeed ?? null,
		authoredBy: merged.authoredBy ?? null,
		updatedAt: merged.updatedAt ?? 0
	};
}

/**
 * One write at a time per track, and never in place.
 *
 * The write is read-modify-write, so two requests racing lose one of the two edits - twenty
 * concurrent note adds left one note on disk when this was unguarded. And truncating the
 * real file means a crash mid-write leaves a torn one, which reads as no judgement at all
 * and invites the next save to write a blank over an evening's listening. A per-track queue
 * serialises, and a temp file renamed into place makes the swap atomic.
 */
const writing = new Map<string, Promise<void>>();

export async function writeJudgement(patch: JudgementPatch): Promise<void> {
	const id = safeId(patch.trackId);
	const queued = (writing.get(id) ?? Promise.resolve()).then(async () => {
		await mkdir(JUDGE_DIR, { recursive: true });
		const path = join(JUDGE_DIR, `${id}.json`);
		let held: Partial<Judgement> | null = null;
		try {
			held = JSON.parse(await readFile(path, 'utf8')) as Partial<Judgement>;
		} catch {
			// Nothing written yet, or unreadable: there is nothing to preserve.
		}
		const merged = { ...mergeJudgement(patch, held), updatedAt: Date.now() };
		const temp = `${path}.${process.pid}.tmp`;
		await writeFile(temp, JSON.stringify(merged, null, '\t'));
		await rename(temp, path);
	});
	// The queue holds the settled promise either way, so one failed write cannot wedge the
	// track's writes forever.
	writing.set(id, queued.catch(() => {}));
	await queued;
}

export async function clearJudgement(trackId: string): Promise<void> {
	const path = join(JUDGE_DIR, `${safeId(trackId)}.json`);
	if (existsSync(path)) await unlink(path);
}
