// Compare single-phase and restartable grids against frozen targets in time, since rephasing
// renumbers bars.
// node bench/phasegrid.ts [--cost=8]
// Convert target bars through the single-phase baseline; earlybars.ts remains the bar-domain
// comparison.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { decodeAudio } from '@mv/analysis';
import { hearing, stopHearing } from './hearing.ts';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { TARGETS } from './targets.ts';

const cache = benchmarkCache();
const cost = Number(process.argv.find((a) => a.startsWith('--cost='))?.slice(7) ?? NaN);

const byTrack = new Map<string, typeof TARGETS>();
for (const t of TARGETS) byTrack.set(t.id, [...(byTrack.get(t.id) ?? []), t]);

let hit = 0;
let closer = 0;
let same = 0;
let worse = 0;
for (const [id, targets] of byTrack) {
	const files = readdirSync(cache);
	const audio = files.find((x) => x.startsWith(`${id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
	if (!audio) {
		console.log(`${id}  NO AUDIO in ${cache}`);
		continue;
	}
	const tracked = await hearing(join(cache, audio));
	const decoded = await decodeAudio(join(cache, audio));
	const ctx = join(cache, `${id}.context.json`);
	const base = {
		mono: decoded.mono,
		sampleRate: decoded.sampleRate,
		duration: decoded.duration,
		hash: 'phasegrid',
		trackId: 'file-000000000000',
		title: id,
		context: existsSync(ctx) ? JSON.parse(readFileSync(ctx, 'utf8')) : undefined,
		beats: tracked.beats,
		downbeats: tracked.downbeats,
		striker2: tracked
	};
	const a = analyzeTrack({ ...base, phaseResetCost: Infinity });
	const b = analyzeTrack({ ...base, ...(Number.isFinite(cost) ? { phaseResetCost: cost } : {}) });

	// A build is the approach, not the seam the ear judges, so it is not a candidate here
	// either - the same rule earlybars scores under.
	const seams = (x: typeof a) => x.sections.filter((s) => s.kind !== 'build').map((s) => s.startTime);
	const nearest = (xs: number[], t: number) =>
		xs.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), Infinity);

	for (const t of targets) {
		// The true bar is in the bar coordinates of a grid with one phase, which is exactly
		// what the A side is, so A's own table is what converts it to an instant.
		const trueT = a.tempo.barTimes[t.trueBar];
		if (trueT === undefined) continue;
		const bar = a.tempo.barTimes[t.trueBar + 1] - trueT || a.tempo.beatPeriod * a.tempo.beatsPerBar;
		const da = Math.abs(nearest(seams(a), trueT) - trueT);
		const db = Math.abs(nearest(seams(b), trueT) - trueT);
		const verdict =
			db <= bar * 0.5 && da > bar * 0.5
				? 'HIT'
				: db < da - 0.02
					? 'closer'
					: db > da + 0.02
						? 'WORSE'
						: 'same';
		if (verdict === 'HIT') hit++;
		else if (verdict === 'closer') closer++;
		else if (verdict === 'WORSE') worse++;
		else same++;
		console.log(
			`${t.title.padEnd(22)} true@${trueT.toFixed(2)}s  A ${da.toFixed(2)}s  B ${db.toFixed(2)}s  ` +
				`${verdict.padEnd(6)} ${t.tentative ? '(tentative) ' : ''}- ${t.note}`
		);
	}
}
console.log(`\n${hit} hit, ${closer} closer, ${same} same, ${worse} worse of ${TARGETS.length}`);
await stopHearing();
