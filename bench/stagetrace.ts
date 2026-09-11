// Trace every structure stage using cached model beats and meter, then compare with
// analyzeTrack.
// MV_CACHE_DIR=<cache> node bench/stagetrace.ts <trackId> [fromBar] [toBar]
// MISMATCH means the mirror has drifted from the shipped pipeline; its intermediate trace is
// unreliable.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { decodeAudio } from '@mv/analysis';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { arrange, bandLevels } from '../packages/analysis/src/arrange.ts';
import { beatSynchronous } from '../packages/analysis/src/beatsync.ts';
import { chromagram } from '../packages/analysis/src/chroma.ts';
import { consolidateSections } from '../packages/analysis/src/consolidate.ts';
import { detectDrums, type DrumStream } from '../packages/analysis/src/drums.ts';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import { assessMetricalLevel } from '../packages/analysis/src/metricalLevel.ts';
import { barGroups, quantiseOnsets } from '../packages/analysis/src/quantise.ts';
import {
	DEFAULT_TUNING,
	arrivalStrengths,
	barSynchronous,
	groupSegments,
	refineBoundaries,
	rephaseToPins,
	segmentBars,
	settlingContrast,
	similarityMatrix,
	type BoundaryMove
} from '../packages/analysis/src/structure.ts';
import {
	chorusSpansFromLyrics,
	demoteVersesFromLyrics,
	hookBars,
	hookStarts,
	isClubFamily,
	loudKickRate,
	promoteChorusesFromLyrics,
	snapToHooks,
	speaksClub,
	toSongVocabulary
} from '../packages/analysis/src/vocabulary.ts';

const id = process.argv[2];
if (!id) throw new Error('usage: node bench/stagetrace.ts <trackId> [fromBar] [toBar]');
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? 40);

const cache = benchmarkCache();
const beatsPath = join(import.meta.dirname, 'corpus/.beats', `judged-${id}.json`);
if (!existsSync(beatsPath)) throw new Error(`no cached beats at ${beatsPath} - run earlybars first`);
const tracked = JSON.parse(readFileSync(beatsPath, 'utf8')) as { beats: number[]; downbeats: number[] };

