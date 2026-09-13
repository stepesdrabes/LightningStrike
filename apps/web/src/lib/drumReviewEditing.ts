import { validateDrumPatch, type DrumAnnotation, type DrumKind, type DrumReview,
	type DrumReviewPatch, type DrumVerdict } from './drumReview.ts';

export function laneTime(clientX: number, left: number, width: number,
	start: number, end: number): number | null {
	if (![clientX, left, width, start, end].every(Number.isFinite) || width <= 0 || end <= start) return null;
	const fraction = Math.max(0, Math.min(1, (clientX - left) / width));
	return Math.round((start + fraction * (end - start)) * 1000) / 1000;
}

export function addMissedHit(annotations: readonly DrumAnnotation[], kind: DrumKind,
	time: number, id: string): { annotations: DrumAnnotation[]; annotation: DrumAnnotation; added: boolean } {
	const held = annotations.find((a) => a.kind === kind && Math.abs(a.time - time) < 0.0005);
	if (held) return { annotations: [...annotations], annotation: held, added: false };
	const annotation: DrumAnnotation = { id, kind, time, markerTime: null, verdict: 'missed',
		heardTime: null, note: '' };
	return { annotations: [...annotations, annotation].sort((a, b) => a.time - b.time), annotation, added: true };
}

export interface DrumDraftEditor {
	kind: DrumKind;
	time: number;
	marker: boolean;
	verdict: DrumVerdict;
	note: string;
	heardTime: number | null;
	dirty: boolean;
}

export interface DrumReviewDraft extends DrumReviewPatch {
	editor: DrumDraftEditor | null;
	updatedAt: number;
}

export function drumDraftKey(review: DrumReview): string {
	return `lightning-drum-draft:${review.trackId}:${review.audioHash}:${review.analysis.sha256}`;
}

export function writeDrumDraft(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
	key: string, raw: string | null, expected: string | null): boolean {
	const current = storage.getItem(key);
	if (raw === null) {
		if (expected !== null && current === expected) storage.removeItem(key);
		return true;
	}
	if (current !== expected && current !== raw) return false;
	storage.setItem(key, raw);
	return true;
}

export function beginDrumEditor(kind: DrumKind, time: number, marker: boolean): DrumDraftEditor {
	return { kind, time, marker, verdict: marker ? 'uncertain' : 'missed',
		note: '', heardTime: null, dirty: false };
}

export function completeDrumEditor(annotations: readonly DrumAnnotation[], editor: DrumDraftEditor,
	id: string, review: DrumReview): DrumAnnotation[] {
	const annotation: DrumAnnotation = { id, kind: editor.kind, time: editor.time,
		markerTime: editor.marker ? editor.time : null, verdict: editor.verdict,
		note: editor.note, heardTime: editor.heardTime };
	return validateDrumPatch({ trackId: review.trackId, audioHash: review.audioHash,
		analysisSha256: review.analysis.sha256, baseRevision: review.revision, range: review.range,
		annotations: [...annotations.filter(a => a.id !== id), annotation].sort((a, b) => a.time - b.time)
	}, review).annotations;
}

export function readDrumDraft(raw: string | null, review: DrumReview): DrumReviewDraft | null {
	if (!raw || raw.length > 512_000) return null;
	try {
		const value = JSON.parse(raw) as DrumReviewDraft;
		const patch = validateDrumPatch(value, review);
		if (value.editor) {
			const e = value.editor;
			if (typeof e.marker !== 'boolean' || typeof e.dirty !== 'boolean' ||
				(e.heardTime !== null && (typeof e.heardTime !== 'number' || !Number.isFinite(e.heardTime)))) return null;
			validateDrumPatch({ ...patch, annotations: [{ id: 'draft-editor', kind: e.kind, time: e.time,
				// An unfinished numeric field may be out of range; retain it for correction.
				markerTime: e.marker ? e.time : null, verdict: e.verdict, note: e.note, heardTime: null }] }, review);
		}
		return { ...patch, editor: value.editor ?? null, updatedAt: value.updatedAt };
	} catch { return null; }
}
