// What the analysis makes of one cached track, movements and all, from its stored beats.
//
//   MV_CACHE_DIR=... node bench/movementprobe.ts <trackId> [--no-hand-maps] [--no-marks] [--no-drums] [--out=file]
//
// Starts from the model's own count - the `heard` streams a blob written at ANALYSIS 26 or
// later carries, else a fresh tracking run cached in bench/corpus/.beats/app-<id>.json for
// the bench to share - never from the blob's `beats`, which the repair has already written
// over. The drum model runs too, so the section table is the one ingest writes. It exists
// to read movements, tempo per song and the per-song section table at a glance after an
// analyser change.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, decodeAudio, handMapInput, publishedLevel, readContext } from '@mv/analysis';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';
import { Adtof } from '../packages/analysis/src/adtof.ts';
import { DEFAULT_TUNING, type GuardDecision, type StructureTuning } from '../packages/analysis/src/structure.ts';

const id = process.argv[2];
if (!id) throw new Error('usage: node bench/movementprobe.ts <trackId> [--no-hand-maps] [--no-marks]');
const noMaps = process.argv.includes('--no-hand-maps');
const noMarks = process.argv.includes('--no-marks');

const files = readdirSync(CACHE_DIR);
const audio = files.find((x) => x.startsWith(`${id}.`) && /\.(m4a|webm|opus|mp3|ogg|oga|aac|wav|flac|mp4|mka)$/i.test(x));
if (!audio) throw new Error(`no audio for ${id} in ${CACHE_DIR}`);
const cached = JSON.parse(readFileSync(join(CACHE_DIR, `${id}.analysis.json`), 'utf8')) as {
	title: string;
	beats: number[];
	downbeats?: number[];
	heard?: { beats: number[]; downbeats: number[] };
};
const decoded = await decodeAudio(join(CACHE_DIR, audio));
const BEATS = join(import.meta.dirname, 'corpus', '.beats');
const probed = join(BEATS, `app-${id}.json`);
let heard = cached.heard;
if (!heard && existsSync(probed)) heard = JSON.parse(readFileSync(probed, 'utf8')) as { beats: number[]; downbeats: number[] };
if (!heard) {
	const model = await BeatThis.create();
	heard = await model.run(decoded.mono);
	await model.close();
	mkdirSync(BEATS, { recursive: true });
	writeFileSync(probed, JSON.stringify(heard));
	console.log(`tracked ${heard.beats.length} beats and ${heard.downbeats.length} downbeats fresh; cached at ${probed}`);
}
const hand = noMaps ? {} : await handMapInput(id);
if (noMarks) {
	delete hand.movements;
	delete hand.movementVetoes;
}
// The kit the app hears: the drum model, listening at its own rate, exactly as ingest runs
// it. Without it the DSP detector counts 808 notes as kicks and the kit-driven labels -
// chorus against verse on HIGHEST IN THE ROOM - are not the app's. --no-drums skips it.
let drums: Awaited<ReturnType<Adtof['run']>> | undefined;
if (!process.argv.includes('--no-drums')) {
	const model = await Adtof.create();
	if (model) {
		try {
			const wide = await decodeAudio(join(CACHE_DIR, audio), 44100);
			drums = await model.run(wide.mono);
		} finally {
			await model.close();
		}
	}
}
const probe: {
	arrivals?: Float32Array;
	physical?: Float32Array;
	kicks?: Int32Array;
	settle?: Float32Array | null;
	components?: { step: Float32Array; kit: Float32Array; dip: Float32Array; novelty: Float32Array; voice: Float32Array };
	fills?: Uint8Array;
	guard: GuardDecision[];
	stages: { name: string; bounds: number[] }[];
} = { guard: [], stages: [] };
// A structure-tuning override, JSON, so a variant the sweep scores can be read here in full:
//   --tuning='{"pickupGuard":true,"fillVeto":true}'
const tuningArg = process.argv.find((a) => a.startsWith('--tuning='))?.slice(9);
const tuning = tuningArg ? { ...DEFAULT_TUNING, ...(JSON.parse(tuningArg) as Partial<StructureTuning>) } : undefined;
// The level the app reads the grid at: ingest re-reads the beats against the published
// tempo, and without the same step here Stranded probes at 92 while the app plays it at 185.
const context = (await readContext(id)) ?? undefined;
const level = context?.publishedBpm
	? publishedLevel(heard.beats, context.publishedBpm, context.genreFamily, { downbeats: heard.downbeats, snares: drums?.snare.times })
	: null;
const analysis = analyzeTrack({
	probe,
	metricalLevel: level ?? undefined,
	mono: decoded.mono,
	sampleRate: decoded.sampleRate,
	duration: decoded.duration,
	hash: decoded.hash,
	trackId: id,
	title: cached.title,
	beats: heard.beats,
	downbeats: heard.downbeats,
	drums,
	context,
	tuning,
	...hand
});

const outPath = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
if (outPath) {
	// The per-bar evidence rides along for the bench, outside the contract.
	const round = (xs: ArrayLike<number> | null | undefined) => Array.from(xs ?? [], (v) => Math.round(v * 100) / 100);
	const evidence = {
		arrivals: round(probe.arrivals),
		physical: round(probe.physical),
		settle: round(probe.settle),
		components: probe.components
			? { step: round(probe.components.step), kit: round(probe.components.kit), dip: round(probe.components.dip), novelty: round(probe.components.novelty), voice: round(probe.components.voice) }
			: undefined,
		fills: Array.from(probe.fills ?? []),
		guard: probe.guard,
		stages: probe.stages
	};
	writeFileSync(outPath, JSON.stringify({ ...analysis, _probe: evidence }));
}
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
console.log(`${cached.title}  ${analysis.tempo.bpm} bpm median, ${analysis.bars.length} bars, ${analysis.sections.length} sections`);
for (const m of analysis.movements ?? []) {
	console.log(`  movement ${clock(m.startTime)}-${clock(m.endTime)}  bars ${m.startBar}-${m.endBar}  ${m.bpm.toFixed(1)} bpm  ${m.key.name} (${m.key.confidence})  ${m.source}${m.note ? `: ${m.note}` : ''}`);
}
for (const s of analysis.sections) {
	console.log(
		`  ${String(s.movement ?? '').padStart(2)}  ${s.kind.padEnd(9)} ${clock(s.startTime).padStart(5)}-${clock(s.endTime).padEnd(5)} bars ${String(s.startBar).padStart(3)}-${String(s.endBar).padEnd(3)} e${String(s.meanEnergy).padStart(3)} rank ${String(s.energyRank).padStart(2)} grp ${s.group}${s.repeatOf !== null ? ` rep ${s.repeatOf}` : ''}`
	);
}
const durations = analysis.tempo.barTimes.slice(1).map((t, i) => t - analysis.tempo.barTimes[i]);
console.log('  bar seconds: ' + durations.map((d) => d.toFixed(2)).join(' '));
for (const g of probe.guard) {
	console.log(
		`  guard ${g.here} -> ${g.to}: ${g.impact ? `allowed (${g.impact})` : 'refused'}  physics ${g.physics.toFixed(2)} kit ${g.kit.toFixed(2)} novelty ${g.novelty.toFixed(2)} voice ${g.voice.toFixed(1)} collapse ${g.collapse.toFixed(2)} level before ${g.levelBefore.map((v) => v.toFixed(2)).join('/')} depth ${g.depthBefore.toFixed(1)} dB`
	);
}