const files = readdirSync(cache);
const audioFile = files.find((x) => x.startsWith(`${id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
if (!audioFile) throw new Error(`no audio for ${id} in ${cache}`);
const context = existsSync(join(cache, `${id}.context.json`))
	? JSON.parse(readFileSync(join(cache, `${id}.context.json`), 'utf8'))
	: undefined;
const blob = JSON.parse(readFileSync(join(cache, `${id}.analysis.json`), 'utf8')) as {
	tempo: { beatsPerBar: number; downbeatPhase: number };
	sections: { kind: string; startBar: number }[];
};

const decoded = await decodeAudio(join(cache, audioFile));
const duration = decoded.duration;
const loudness = measureLoudness(decoded.mono, decoded.sampleRate);
const mono = Float32Array.from(decoded.mono);
const gain = Math.pow(10, (-14 - loudness.integrated) / 20);
if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
	const g = Math.min(gain, 40);
	for (let i = 0; i < mono.length; i++) mono[i] *= g;
}

const features = extractFeatures(mono, decoded.sampleRate);
const chroma = chromagram(mono, decoded.sampleRate);
const beats = Float64Array.from(tracked.beats);
const assessment = assessMetricalLevel(tracked.beats, features.odf, features.curves.fps);
const beatPeriod = assessment.bpm > 0 ? 60 / assessment.bpm : 0.5;
const beatFeatures = beatSynchronous(features.spec, chroma, features.curves, features.odf, beats, duration);
const { beatsPerBar, downbeatPhase } = blob.tempo;
const bars = barSynchronous(beatFeatures, beatsPerBar, downbeatPhase);

const detected = detectDrums(features.spec, { beatPeriod, odf: features.odf });
const rawKicks = countPerBar(detected.kick.times, bars.time, bars.count);

const vocal = new Float64Array(bars.count);
const lyricLines: { t: number; text: string }[] | null = context?.instrumental ? null : (context?.lyrics ?? null);
if (lyricLines && lyricLines.length > 0) {
	const barAt = (t: number) => {
		let b = 0;
		while (b < bars.count - 1 && bars.time[b + 1] <= t) b++;
		return b;
	};
	for (let i = 0; i < lyricLines.length; i++) {
		const start = lyricLines[i].t;
		const end = Math.min(lyricLines[i + 1]?.t ?? start + 4, start + 4, duration);
		for (let b = barAt(start); b < bars.count && bars.time[b] < end; b++) {
			const len = bars.time[b + 1] - bars.time[b];
			if (len <= 0) continue;
			const overlap = Math.min(end, bars.time[b + 1]) - Math.max(start, bars.time[b]);
			if (overlap > 0) vocal[b] += overlap / len;
		}
	}
}
const hooks =
	lyricLines && lyricLines.length > 0
		? hookBars(lyricLines, duration, bars.time, bars.count)
		: new Uint8Array(bars.count);

const tuning = DEFAULT_TUNING;
const sim = similarityMatrix(bars);
const settle = settlingContrast(sim, bars.count);
const rough = segmentBars(sim, bars);
stage('segmentBars', rough);

const moves: BoundaryMove[] = [];
const refined = refineBoundaries(
	rough,
	bars,
	rawKicks,
	moves,
	tuning.refineFloor,
	vocal,
	hooks,
	settle,
	tuning.settleWeight,
	tuning.refineReach
);
stage('refineBoundaries', refined);
console.log('  moves:', moves.map((m) => `${m.from}->${m.to}@${m.score.toFixed(2)}`).join(' ') || '(none)');

const movePinned = new Set(moves.filter((m) => m.score >= tuning.pinScore).map((m) => m.to));
const physical = arrivalStrengths(bars, rawKicks, null, null, settle, tuning.settleWeight);
const pinned = new Set(movePinned);
for (const b of refined) if (b > 0 && b < bars.count && physical[b] >= tuning.stayPinScore) pinned.add(b);
console.log('  pinned:', [...pinned].sort((a, b) => a - b).join(' ') || '(none)');
const bounds = rephaseToPins(refined, pinned, bars.count, tuning, movePinned);
stage('rephaseToPins', bounds);

const groups = groupSegments(sim, bars.count, bounds);
const barGroup = barGroups(bounds, groups.group, bars.count);
const quantise = (stream: DrumStream) =>
	quantiseOnsets(stream, { beats, beatsPerBar, downbeatPhase, barGroup, duration });
const kicks = countPerBar(quantise(detected.kick).times, bars.time, bars.count);
const snares = countPerBar(quantise(detected.snare).times, bars.time, bars.count);

const barsDb = bandLevels(features.spec, bars.time, bars.count);
const plan = arrange(
	barsDb,
	bars,
	bounds,
	groups,
	loudness.shortTerm,
	loudness.shortTermFps,
	kicks,
	snares,
	pinned,
	undefined,
	isClubFamily(context?.genreFamily ?? null)
);
segStage('arrange (DP kinds)', plan.segments);

const club = speaksClub(context?.genreFamily ?? null, loudKickRate(kicks, plan.energy, beatsPerBar));
console.log(`  club vocabulary: ${club}`);
if (!club) {
	toSongVocabulary(plan.segments);
	const lyrics = context?.lyrics;
	if (lyrics && lyrics.length > 0) {
		const spans = chorusSpansFromLyrics(lyrics, duration);
		const segEnergy = plan.segments.map((s: { startBar: number; endBar: number }) => {
			let acc = 0;
			for (let b = s.startBar; b < Math.min(s.endBar, bars.count); b++) acc += plan.energy[b];
			return acc / Math.max(1, Math.min(s.endBar, bars.count) - s.startBar);
		});
		const barTime = (bar: number) => bars.time[Math.max(0, Math.min(bars.count, bar))];
		promoteChorusesFromLyrics(plan.segments, segEnergy, barTime, spans);
		demoteVersesFromLyrics(plan.segments, barTime, spans);
	}
}
segStage('vocabulary', plan.segments);

const arrivals = arrivalStrengths(bars, rawKicks, vocal, hooks, settle, tuning.settleWeight);
const snapMoves =
	lyricLines && lyricLines.length > 0
		? snapToHooks(plan.segments, hookStarts(lyricLines), bars.time, bars.count, 2, physical)
		: [];
console.log('  snap moves:', snapMoves.map((m: { from: number; to: number }) => `${m.from}->${m.to}`).join(' ') || '(none)');
segStage('snapToHooks', plan.segments);

// Print material similarity for hook windows inside sections to distinguish an opening riff
// from a late hook.
if (lyricLines && lyricLines.length > 0) {
	const windows: number[] = [];
	let lastBar = -Infinity;
	const barAt = (t: number) => {
		let b = 0;
		while (b < bars.count - 1 && bars.time[b + 1] <= t) b++;
		return b;
	};
	for (const h of [...hookStarts(lyricLines)].sort((a, b) => a.t - b.t)) {
		const b = barAt(h.t);
		if (b - lastBar < 4) continue;
		lastBar = b;
		windows.push(b);
	}
	const mean = (rows: number[], cols: number[], skipDiagonal: boolean) => {
		let acc = 0;
		let n = 0;
		for (const i of rows) {
			for (const j of cols) {
				if (skipDiagonal && i === j) continue;
				acc += sim[i * bars.count + j];
				n++;
			}
		}
		return n > 0 ? acc / n : 0;
	};
	const range = (from: number, to: number) =>
		Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
	console.log('');
	console.log('hook placement candidates (window inside a chorus-class section):');
	const starts = plan.segments.map((s: { startBar: number }) => s.startBar);
	for (const w of windows) {
		const s = plan.segments.find(
			(x: { startBar: number; endBar: number }) => w > x.startBar && w < x.endBar
		);
		if (!s) continue;
		if (s.kind !== 'chorus' && s.kind !== 'drop') continue;
		const nearest = starts.reduce((a: number, b: number) =>
			Math.abs(b - w) < Math.abs(a - w) ? b : a
		);
		const lead = range(s.startBar, w);
		const body = range(w, Math.min(s.endBar, bars.count));
		const self = mean(body, body, true);
		const cross = mean(lead, body, false);
		const avg = (bs: number[], col: Float64Array | Uint8Array | Float32Array) =>
			bs.reduce((a, b) => a + col[b], 0) / Math.max(1, bs.length);
		console.log(
			`  window ${String(w).padStart(3)}  in ${s.kind}@${s.startBar}-${s.endBar}` +
				`  nearest start ${nearest} (${Math.abs(nearest - w)} bars)` +
				`  lead ${lead.length}b body ${body.length}b` +
				`  ratio ${(self > 0 ? cross / self : 1).toFixed(3)}` +
				`  energy ${avg(lead, plan.energy).toFixed(2)}/${avg(body, plan.energy).toFixed(2)}` +
				`  vocal ${avg(lead, vocal).toFixed(2)}/${avg(body, vocal).toFixed(2)}` +
				`  hookbars ${avg(lead, hooks).toFixed(2)}/${avg(body, hooks).toFixed(2)}`
		);
	}
}

consolidateSections(
	plan.segments,
	arrivals,
	sim,
	bars.count,
	tuning.consolidateFloor,
	plan.energy,
	new Set([...pinned, ...snapMoves.map((m: { to: number }) => m.to)])
);
segStage('consolidateSections (final)', plan.segments);

// The fidelity gate: the same inputs through the real pipeline. A MISMATCH line means the
// mirror above no longer reproduces analyze.ts and the trace cannot be trusted.
const real = analyzeTrack({
	mono: decoded.mono,
	sampleRate: decoded.sampleRate,
	duration,
	hash: 'stagetrace',
	trackId: 'file-000000000000',
	title: id,
	context,
	beats: tracked.beats,
	downbeats: tracked.downbeats,
	tuning
});
const mine = plan.segments.map((s: { kind: string; startBar: number }) => `${s.kind}@${s.startBar}`).join(' ');
const its = real.sections.map((s) => `${s.kind}@${s.startBar}`).join(' ');
console.log('');
console.log('analyzeTrack:', its);
if (mine === its) console.log('MATCH: mirror == analyzeTrack');
else {
	console.log('MISMATCH between this mirror and analyzeTrack - trust nothing above');
	console.log('  mirror:', mine);
	console.log('  real:  ', its);
}
if (real.tempo.beatsPerBar !== beatsPerBar || real.tempo.downbeatPhase !== downbeatPhase)
	console.log(`MISMATCH meter: blob ${beatsPerBar}/${downbeatPhase}, analyzeTrack ${real.tempo.beatsPerBar}/${real.tempo.downbeatPhase}`);
const shipped = blob.sections.map((s) => `${s.kind}@${s.startBar}`).join(' ');
if (its !== shipped) console.log('note: cached blob differs (stale version or model drums):', shipped);

console.log('');
console.log('bar   time  arrival  phys   rms    kicks vocal hook');
for (let b = Math.max(1, from); b < Math.min(bars.count, to); b++) {
	const marks: string[] = [];
	if (plan.segments.some((s: { startBar: number }) => s.startBar === b)) marks.push('<== final');
	if (refined.includes(b) && !bounds.includes(b)) marks.push('(refine had it)');
	if (rough.includes(b) && !refined.includes(b)) marks.push('(rough had it)');
	console.log(
		String(b).padStart(3),
		bars.time[b].toFixed(1).padStart(6),
		arrivals[b].toFixed(2).padStart(7),
		physical[b].toFixed(2).padStart(6),
		bars.rms[b].toFixed(3).padStart(6),
		String(rawKicks[b]).padStart(5),
		vocal[b].toFixed(2).padStart(5),
		String(hooks[b]).padStart(4),
		marks.join(' ')
	);
}

function stage(name: string, b: readonly number[]): void {
	console.log(`${name}: ${b.join(' ')}`);
}
function segStage(name: string, segs: readonly { kind: string; startBar: number }[]): void {
	console.log(`${name}: ${segs.map((s) => `${s.kind}@${s.startBar}`).join(' ')}`);
}
function countPerBar(times: readonly number[], barTime: Float64Array, count: number): Int32Array {
	const out = new Int32Array(count);
	let i = 0;
	for (let b = 0; b < count; b++) {
		const to2 = barTime[b + 1];
		while (i < times.length && times[i] < barTime[b]) i++;
		let n = 0;
		while (i + n < times.length && times[i + n] < to2) n++;
		out[b] = n;
	}
	return out;
}
