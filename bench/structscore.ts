import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sectionBase, type SectionKind } from '@mv/core';
import { decodeAudio } from '@mv/analysis';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { DEFAULT_TUNING, type StructureTuning } from '../packages/analysis/src/structure.ts';
import { DEFAULT_LABEL_TUNING, type LabelTuning } from '../packages/analysis/src/arrange.ts';
import { fMeasure } from './metrics.ts';
import { KIND_SONG } from './kinds.ts';

/**
 * Score structure against Harmonix song labels or Raveform club labels, reusing cached model
 * beats.
 * node bench/structscore.ts --dataset harmonix --limit 60 --variant current
 */
const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : d;
};
const dataset = flag('dataset', 'harmonix');
const limit = Number(flag('limit', '60'));
const variantName = flag('variant', 'current');

const VARIANTS: Record<string, StructureTuning> = {
	// Everything the last session shipped.
	current: { ...DEFAULT_TUNING },
	// No re-phasing at all: refinement still moves single boundaries onto arrivals.
	off: { ...DEFAULT_TUNING, rephaseReach: 0 },
	// Re-phasing kept but disciplined: short reach, decisive pins only, near-unanimity.
	strict: { refineFloor: 0.6, pinScore: 2, rephaseReach: 1, rephaseMinPins: 3, rephaseAgreement: 0.8, consolidateFloor: 0, settleWeight: 0, refineReach: 1 },
	// Strict, and boundaries only move onto DECISIVE arrivals - the kick-wall class.
	tight: { refineFloor: 2, pinScore: 2, rephaseReach: 1, rephaseMinPins: 3, rephaseAgreement: 0.8, consolidateFloor: 0, settleWeight: 0, refineReach: 1 },
	// No refinement follow-up at all, approximating the pipeline before this work.
	none: { refineFloor: 1e9, pinScore: 1e9, rephaseReach: 0, rephaseMinPins: 99, rephaseAgreement: 1, consolidateFloor: 0, settleWeight: 0, refineReach: 1 },
	// Same-kind seam consolidation, swept over the arrival floor a seam must clear to
	// survive. cons0 is the explicit baseline whatever the shipped default becomes.
	cons0: { ...DEFAULT_TUNING, consolidateFloor: 0 },
	cons08: { ...DEFAULT_TUNING, consolidateFloor: 0.8 },
	cons12: { ...DEFAULT_TUNING, consolidateFloor: 1.2 },
	cons16: { ...DEFAULT_TUNING, consolidateFloor: 1.6 },
	cons20: { ...DEFAULT_TUNING, consolidateFloor: 2 },
	cons24: { ...DEFAULT_TUNING, consolidateFloor: 2.4 },
	cons30: { ...DEFAULT_TUNING, consolidateFloor: 3 },
	// The settling-contrast term: an arrival that persists outbids the fill before it.
	settle08: { ...DEFAULT_TUNING, settleWeight: 0.8 },
	settle12: { ...DEFAULT_TUNING, settleWeight: 1.2 },
	settle16: { ...DEFAULT_TUNING, settleWeight: 1.6 },
	settle12r2: { ...DEFAULT_TUNING, settleWeight: 1.2, refineReach: 2 },
	settle16r2: { ...DEFAULT_TUNING, settleWeight: 1.6, refineReach: 2 }
};
const tuning = VARIANTS[variantName];
if (!tuning) throw new Error(`unknown variant ${variantName}`);

/** Sweep build walk-back independently of structure tuning; wide16 retains the older baseline. */
const LABEL_VARIANTS: Record<string, LabelTuning> = {
	current: { ...DEFAULT_LABEL_TUNING },
	wide16: { maxBuildBars: 16, riseBeyondFirst: false, riseRatio: 1, breakOnBreakdown: false },
	rise16: { maxBuildBars: 16, riseBeyondFirst: true, riseRatio: 1.04, breakOnBreakdown: false },
	cap8: { maxBuildBars: 8, riseBeyondFirst: false, riseRatio: 1, breakOnBreakdown: false },
	rise8: { maxBuildBars: 8, riseBeyondFirst: true, riseRatio: 1.04, breakOnBreakdown: false },
	rise8bd: { maxBuildBars: 8, riseBeyondFirst: true, riseRatio: 1.04, breakOnBreakdown: true },
	rise12bd: { maxBuildBars: 12, riseBeyondFirst: true, riseRatio: 1.04, breakOnBreakdown: true },
	cap8bd: { maxBuildBars: 8, riseBeyondFirst: false, riseRatio: 1, breakOnBreakdown: true },
	cap12bd: { maxBuildBars: 12, riseBeyondFirst: false, riseRatio: 1, breakOnBreakdown: true }
};
const labelName = flag('labels', 'current');
const labels = LABEL_VARIANTS[labelName];
if (!labels) throw new Error(`unknown label variant ${labelName}`);
/** Evaluate MusicFM head labels through analyzeTrack using precomputed corpus embeddings. */
const useHead = argv.includes('--head');

