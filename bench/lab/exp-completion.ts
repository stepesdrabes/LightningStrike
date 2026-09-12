// node bench/lab/exp-completion.ts [--tracks=Rock,Disco]
// Pattern completion variants (bench/lab/quantise-variant.ts) on the cached analyzeTrack inputs:
// snapped model kick/snare, the DSP hat as shipped, and the snapped model hat as a candidate.
// Writes lab/completion.{md,json} (per-variant accounting), completion-stages.* (kick, snare,
// DSP hat) and completion-modelhat.* (model hat only), all scored against MDB Drums.
import type { DrumStream } from '../../packages/analysis/src/drums.ts';
import { snapTimesToOnsets } from '../../packages/analysis/src/drums.ts';
import { quantiseOnsets } from '../../packages/analysis/src/quantise.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	KIT, WINDOW, activations, dirs, evaluate, fmt, modelStreams, nearestDistance, quantileOf,
	quantiseInputs, shipRound, shippedDetected, signed, writeJson, type Kind, type Labels,
	type StageSummary, type Times
} from './mdb.ts';
import { SHIPPED, quantiseVariant, type Decision, type VariantParams } from './quantise-variant.ts';

const only = process.argv.find((a) => a.startsWith('--tracks='))?.slice(9).split(',') ?? [];

const v = (over: Partial<VariantParams>): VariantParams => ({ ...SHIPPED, ...over });
type PerClass = Record<Kind, VariantParams>;
const perClass = (kick: VariantParams, snare: VariantParams, hat: VariantParams): PerClass => ({ kick, snare, hat });
const paramsFor = (spec: VariantParams | PerClass, kind: Kind): VariantParams =>
	'kick' in spec ? spec[kind] : spec;
const VARIANTS: Record<string, VariantParams | PerClass> = {
	shipped: SHIPPED,
	'completion-off': v({ promote: false, demote: false }),
	'demote-off': v({ demote: false }),
	'promote-off': v({ promote: false }),
	'pe-0.20': v({ promoteEvidence: 0.2 }),
	'pe-0.30': v({ promoteEvidence: 0.3 }),
	'pe-0.40': v({ promoteEvidence: 0.4 }),
	'ps-0.60': v({ patternSupport: 0.6 }),
	'ps-0.75': v({ patternSupport: 0.75 }),
	'cohort-3': v({ minCohort: 3 }),
	'cohort-4': v({ minCohort: 4 }),
	'floor-0.08': v({ inventedFloor: 0.08 }),
	'floor-0.15': v({ inventedFloor: 0.15 }),
	'fixed-8': v({ cohort: 'fixed', windowBars: 8 }),
	'fixed-4': v({ cohort: 'fixed', windowBars: 4 }),
	'demote-0.06-0.15': v({ demoteSupport: 0.06, demoteLevel: 0.15 }),
	'combo-pe0.30-ps0.60': v({ promoteEvidence: 0.3, patternSupport: 0.6 }),
	'combo-pe0.30-floor0.08': v({ promoteEvidence: 0.3, inventedFloor: 0.08 }),
	'combo-pe0.30-ps0.60-floor0.08': v({ promoteEvidence: 0.3, patternSupport: 0.6, inventedFloor: 0.08 }),
	'combo-pe0.30-demote-off': v({ promoteEvidence: 0.3, demote: false }),
	'strong-0.4': v({ minStrongest: 0.4 }),
	'strong-0.6': v({ minStrongest: 0.6 }),
	'support-0.3': v({ minSupport: 0.3 }),
	'support-0.4': v({ minSupport: 0.4 }),
	'count-0.67': v({ minCount: 0.67 }),
	'count-0.8': v({ minCount: 0.8 }),
	'demstrong-0.6': v({ demoteStrongest: 0.6 }),
	'demstrong-0.9': v({ demoteStrongest: 0.9 }),
	'rec-A': perClass(v({ promote: false }), v({ demote: false }), SHIPPED),
	'rec-B': perClass(v({ promoteEvidence: 0.3 }), v({ demote: false }), v({ inventedFloor: 0.15 })),
	'rec-C': perClass(v({ promoteEvidence: 0.3 }), v({ demoteSupport: 0.06, demoteLevel: 0.15 }), SHIPPED),
	'rec-D': perClass(v({ promote: false, demote: false }), v({ demote: false }), SHIPPED),
	'rec-E': perClass(v({ minStrongest: 0.4 }), v({ demote: false }), SHIPPED),
	'rec-F': perClass(v({ minStrongest: 0.4, minCount: 0.67 }), v({ demote: false }), SHIPPED),
	'rec-G': perClass(v({ minSupport: 0.4 }), v({ demote: false }), SHIPPED),
	'rec-H': perClass(v({ minStrongest: 0.4 }), v({ demoteStrongest: 0.9 }), SHIPPED),
	'rec-I': perClass(v({ minStrongest: 0.4 }), SHIPPED, SHIPPED)
};

