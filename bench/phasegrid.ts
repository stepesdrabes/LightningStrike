// The boundary ground truth scored by TIME instead of by bar number.
//
//   node bench/phasegrid.ts                 # A = one phase per track, B = the phase walk
//   node bench/phasegrid.ts --cost=8        # sweep what a restart costs
//
// `earlybars.ts` scores the same seams by bar, which is right for every change that keeps
// the bar count and wrong for any change that does not. A downbeat-phase restart renumbers
// every bar after it, so a target that named the right instant yesterday names its
// neighbour today: measured on Killing In the Name, one "WORSE" row was the SAME INSTANT to
// the millisecond (142.18 s both sides) and another was the boundary moving 0.64 s while
// its number moved 1. Neither fact is visible to a bar-numbered scorer.
//
// So this runs the same analysis twice in one process - A pins the track to a single phase
// (`phaseResetCost: Infinity`, the grid that shipped before the walk), B lets it restart -
// converts each target's true bar to a time on A's own grid, and asks which side puts a
// boundary nearer that moment. Read this and earlybars together: earlybars still owns every
// change that does not re-phase, and it is the stricter of the two where it applies.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { decodeAudio } from '@mv/analysis';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { TARGETS } from './targets.ts';

const cache =
	process.env.MV_CACHE_DIR ??
	join(homedir(), 'Library/Application Support/cz.drabek.lightningstrike/cache');
const beatsDir = join(import.meta.dirname, 'corpus/.beats');
mkdirSync(beatsDir, { recursive: true });
const cost = Number(process.argv.find((a) => a.startsWith('--cost='))?.slice(7) ?? NaN);

let model: BeatThis | null = null;
async function beatsFor(id: string, audio: string): Promise<{ beats: number[]; downbeats: number[] }> {
	const path = join(beatsDir, `judged-${id}.json`);
	if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
	const decoded = await decodeAudio(audio);
	model ??= await BeatThis.create();
	const tracked = await model.run(decoded.mono);
	writeFileSync(path, JSON.stringify(tracked));
	return tracked;
}

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
	const tracked = await beatsFor(id, join(cache, audio));
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
		downbeats: tracked.downbeats
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
