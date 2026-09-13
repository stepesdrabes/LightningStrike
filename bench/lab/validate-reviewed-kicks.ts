import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { resamplePcm } from '../../packages/analysis/src/decode.ts';
import { kickSourceCandidate } from './kick-source-candidate.ts';
import { mergeKickEvidence } from '../../packages/analysis/src/kickEvidence.ts';
import assert from 'node:assert/strict';
import { readF32 } from './mdb.ts';
import { snapToReviewedGrid } from '../align-drum-review.ts';

const root = 'bench/reports/audio-reliability';
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const rows = [];
for (const id of ['tWEaUKCQ8Fg', 'jOLT6ukrQSg', 'wy7_PFy-ztQ']) {
	const cache = join(root, 'drum-review-ui/cache');
	const review = read(join(cache, 'drum-reviews', readdirSync(join(cache, 'drum-reviews')).find(n => n.startsWith(id + '.'))!));
	let baselineBytes = readFileSync(join(cache, id + '.analysis.json'));
	if (createHash('sha256').update(baselineBytes).digest('hex') !== review.analysis.sha256) {
		baselineBytes = readFileSync(join(cache, 'drum-review-analyses', `${id}.${review.analysis.sha256}.analysis.json`));
	}
	assert.equal(createHash('sha256').update(baselineBytes).digest('hex'), review.analysis.sha256);
	const baseline = JSON.parse(baselineBytes.toString('utf8'));
	let mix: Float32Array, source: Float32Array, probe: any, model: any;
	if (id === 'tWEaUKCQ8Fg') {
		const stereo = readF32(join(root, 'native-clips/habibi-full.stereo.f32')), frames = stereo.length / 2;
		mix = await resamplePcm(Float32Array.from(stereo.subarray(0, frames), (v, i) => (v + stereo[frames + i]) / 2), 44100);
		source = await resamplePcm(readF32(join(root, 'native-clips/habibi-full/kick.f32')), 44100);
		probe = read(join(root, 'session-baseline', id + '.probe.json'));
		model = read(join(root, 'model-evidence', id + '.json')).drums;
	} else {
		const dir = join(root, 'judgement-correction/sources', id);
		mix = readF32(join(dir, 'mix22.f32')); source = readF32(join(dir, 'kick22.f32'));
		probe = read(join(dir, 'review-evidence.json')); model = probe.model;
	}
	const result = kickSourceCandidate(baseline.onsets.kick, probe.dsp.kick, source, mix, model.kick);
	assert.deepEqual(mergeKickEvidence(baseline.onsets.kick, probe.dsp.kick, source, mix, model.kick, 22050),
		{ times: result.times, levels: result.levels, invented: result.invented });
	const observations = review.annotations.filter((a: any) => a.kind === 'kick').map((a: any) => {
		const grid = a.verdict === 'missed' ? snapToReviewedGrid(a.time, baseline.beats, baseline.duration) : null;
		const target = grid?.time ?? a.time;
		const nearest = result.times.reduce((best, t) => Math.abs(t - target) < Math.abs(best - target) ? t : best, Infinity);
		return { annotation: a, grid, nearest, distanceMs: 1000 * Math.abs(nearest - target) };
	});
	rows.push({id, added: result.added, removed: result.removed, observations});
	console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(join(root, 'judgement-correction/kick-human-validation.json'), JSON.stringify(rows, null, 2));