interface Counter {
	invented: number;
	inventedTrue: number;
	demoted: number;
	demotedTrue: number;
	floored: number;
	flooredTrue: number;
}
const counters = new Map<string, Counter>();
const counter = (key: string): Counter => {
	let c = counters.get(key);
	if (!c) {
		c = { invented: 0, inventedTrue: 0, demoted: 0, demotedTrue: 0, floored: 0, flooredTrue: 0 };
		counters.set(key, c);
	}
	return c;
};
const isTrue = (ref: readonly number[], t: number) => nearestDistance(ref, t) <= WINDOW + 1e-9;
interface Tagged extends Decision {
	track: string;
	kind: string;
	action: 'invent' | 'demote';
	real: boolean;
}
const decisions: Tagged[] = [];

function run(stage: string, kind: Kind, stream: DrumStream, q: Awaited<ReturnType<typeof quantiseInputs>>,
	params: VariantParams, ref: readonly number[], track: string): number[] {
	const out = quantiseVariant(stream, q, params);
	if (stage === 'shipped' || stage === 'shipped/mh') {
		const label = stage === 'shipped/mh' ? 'hat-model' : kind === 'hat' ? 'hat-dsp' : kind;
		for (const d of out.inventedInfo) decisions.push({ ...d, track, kind: label, action: 'invent', real: isTrue(ref, d.time) });
		for (const d of out.demotedInfo) decisions.push({ ...d, track, kind: label, action: 'demote', real: isTrue(ref, d.time) });
	}
	for (const c of [counter(`${stage}|${kind}`), counter(`${stage}|${kind}|${track}`)]) {
		for (let i = 0; i < out.times.length; i++) {
			if (!out.invented[i]) continue;
			c.invented++;
			if (isTrue(ref, out.times[i])) c.inventedTrue++;
		}
		for (const t of out.demoted) {
			c.demoted++;
			if (isTrue(ref, t)) c.demotedTrue++;
		}
		for (const t of out.floored) {
			c.floored++;
			if (isTrue(ref, t)) c.flooredTrue++;
		}
	}
	return shipRound(out.times);
}

const sameTimes = (a: readonly number[], b: readonly number[]) =>
	a.length === b.length && a.every((t, i) => t === b[i]);

async function inputs(name: string, labels: Labels) {
	const act = await activations(name);
	const q = await quantiseInputs(name);
	const model = modelStreams(act);
	const shipped = shippedDetected(q, model);
	for (const kind of KIT) {
		const mine = quantiseVariant(shipped[kind], q, SHIPPED).times;
		if (!sameTimes(mine, quantiseOnsets(shipped[kind], q).times) || !sameTimes(mine, q.final[kind].times)) {
			throw new Error(`${name}: quantiseVariant(SHIPPED) does not reproduce quantiseOnsets for ${kind}.`);
		}
	}
	const modelHat: DrumStream = { ...model.hat, times: snapTimesToOnsets(model.hat.times, q.odf, q.fps, q.snapRadius) };
	return { q, shipped, modelHat, labels };
}

const stagesRun = await evaluate('completion-stages', async (track, labels) => {
	const { q, shipped } = await inputs(track.name, labels);
	const stages: Record<string, Partial<Times>> = {};
	for (const [stage, spec] of Object.entries(VARIANTS)) {
		stages[stage] = Object.fromEntries(KIT.map((kind) =>
			[kind, run(stage, kind, shipped[kind], q, paramsFor(spec, kind), labels[kind], track.name)])) as Times;
	}
	return stages;
}, {
	only, quiet: true,
	notes: [
		'Every stage: snapped model kick and snare, the DSP hat, quantised by bench/lab/quantise-variant.ts, ms-rounded.',
		'shipped uses the shipped constants and reproduces quantiseOnsets exactly (asserted per track and class).'
	]
});

const hatRun = await evaluate('completion-modelhat', async (track, labels) => {
	const { q, modelHat } = await inputs(track.name, labels);
	const stages: Record<string, Partial<Times>> = {};
	for (const [stage, spec] of Object.entries(VARIANTS)) {
		stages[stage] = { hat: run(`${stage}/mh`, 'hat', modelHat, q, paramsFor(spec, 'hat'), labels.hat, track.name) };
	}
	stages['model-hat-unquantised'] = { hat: shipRound(modelHat.times) };
	return stages;
}, {
	only, quiet: true,
	notes: ['Hat only: the ADTOF hat class at threshold 0.22, snapped to the odf, then quantised per variant.']
});

