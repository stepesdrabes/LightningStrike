import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from '@mv/analysis';

/** Store time for replay and bar for cue/section attribution. */
export interface MomentNote {
	/** Seconds into the track when the mark was dropped. */
	t: number;
	/** The bar under the playhead at that moment; null when no analysis was loaded. */
	bar: number | null;
	/** Marks a hard-hit judgement; text specifies whether the hit was wanted or misplaced. */
	hit?: 'strobe' | 'slam' | 'blackout' | null;
	text: string;
}

/**
 * Hand-map times remain authoritative across re-analysis. Bars are pinned to analysisHash for
 * later measurement.
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
	 * Explicit fine-drag placement requests a grid correction. Do not infer this from legacy
	 * beat-snapped maps.
	 */
	offGrid?: boolean;
}

/**
 * Pin feedback to analysisHash and showSeed so later recomposition cannot masquerade as the
 * reviewed show.
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
	 * Manual new-song boundaries, seconds; tempo and spectral changes alone are not reliable
	 * movement evidence.
	 */
	movements?: number[] | null;
	/** Rejected detected-movement locations, seconds; kept separate from positive marks. */
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

/** A judgement write carries only the fields its writer owns; everything else is a patch. */
export type JudgementPatch = Partial<Judgement> & { trackId: string };

/**
 * Patch semantics: absent preserves, values replace, null erases. Empty arrays remove all
 * entries; each writer sends only its own fields.
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
 * Serialize read-modify-write per track to preserve concurrent edits; atomic rename prevents
 * torn files.
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
	// Settle the queue after failure so later writes can proceed.
	writing.set(id, queued.catch(() => {}));
	await queued;
}

export async function clearJudgement(trackId: string): Promise<void> {
	const path = join(JUDGE_DIR, `${safeId(trackId)}.json`);
	if (existsSync(path)) await unlink(path);
}