const ROOT = join(import.meta.dirname, 'corpus');
const BEATS = join(ROOT, '.beats');
await mkdir(BEATS, { recursive: true });

const RAVEFORM_KIND: Record<string, SectionKind> = {
	intro: 'intro',
	'ambient intro': 'intro',
	buildup: 'build',
	breakdown: 'breakdown',
	drop: 'drop',
	cooldown: 'breakdown',
	bridge: 'breakdown',
	outro: 'outro',
	'ambient outro': 'outro'
};

interface RefTrack {
	id: string;
	audio: string;
	/** Annotated boundaries, seconds, interior only. */
	bounds: number[];
	/** [start, end, kind] spans in the lighting vocabulary. */
	spans: [number, number, SectionKind][];
}

async function loadHarmonix(): Promise<RefTrack[]> {
	const audioDir = join(ROOT, 'harmonix/audio');
	const segDir = join(ROOT, 'harmonixset-main/dataset/segments');
	const out: RefTrack[] = [];
	for (const f of (await readdir(audioDir)).sort()) {
		if (out.length >= limit) break;
		const id = f.replace(/\.[^.]+$/, '');
		const seg = join(segDir, `${id}.txt`);
		if (!existsSync(seg)) continue;
		const rows = (await readFile(seg, 'utf8'))
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l) => {
				const [t, label] = l.split(/\s+/);
				return { t: Number(t), label: (label ?? '').toLowerCase().replace(/[0-9_]+$/, '') };
			});
		const spans: [number, number, SectionKind][] = [];
		const bounds: number[] = [];
		for (let i = 0; i < rows.length - 1; i++) {
			const kind = KIND_SONG[rows[i].label];
			if (!kind) continue;
			spans.push([rows[i].t, rows[i + 1].t, kind]);
			if (i > 0) bounds.push(rows[i].t);
		}
		if (spans.length >= 3) out.push({ id, audio: join(audioDir, f), bounds, spans });
	}
	return out;
}

async function loadRaveform(): Promise<RefTrack[]> {
	const audioDir = join(ROOT, 'raveform/audio');
	const all = JSON.parse(
		await readFile(join(ROOT, 'raveform/structures/segments.json'), 'utf8')
	) as { key: string; sections?: { name: string; start: number; end: number }[] }[];
	const byKey = new Map(all.map((e) => [e.key, e]));
	const out: RefTrack[] = [];
	for (const f of (await readdir(audioDir)).sort()) {
		if (out.length >= limit) break;
		const key = f.replace(/\.[^.]+$/, '');
		const entry = byKey.get(key);
		if (!entry?.sections?.length) continue;
		const spans: [number, number, SectionKind][] = [];
		const bounds: number[] = [];
		for (let i = 0; i < entry.sections.length; i++) {
			const s = entry.sections[i];
			const kind = RAVEFORM_KIND[s.name.toLowerCase()];
			if (!kind) continue;
			spans.push([s.start, s.end, kind]);
			if (i > 0) bounds.push(s.start);
		}
		if (spans.length >= 3) out.push({ id: key, audio: join(audioDir, f), bounds, spans });
	}
	return out;
}

const tracks = dataset === 'harmonix' ? await loadHarmonix() : await loadRaveform();
console.error(`${dataset}: ${tracks.length} tracks, variant ${variantName}`);

let model: BeatThis | null = null;
async function beatsFor(track: RefTrack): Promise<{ beats: number[]; downbeats: number[] }> {
	const cache = join(BEATS, `${dataset}-${track.id}.json`);
	if (existsSync(cache)) return JSON.parse(await readFile(cache, 'utf8'));
	const decoded = await decodeAudio(track.audio);
	model ??= await BeatThis.create();
	const tracked = await model.run(decoded.mono);
	await writeFile(cache, JSON.stringify(tracked));
	return tracked;
}

const kindAt = (spans: [number, number, SectionKind][], t: number): SectionKind | null => {
	for (const [from, to, kind] of spans) if (t >= from && t < to) return kind;
	return null;
};