interface Cell {
	kind: string;
	invented: number;
	inventedTrue: number;
	demoted: number;
	demotedTrue: number;
	floored: number;
	flooredTrue: number;
	est: number;
	p: number;
	r: number;
	f: number;
	tmF: number;
	dF: number;
	dTmF: number;
}
const rate = (a: number, b: number) => (b > 0 ? a / b : 0);
const cell = (stage: string, kind: Kind, summary: Record<string, StageSummary>, base: StageSummary, key: string, label: string): Cell => {
	const s = summary[stage].classes[kind]!;
	const b = base.classes[kind]!;
	const c = counter(key);
	return {
		kind: label, ...c, est: s.est, p: s.pooled.p, r: s.pooled.r, f: s.pooled.f, tmF: s.trackMean.f,
		dF: s.pooled.f - b.pooled.f, dTmF: s.trackMean.f - b.trackMean.f
	};
};
const table: Record<string, Cell[]> = {};
for (const stage of Object.keys(VARIANTS)) {
	table[stage] = [
		...KIT.map((kind) => cell(stage, kind, stagesRun.summary, stagesRun.summary.shipped, `${stage}|${kind}`, kind === 'hat' ? 'hat-dsp' : kind)),
		cell(stage, 'hat', hatRun.summary, hatRun.summary.shipped, `${stage}/mh|hat`, 'hat-model')
	];
}

const lines: string[] = [];
lines.push('# completion', '');
lines.push(`${stagesRun.rows.length} tracks. Variants of quantiseOnsets on cached analyzeTrack inputs; ` +
	'"true" means within 50 ms of an MDB label of that class. Deltas are against the shipped variant of the same input ' +
	'(shipped kick/snare/hat-dsp equal drumscore final).', '');
