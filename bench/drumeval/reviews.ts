// node bench/drumeval/reviews.ts --label=RUN [--reviews=DIR]
// Scores a library run against the owner's saved drum reviews with the app's review scorer: judged
// real hits found at lighting level, judged wrong hits still emitted, and missed-hit clicks that now
// have a hit within 50 ms of their reviewed-grid position. Reviews are partial labels.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TrackAnalysis } from '@mv/core';
import type { DrumReview } from '../../apps/web/src/lib/drumReview.ts';
import { provisionalIdsForReview, referenceBeatsForReview, scoreDrumReview } from '../score-drum-review.ts';
import { EVAL_ROOT, evidenceDir, files, readJson, type AudioRecord } from './evidence.ts';
import { loadRun } from './evaluate.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const run = loadRun(flag('label')!);
const root = resolve(flag('reviews') ?? join(EVAL_ROOT, '..', 'audio-reliability', 'drum-review-ui', 'cache'));
const overlay = JSON.parse(readFileSync(resolve('bench/judged/drum-review-evaluation.json'), 'utf8'));
const totals = { real: 0, found: 0, wrong: 0, remaining: 0, missed: 0, recovered: 0 };

for (const file of readdirSync(join(root, 'drum-reviews')).filter((name) => name.endsWith('.json')).sort()) {
	const review = JSON.parse(readFileSync(join(root, 'drum-reviews', file), 'utf8')) as DrumReview;
	const result = run.find((r) => r.corpus === 'library' && r.name === review.trackId);
	if (!result) continue;
	const audio = readJson<AudioRecord>(join(evidenceDir({ corpus: 'library', name: review.trackId }), files.audio));
	const reviewed = join(root, 'drum-review-analyses', `${review.trackId}.${review.analysis.sha256}.analysis.json`);
	const analysis = {
		version: 0, trackId: review.trackId, hash: '', onsets: { kick: result.final.kick, snare: result.final.snare }
	} as unknown as TrackAnalysis;
	const score = scoreDrumReview(review, analysis, 50, audio?.audioSha256, {
		provisionalIds: provisionalIdsForReview(review, overlay),
		referenceBeats: existsSync(reviewed) ? referenceBeatsForReview(review, readFileSync(reviewed)) : undefined
	});
	const missed = score.observations.filter((o) => o.sourceVerdict === 'missed');
	const recovered = missed.filter((o) => o.nearestCandidate !== null && Math.abs(o.nearestCandidate - o.comparisonTime) <= 0.05);
	totals.real += score.confirmedReal;
	totals.found += score.matchedReal;
	totals.wrong += score.confirmedWrong;
	totals.remaining += score.remainingWrong;
	totals.missed += missed.length;
	totals.recovered += recovered.length;
	console.log(`${review.title}: real ${score.matchedReal}/${score.confirmedReal}, wrong still emitted `
		+ `${score.remainingWrong}/${score.confirmedWrong}, missed clicks now hit ${recovered.length}/${missed.length}`);
}
console.log(`total: real ${totals.found}/${totals.real}, wrong still emitted ${totals.remaining}/${totals.wrong}, `
	+ `missed clicks now hit ${totals.recovered}/${totals.missed}`);
