// Trace hand-map adoption against cached beats without writing the judgment file.
// MV_CACHE_DIR=<cache> node bench/mapland.ts <trackId> [nudge=<index>:<seconds>]
// nudge simulates an off-grid fine drag. gridedit.ts runs the full pipeline for comparison.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import type { TrackAnalysis } from '@mv/core';
import { barTimeAt, nearestBar, nearestBarIn } from '@mv/core';
import { barStartsAtCuts, handMapGrid, handSectionBars, resyncedCuts } from '@mv/analysis';
import { applyHandSections } from '../apps/web/src/lib/server/previewArrangement.ts';
import type { JudgedSection } from '../apps/web/src/lib/server/judge.ts';

const id = process.argv[2];
if (!id) throw new Error('usage: node bench/mapland.ts <trackId> [nudge=<index>:<seconds>]');
const cache = benchmarkCache();

const analysis = JSON.parse(
	readFileSync(join(cache, `${id}.analysis.json`), 'utf8')
) as TrackAnalysis;
const judgement = JSON.parse(readFileSync(join(cache, 'judge', `${id}.json`), 'utf8')) as {
	sections?: JudgedSection[];
};
const drawn: JudgedSection[] = (judgement.sections ?? []).map((s) => ({ ...s }));
if (drawn.length < 2) throw new Error(`no hand map on ${id}`);

const nudge = process.argv.find((a) => a.startsWith('nudge='))?.slice('nudge='.length);
if (nudge) {
	const [at, to] = nudge.split(':').map(Number);
	if (!Number.isFinite(at) || !Number.isFinite(to)) throw new Error('nudge=<index>:<seconds>');
	drawn[at] = { ...drawn[at], startTime: to, offGrid: true };
	drawn[at - 1] = { ...drawn[at - 1], endTime: to };
	console.log(`nudged boundary ${at} to ${to.toFixed(3)}s, flagged offGrid\n`);
}

const preview = applyHandSections(analysis, drawn);
if (!preview) throw new Error('the preview refuses this map');

// The adoption, walked the way `analyzeTrack` does: the same cuts, the same bar walk over the
// same beats, then the same rounding. Everything here is the shipped code path except the beat
// tracking, which a cached blob already carries.
const beats = analysis.beats;
const beatAt = (t: number) => {
	let best = 0;
	for (let i = 1; i < beats.length; i++) {
		if (Math.abs(beats[i] - t) < Math.abs(beats[best] - t)) best = i;
	}
	return best;
};
const grid = handMapGrid(
	drawn.slice(1).map((s) => s.startTime),
	{ beats, barTimes: analysis.tempo.barTimes, beatsPerBar: analysis.tempo.beatsPerBar },
	drawn.slice(1).filter((s) => s.offGrid).map((s) => s.startTime)
);
const cuts = resyncedCuts(
	(grid.gridCuts ?? []).map(beatAt),
	drawn.slice(1).filter((s) => s.offGrid).map((s) => beatAt(s.startTime)),
	drawn.slice(1).map((s) => beatAt(s.startTime)),
	beats.length,
	analysis.tempo.beatsPerBar,
	analysis.tempo.downbeatPhase
);
const adoptedStarts =
	cuts.length > 0
		? barStartsAtCuts(beats.length, analysis.tempo.beatsPerBar, analysis.tempo.downbeatPhase, cuts)
		: null;
const adoptedBarTimes = adoptedStarts
	? Float64Array.from(adoptedStarts, (i) => Math.round(beats[i] * 1000) / 1000)
	: Float64Array.from(analysis.tempo.barTimes);
const adoptedCount = adoptedBarTimes.length - 1;
const adopted = handSectionBars(drawn, adoptedBarTimes, adoptedCount);

console.log(`${id}: ${drawn.length} drawn, cuts ${grid.gridCuts?.map((c) => c.toFixed(2)).join(',') ?? 'none'}`);
console.log(`cached bars ${analysis.tempo.barTimes.length - 1}, preview bars ${preview.tempo.barTimes.length - 1}, adoption bars ${adoptedCount}\n`);
console.log('       drawn   previewed      moved     adopted      moved   agree');

let movedPreview = 0;
let movedAdopt = 0;
let disagree = 0;
for (let i = 0; i < drawn.length; i++) {
	const t = drawn[i].startTime;
	const p = i === 0 ? preview.tempo.barTimes[0] : barTimeAt(preview.tempo, nearestBar(preview.tempo, t));
	const a =
		i === 0
			? adoptedBarTimes[0]
			: adoptedBarTimes[Math.min(adoptedCount, nearestBarIn(adoptedBarTimes, t, adoptedCount))];
	const dp = p - t;
	const da = a - t;
	if (Math.abs(dp) > 0.02) movedPreview++;
	if (Math.abs(da) > 0.02) movedAdopt++;
	if (Math.abs(p - a) > 0.02) disagree++;
	const mark = (d: number) => (Math.abs(d) > 0.02 ? `MOVED ${d >= 0 ? '+' : ''}${d.toFixed(2)}` : '');
	console.log(
		`${t.toFixed(2).padStart(12)}${p.toFixed(2).padStart(12)}${mark(dp).padStart(11)}` +
			`${a.toFixed(2).padStart(12)}${mark(da).padStart(11)}${(Math.abs(p - a) > 0.02 ? '   NO' : '     ').padStart(8)}`
	);
}
console.log(
	`\n${movedPreview} of ${drawn.length} moved in the preview, ${movedAdopt} in the adoption, ${disagree} disagree between them`
);

// The spans the preview actually produced, which is what the room would light: a boundary that
// rounds onto its neighbour's bar leaves no span at all, and that is invisible above.
console.log(`\npreview spans (${preview.sections.length} of ${drawn.length} drawn):`);
for (const s of preview.sections) {
	console.log(`  ${s.kind.padEnd(10)} bar ${String(s.startBar).padStart(4)} ${s.startTime.toFixed(2).padStart(8)}s`);
}
if (adopted) {
	console.log(`\nadopted spans (${adopted.kinds.length}):`);
	for (let i = 0; i < adopted.kinds.length; i++) {
		const b = adopted.bounds[i];
		console.log(`  ${adopted.kinds[i].padEnd(10)} bar ${String(b).padStart(4)} ${adoptedBarTimes[b].toFixed(2).padStart(8)}s`);
	}
}
