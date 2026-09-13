export type DrumKind = 'kick' | 'snare';
export const DRUM_VERDICTS = ['real', 'wrong', 'missed', 'early', 'late', 'uncertain'] as const;
export type DrumVerdict = typeof DRUM_VERDICTS[number];

export interface DrumAnnotation {
	id: string;
	kind: DrumKind;
	time: number;
	markerTime: number | null;
	verdict: DrumVerdict;
	heardTime: number | null;
	note: string;
}

export interface DrumReview {
	schema: 1;
	trackId: string;
	title: string;
	duration: number;
	audioHash: string;
	analysis: { sha256: string; hash: string; version: number };
	markers: Record<DrumKind, { times: number[]; levels: number[] }>;
	revision: number;
	updatedAt: number;
	range: { start: number; end: number };
	annotations: DrumAnnotation[];
}

export interface DrumReviewPatch {
	trackId: string;
	audioHash: string;
	analysisSha256: string;
	baseRevision: number;
	range: DrumReview['range'];
	annotations: DrumAnnotation[];
}

export function validateDrumPatch(value: unknown, review: DrumReview): DrumReviewPatch {
	const invalid = (message: string): never => { throw new Error(message); };
	if (!value || typeof value !== 'object') invalid('Review required.');
	const v = value as DrumReviewPatch;
	if (v.trackId !== review.trackId || v.audioHash !== review.audioHash ||
		v.analysisSha256 !== review.analysis.sha256) invalid('The track changed. Reload before saving.');
	if (!Number.isInteger(v.baseRevision) || v.baseRevision < 0) invalid('Invalid revision.');
	const time = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) &&
		n >= 0 && n <= review.duration;
	if (!v.range || !time(v.range.start) || !time(v.range.end) ||
		v.range.end <= v.range.start || v.range.end - v.range.start > 20.001 ||
		v.range.end - v.range.start < Math.min(8, review.duration) - 0.001) invalid('Choose an 8–20 second passage.');
	if (!Array.isArray(v.annotations) || v.annotations.length > 1000) invalid('Too many notes.');
	const ids = new Set<string>();
	const annotations = v.annotations.map((a) => {
		if (!a || typeof a !== 'object' || typeof a.id !== 'string' ||
			!/^[a-zA-Z0-9_-]{1,80}$/.test(a.id) || ids.has(a.id)) invalid('Invalid note id.');
		ids.add(a.id);
		if (!['kick', 'snare'].includes(a.kind) || !DRUM_VERDICTS.includes(a.verdict) ||
			!time(a.time) || typeof a.note !== 'string' || a.note.length > 1000) invalid('Invalid note.');
		if (a.heardTime !== null && !time(a.heardTime)) invalid('Invalid corrected time.');
		if (a.markerTime !== null && (!time(a.markerTime) || a.time !== a.markerTime ||
			!review.markers[a.kind].times.includes(a.markerTime))) invalid('That click is not in this review.');
		if (a.verdict === 'missed' ? a.markerTime !== null : a.markerTime === null) {
			invalid('Select a click, or mark a missed hit.');
		}
		return { id: a.id, kind: a.kind, time: a.time, markerTime: a.markerTime,
			verdict: a.verdict, heardTime: a.heardTime, note: a.note };
	});
	return { trackId: v.trackId, audioHash: v.audioHash, analysisSha256: v.analysisSha256,
		baseRevision: v.baseRevision, range: { start: v.range.start, end: v.range.end }, annotations };
}

export function reviewPosition(elapsed: number, offset: number, start: number, end: number,
	loop: boolean): number {
	const position = offset + Math.max(0, elapsed);
	return loop && position >= end ? start + (position - end) % (end - start) : Math.min(end, position);
}
