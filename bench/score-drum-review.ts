// node bench/score-drum-review.ts --review=EXPORT.json --analysis=CANDIDATE.analysis.json [--out=REPORT.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TrackAnalysis } from '@mv/core';
import type { DrumReview } from '../apps/web/src/lib/drumReview.ts';
import { matchEvents } from './lab/mdb.ts';
import { snapToReviewedGrid } from './align-drum-review.ts';

export interface DrumReviewScoreOptions {
	referenceBeats?: readonly number[];
	provisionalIds?: readonly string[];
}

export function provisionalIdsForReview(review: DrumReview, overlay: unknown): string[] {
	if (!overlay || typeof overlay !== 'object') throw new Error('Invalid review evaluation overlay.');
	const value = overlay as { schema?: unknown; overrides?: unknown };
	if (value.schema !== 1 || !Array.isArray(value.overrides)) throw new Error('Invalid review evaluation overlay.');
	const ids = new Set<string>();
	for (const item of value.overrides) {
		if (!item || typeof item !== 'object') throw new Error('Invalid review evaluation override.');
		if (item.trackId !== review.trackId || item.audioHash !== review.audioHash ||
			item.analysisSha256 !== review.analysis.sha256) continue;
		if (item.evaluation !== 'provisional' || item.excludeFromConfirmedPositiveAndNegativeCounts !== true ||
			!Array.isArray(item.annotationIds) || item.annotationIds.some((id: unknown) => typeof id !== 'string')) {
			throw new Error('Invalid matching review evaluation override.');
		}
		for (const annotation of review.annotations) {
			if ((!item.kind || item.kind === annotation.kind) && item.annotationIds.includes(annotation.id)) ids.add(annotation.id);
		}
	}
	return [...ids];
}

export function referenceBeatsForReview(review: DrumReview, rawAnalysis: Uint8Array): readonly number[] {
	if (createHash('sha256').update(rawAnalysis).digest('hex') !== review.analysis.sha256) {
		throw new Error('Reviewed analysis SHA-256 does not match the saved review.');
	}
	const analysis = JSON.parse(Buffer.from(rawAnalysis).toString('utf8')) as TrackAnalysis;
	if (analysis.trackId !== review.trackId || !Array.isArray(analysis.beats) ||
		analysis.beats.some(time => !Number.isFinite(time))) throw new Error('Invalid reviewed track or beat grid.');
	return analysis.beats;
}

export function scoreDrumReview(review: DrumReview, analysis: TrackAnalysis, toleranceMs = 50,
	candidateAudioSha256?: string, options: DrumReviewScoreOptions = {}) {
	const sameSource = typeof candidateAudioSha256 === 'string' && /^[a-f0-9]{64}$/.test(candidateAudioSha256)
		&& candidateAudioSha256 === review.audioHash;
	if (review.schema !== 1 || review.trackId !== analysis.trackId ||
		(review.analysis.hash !== analysis.hash && !sameSource)) {
		throw new Error('Review and candidate must describe the same track and decoded audio.');
	}
	if (!Number.isFinite(toleranceMs) || toleranceMs < 0 || toleranceMs > 500) throw new Error('Invalid tolerance.');
	const provisional = new Set(options.provisionalIds ?? []);
	const rows = (['kick', 'snare'] as const).flatMap(kind => {
		const hits = analysis.onsets[kind].times.filter((_, i) => analysis.onsets[kind].levels[i] >= .05);
		const labels = review.annotations.filter(a => a.kind === kind && a.verdict === 'real' && !provisional.has(a.id))
			.sort((a, b) => a.time - b.time);
		const matches = matchEvents(labels.map(a => a.time), hits, toleranceMs / 1000);
		return labels.map((label, i) => ({ id: label.id, kind, time: label.time,
			matched: matches[i] >= 0 ? hits[matches[i]] : null }));
	});
	const wrong = review.annotations.filter(a => a.verdict === 'wrong' && !provisional.has(a.id)).map(a => ({
		id: a.id, kind: a.kind, time: a.time,
		remaining: analysis.onsets[a.kind].times.filter((time, i) =>
			analysis.onsets[a.kind].levels[i] >= .05 && Math.abs(time - a.time) <= toleranceMs / 1000)
	}));
	// Manual placements are useful leads, but a mouse click is not an acoustic onset label.
	const observations = review.annotations.filter(a => provisional.has(a.id) || !['real', 'wrong'].includes(a.verdict)).map(a => {
		const target = a.heardTime ?? a.time;
		const grid = options.referenceBeats && (a.verdict === 'missed' || a.heardTime !== null)
			? snapToReviewedGrid(target, options.referenceBeats, review.duration) : null;
		const comparisonTime = grid?.time ?? target;
		const hits = analysis.onsets[a.kind].times.filter((_, i) => analysis.onsets[a.kind].levels[i] >= .05);
		const nearest = hits.reduce<number | null>((best, time) =>
			best === null || Math.abs(time - comparisonTime) < Math.abs(best - comparisonTime) ? time : best, null);
		return { ...a, sourceVerdict: a.verdict, evaluation: provisional.has(a.id) ? 'provisional' : 'observation',
			placementTime: target, gridTime: grid?.time ?? null, gridOffsetMs: grid?.offsetMs ?? null,
			comparisonTime, nearestCandidate: nearest,
			distanceFromPlacementMs: nearest === null ? null : (nearest - target) * 1000,
			distanceFromGridMs: nearest === null || !grid ? null : (nearest - grid.time) * 1000 };
	});
	return { trackId: review.trackId, title: review.title, audioHash: review.audioHash,
		pcmHashChanged: review.analysis.hash !== analysis.hash,
		reviewAnalysisSha256: review.analysis.sha256, candidateVersion: analysis.version,
		toleranceMs, confirmedReal: rows.length, matchedReal: rows.filter(row => row.matched !== null).length,
		confirmedWrong: wrong.length, remainingWrong: wrong.filter(row => row.remaining.length).length,
		provisionalAnnotations: observations.filter(row => row.evaluation === 'provisional').length,
		positives: rows, negatives: wrong, observations,
		interpretation: 'Only explicitly judged real/wrong clicks without provisional overrides are scored. Manual placements and any reviewed-grid snapping remain observations pending acoustic verification. Original clicks and source verdicts are preserved. Unmarked events are not negatives; this is not full-passage recall or precision.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const option = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
	if (process.argv.includes('--help')) {
		console.log('node bench/score-drum-review.ts --review=EXPORT.json --analysis=CANDIDATE.analysis.json [--review-analysis=ORIGINAL.analysis.json] [--audio=CANDIDATE_SOURCE] [--out=REPORT.json]');
	} else {
		if (!option('review') || !option('analysis')) throw new Error('Pass --review and --analysis.');
		const review = JSON.parse(readFileSync(option('review')!, 'utf8')) as DrumReview;
		const overlay = JSON.parse(readFileSync(new URL('./judged/drum-review-evaluation.json', import.meta.url), 'utf8'));
		const result = scoreDrumReview(review,
			JSON.parse(readFileSync(option('analysis')!, 'utf8')), 50,
			option('audio') ? createHash('sha256').update(readFileSync(option('audio')!)).digest('hex') : undefined,
			{ provisionalIds: provisionalIdsForReview(review, overlay), referenceBeats: option('review-analysis')
				? referenceBeatsForReview(review, readFileSync(option('review-analysis')!)) : undefined });
		const json = JSON.stringify(result, null, 2);
		if (option('out')) writeFileSync(option('out')!, json);
		console.log(json);
	}
}
