// Score owner maps by authoritative time and strict nine-kind labels; report F1, confusion and
// collapse.
// MV_CACHE_DIR=<cache> node bench/mapscore.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { SECTION_KINDS } from '@mv/core';

const cache = benchmarkCache();
const judgeDir = join(cache, 'judge');
if (!existsSync(judgeDir)) throw new Error(`no judge dir at ${judgeDir}`);

interface JudgedSection { kind: string; startTime: number; endTime: number }
interface Judgement { trackId: string; title: string; sections?: JudgedSection[] | null }

const KINDS = [...SECTION_KINDS] as string[];
const confusion = new Map<string, Map<string, number>>();
const bump = (hand: string, model: string, secs: number) => {
	const row = confusion.get(hand) ?? new Map<string, number>();
	row.set(model, (row.get(model) ?? 0) + secs);
	confusion.set(hand, row);
};

let maps = 0;
let degenerate = 0;
const perTrack: string[] = [];
for (const f of readdirSync(judgeDir).filter((x) => x.endsWith('.json'))) {
	const j = JSON.parse(readFileSync(join(judgeDir, f), 'utf8')) as Judgement;
	if (!j.sections?.length) continue;
	const blobPath = join(cache, `${j.trackId}.analysis.json`);
	if (!existsSync(blobPath)) continue;
	const analysis = JSON.parse(readFileSync(blobPath, 'utf8'));
	maps++;

	for (const s of j.sections) {
		if (!KINDS.includes(s.kind)) console.log(`WARNING ${j.title}: unknown kind '${s.kind}' - not in SECTION_KINDS`);
	}

	const kindAt = (secs: { kind: string; startTime: number; endTime: number }[], t: number) =>
		secs.find((x) => t >= x.startTime && t < x.endTime)?.kind ?? null;
	const model = analysis.sections as { kind: string; startTime: number; endTime: number }[];
	const duration = analysis.duration ?? j.sections[j.sections.length - 1].endTime;

	let agree = 0;
	let n = 0;
	const modelSeen = new Set<string>();
	for (let t = 0.5; t < duration; t += 1) {
		const hand = kindAt(j.sections, t);
		const pred = kindAt(model, t);
		if (!hand || !pred) continue;
		n++;
		modelSeen.add(pred);
		if (hand === pred) agree++;
		bump(hand, pred, 1);
	}
	if (modelSeen.size <= 1 && n > 30) degenerate++;
	perTrack.push(`${j.title.slice(0, 30).padEnd(30)} strict ${((100 * agree) / Math.max(1, n)).toFixed(0).padStart(3)}%  model kinds ${modelSeen.size}`);
}

if (maps === 0) {
	console.log('no hand-drawn maps in this cache yet');
	process.exit(0);
}

console.log(`${maps} hand-drawn maps\n`);
for (const line of perTrack) console.log('  ' + line);

// Per-kind F1 against the hand truth, seconds-weighted.
console.log('\nper-kind (hand truth rows):');
let macroAcc = 0;
let macroN = 0;
for (const kind of KINDS) {
	const row = confusion.get(kind);
	const truth = row ? [...row.values()].reduce((a, v) => a + v, 0) : 0;
	if (truth === 0) continue;
	const tp = row?.get(kind) ?? 0;
	let predicted = 0;
	for (const r of confusion.values()) predicted += r.get(kind) ?? 0;
	const p = predicted > 0 ? tp / predicted : 0;
	const r = tp / truth;
	const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0;
	macroAcc += f1;
	macroN++;
	const top = row ? [...row.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}s`).join(', ') : '';
	console.log(`  ${kind.padEnd(10)} F1 ${(100 * f1).toFixed(0).padStart(3)}%  (P ${(100 * p).toFixed(0)}% R ${(100 * r).toFixed(0)}%)  model says: ${top}`);
}
console.log(`\nmacro F1 ${(100 * macroAcc / Math.max(1, macroN)).toFixed(0)}%  ·  degenerate tracks ${degenerate}/${maps}`);