let f05 = 0;
let f3 = 0;
let exact = 0;
let base = 0;
let frames = 0;
let predSections = 0;
let refSections = 0;
let done = 0;
/** Per-kind frame counts, scored through sectionBase so club and song vocabularies compare. */
const perKind = new Map<string, { ref: number; est: number; hit: number }>();
const kindCell = (k: string) => {
	let cell = perKind.get(k);
	if (!cell) {
		cell = { ref: 0, est: 0, hit: 0 };
		perKind.set(k, cell);
	}
	return cell;
};

let head: import('../packages/analysis/src/musicfm.ts').MusicFmHead | null = null;
let missingEmb = 0;
if (useHead) {
	const { MusicFmHead } = await import('../packages/analysis/src/musicfm.ts');
	head = await MusicFmHead.create();
	if (!head) throw new Error('--head: no exported head in models/ (run bench/export-musicfm.py)');
}

async function posteriorsFor(
	track: RefTrack
): Promise<import('../packages/analysis/src/headLabels.ts').SectionPosteriors | undefined> {
	if (!head) return undefined;
	const bin = join(ROOT, '.musicfm', 'bin', `${dataset}-${track.id}.bin`);
	if (!existsSync(bin)) {
		missingEmb++;
		return undefined;
	}
	const raw = await readFile(bin);
	const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
	const frames = Math.floor(data.length / 1024);
	return {
		fps: 25 / 3,
		kinds: head.kinds,
		data: await head.label({ frames, data })
	};
}

for (const track of tracks) {
	try {
		const tracked = await beatsFor(track);
		const decoded = await decodeAudio(track.audio);
		const sectionPosteriors = await posteriorsFor(track);
		const analysis = analyzeTrack({
			mono: decoded.mono,
			sampleRate: decoded.sampleRate,
			duration: decoded.duration,
			hash: 'bench',
			trackId: 'file-000000000000',
			title: track.id,
			sectionPosteriors,
			beats: tracked.beats,
			downbeats: tracked.downbeats,
			tuning,
			labels
		});

		const estBounds = analysis.sections.slice(1).map((s) => s.startTime);
		f05 += fMeasure(track.bounds, estBounds, 0.5);
		f3 += fMeasure(track.bounds, estBounds, 3);

		const spans: [number, number, SectionKind][] = analysis.sections.map((s) => [
			s.startTime,
			s.endTime,
			s.kind
		]);
		const end = Math.min(decoded.duration, track.spans[track.spans.length - 1][1]);
		for (let t = 0.25; t < end; t += 0.5) {
			const ref = kindAt(track.spans, t);
			const est = kindAt(spans, t);
			if (!ref || !est) continue;
			frames++;
			if (ref === est) exact++;
			if (sectionBase(ref) === sectionBase(est)) base++;
			const refBase = sectionBase(ref);
			const estBase = sectionBase(est);
			kindCell(refBase).ref++;
			kindCell(estBase).est++;
			if (refBase === estBase) kindCell(refBase).hit++;
		}
		predSections += analysis.sections.length;
		refSections += track.spans.length;
		done++;
		if (done % 10 === 0) console.error(`  ${done}/${tracks.length}`);
	} catch (e) {
		console.error(`  ${track.id}: ${(e as Error).message.split('\n')[0]}`);
	}
}
if (model) await (model as BeatThis).close();
await head?.close();
if (missingEmb > 0) console.error(`  ${missingEmb} tracks had no stored embedding (rules used)`);

const pct = (v: number) => ((100 * v) / Math.max(1, frames)).toFixed(1);
console.log(
	[
		`${variantName}/${labelName}${useHead ? '/head' : ''}`.padEnd(16),
		dataset.padEnd(9),
		`n=${done}`,
		`F0.5=${(f05 / Math.max(1, done)).toFixed(3)}`,
		`F3=${(f3 / Math.max(1, done)).toFixed(3)}`,
		`label=${pct(exact)}%`,
		`base=${pct(base)}%`,
		`sections=${(predSections / Math.max(1, done)).toFixed(1)}/${(refSections / Math.max(1, done)).toFixed(1)}`
	].join('  ')
);
for (const kind of [...perKind.keys()].sort()) {
	const cell = perKind.get(kind)!;
	const precision = cell.hit / Math.max(1, cell.est);
	const recall = cell.hit / Math.max(1, cell.ref);
	const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
	console.log(
		`  ${kind.padEnd(10)} P=${(100 * precision).toFixed(1).padStart(5)}  R=${(100 * recall)
			.toFixed(1)
			.padStart(5)}  F1=${(100 * f1).toFixed(1).padStart(5)}  share est=${pct(cell.est)}% ref=${pct(cell.ref)}%`
	);
}