lines.push('| Variant | Class | est | invented (true) | true rate | demoted (true) | true rate | floored (true) | P | R | F | delta F | F track-mean | delta |');
lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const [stage, cells] of Object.entries(table)) {
	for (const c of cells) {
		lines.push(`| ${stage} | ${c.kind} | ${c.est} | ${c.invented} (${c.inventedTrue}) | ${fmt(rate(c.inventedTrue, c.invented), 2)} `
			+ `| ${c.demoted} (${c.demotedTrue}) | ${fmt(rate(c.demotedTrue, c.demoted), 2)} | ${c.floored} (${c.flooredTrue}) `
			+ `| ${fmt(c.p)} | ${fmt(c.r)} | ${fmt(c.f)} | ${signed(c.dF)} | ${fmt(c.tmF)} | ${signed(c.dTmF)} |`);
	}
}
lines.push('', '## Class-mean pooled F (kick, snare, hat-dsp) and hat-model F', '');
lines.push('| Variant | class-mean F | delta | track-mean F | delta | hat-model F | delta |', '|---|---:|---:|---:|---:|---:|---:|');
for (const stage of Object.keys(VARIANTS)) {
	const s = stagesRun.summary[stage];
	const b = stagesRun.summary.shipped;
	const h = hatRun.summary[stage].classes.hat!;
	const hb = hatRun.summary.shipped.classes.hat!;
	lines.push(`| ${stage} | ${fmt(s.classMeanFPooled)} | ${signed(s.classMeanFPooled - b.classMeanFPooled)} | ${fmt(s.trackMeanF)} `
		+ `| ${signed(s.trackMeanF - b.trackMeanF)} | ${fmt(h.pooled.f)} | ${signed(h.pooled.f - hb.pooled.f)} |`);
}
const unq = hatRun.summary['model-hat-unquantised'].classes.hat!;
lines.push('', `Model hat unquantised (snapped peaks only): P ${fmt(unq.pooled.p)} R ${fmt(unq.pooled.r)} F ${fmt(unq.pooled.f)}, track-mean F ${fmt(unq.trackMean.f)}.`);
lines.push('', '## Per track, shipped: invented (true) / demoted (true); F shipped / promote-off (kick), demote-off (snare), completion-off (hat)', '');
lines.push('| Track | kick inv | kick dem | kick F | snare inv | snare dem | snare F | hat inv | hat dem | hat F |');
lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
const fOf = (row: (typeof stagesRun.rows)[number], stage: string, kind: Kind) => {
	const sc = row.stages[stage]?.[kind];
	return sc && sc.ref > 0 ? fmt(sc.f, 2) : '-';
};
for (const row of stagesRun.rows) {
	const c = (kind: Kind) => counter(`shipped|${kind}|${row.name}`);
	const inv = (kind: Kind) => `${c(kind).invented} (${c(kind).inventedTrue})`;
	const dem = (kind: Kind) => `${c(kind).demoted} (${c(kind).demotedTrue})`;
	lines.push(`| ${row.name.replace('MusicDelta_', '')} | ${inv('kick')} | ${dem('kick')} | ${fOf(row, 'shipped', 'kick')} / ${fOf(row, 'promote-off', 'kick')} `
		+ `| ${inv('snare')} | ${dem('snare')} | ${fOf(row, 'shipped', 'snare')} / ${fOf(row, 'demote-off', 'snare')} `
		+ `| ${inv('hat')} | ${dem('hat')} | ${fOf(row, 'shipped', 'hat')} / ${fOf(row, 'completion-off', 'hat')} |`);
}
const CLASSES4 = ['kick', 'snare', 'hat-dsp', 'hat-model'];
lines.push('', '## Shipped decisions: quantiles (p10 / p50 / p90) of the vote that made them, true vs false', '');
lines.push('| Class | Action | Real | n | support | strongest | share | count | members | evidence | level |');
lines.push('|---|---|---|---:|---|---|---|---|---|---|---|');
const q3 = (xs: number[], d = 2) => [0.1, 0.5, 0.9].map((qq) => fmt(quantileOf(xs, qq), d)).join(' / ');
for (const kind of CLASSES4) {
	for (const action of ['invent', 'demote'] as const) {
		for (const real of [true, false]) {
			const rows = decisions.filter((d) => d.kind === kind && d.action === action && d.real === real);
			if (rows.length === 0) continue;
			const pick = (f: (d: Tagged) => number) => rows.map(f);
			lines.push(`| ${kind} | ${action} | ${real ? 'true' : 'false'} | ${rows.length} | ${q3(pick((d) => d.support))} | ${q3(pick((d) => d.strongest))} `
				+ `| ${q3(pick((d) => d.share))} | ${q3(pick((d) => d.count))} | ${q3(pick((d) => d.members), 0)} | ${q3(pick((d) => d.evidence))} | ${q3(pick((d) => d.level))} |`);
		}
	}
}
lines.push('', '## Gate survivors among shipped inventions: kept true / kept false (of true / false)', '');
const gates: [string, (d: Tagged) => boolean][] = [
	['support >= 0.2', (d) => d.support >= 0.2], ['support >= 0.3', (d) => d.support >= 0.3], ['support >= 0.4', (d) => d.support >= 0.4],
	['count >= 0.5', (d) => d.count >= 0.5], ['count >= 0.67', (d) => d.count >= 0.67], ['count >= 0.8', (d) => d.count >= 0.8],
	['strongest >= 0.4', (d) => d.strongest >= 0.4], ['strongest >= 0.6', (d) => d.strongest >= 0.6],
	['evidence >= 0.2', (d) => d.evidence >= 0.2], ['members >= 4', (d) => d.members >= 4]
];
lines.push(`| Gate | ${CLASSES4.join(' | ')} |`, '|---|---:|---:|---:|---:|');
for (const [name, keep] of gates) {
	const cells = CLASSES4.map((kind) => {
		const rows = decisions.filter((d) => d.kind === kind && d.action === 'invent');
		const t = rows.filter((d) => d.real);
		const f = rows.filter((d) => !d.real);
		return `${t.filter(keep).length} / ${f.filter(keep).length} (${t.length} / ${f.length})`;
	});
	lines.push(`| ${name} | ${cells.join(' | ')} |`);
}
lines.push('', 'Demotions kept when cohort strongest >= x: true / false (of true / false):', '');
lines.push(`| Gate | ${CLASSES4.join(' | ')} |`, '|---|---:|---:|---:|---:|');
for (const x of [0.3, 0.4, 0.5, 0.6]) {
	const cells = CLASSES4.map((kind) => {
		const rows = decisions.filter((d) => d.kind === kind && d.action === 'demote');
		const kept = rows.filter((d) => d.strongest >= x);
		return `${kept.filter((d) => d.real).length} / ${kept.filter((d) => !d.real).length} (${rows.filter((d) => d.real).length} / ${rows.filter((d) => !d.real).length})`;
	});
	lines.push(`| strongest >= ${x} | ${cells.join(' | ')} |`);
}
writeJson(join(dirs.lab, 'completion-decisions.json'), decisions);
const md = lines.join('\n') + '\n';
const mdPath = join(dirs.lab, 'completion.md');
writeJson(join(dirs.lab, 'completion.json'), { variants: VARIANTS, table, stages: stagesRun.jsonPath, modelHat: hatRun.jsonPath });
writeFileSync(mdPath, md);
console.log(md);
console.log(`Wrote ${mdPath}`);
