// node bench/drumeval/ceiling.ts --candidates=v12e [--corpora=rbma,mdb] [--labels=strict|light] [--by=corpus|track]
// Candidate recall before Striker filters anything: the upper bound on what any selector over
// these proposals can reach. F1 ceiling assumes a perfect filter with no false positives.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EVAL_ROOT } from './evidence.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = join(EVAL_ROOT, 'candidates', flag('candidates') ?? 'v12e');
const strict = (flag('labels') ?? 'strict') === 'strict';
const only = flag('corpora')?.split(',');
const by = flag('by') ?? 'corpus';
const KIT = ['kick', 'snare', 'hat', 'cymbal', 'tom'] as const;

interface ClassBlock {
	count: number;
	times: number[];
	labels: number[];
	strictLabels: number[];
	references: number[];
	strictReferences: number[];
	excluded?: boolean;
}

interface Row { refs: number; hit: number; proposals: number; seconds: number }
const empty = (): Row => ({ refs: 0, hit: 0, proposals: 0, seconds: 0 });
const totals = new Map<string, Map<string, Row>>();
const tracks: { key: string; kind: string; refs: number; hit: number; proposals: number }[] = [];

for (const file of readdirSync(root).filter((f) => f.endsWith('.json')).sort()) {
	const meta = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
		corpus: string; name: string; classes: Record<string, ClassBlock>;
	};
	if (only && !only.includes(meta.corpus)) continue;
	if (!totals.has(meta.corpus)) totals.set(meta.corpus, new Map(KIT.map((k) => [k, empty()])));
	const corpus = totals.get(meta.corpus)!;
	for (const kind of KIT) {
		const block = meta.classes[kind];
		if (!block) continue;
		const refs = strict ? block.strictReferences : block.references;
		const labels = strict ? block.strictLabels : block.labels;
		const hit = labels.filter((l) => l === 1).length;
		const row = corpus.get(kind)!;
		row.refs += refs.length;
		row.hit += hit;
		row.proposals += block.count;
		if (refs.length) tracks.push({ key: `${meta.corpus}/${meta.name}`, kind, refs: refs.length, hit, proposals: block.count });
	}
}

const pct = (v: number) => (v * 100).toFixed(1).padStart(5);
const oracleF = (recall: number) => (2 * recall) / (1 + recall);

console.log(`candidate ceiling, ${strict ? 'strict' : 'light'} references, ${root}`);
console.log('corpus     class    refs   proposals  recall  oracleF  proposals/ref');
const grand = new Map<string, Row>(KIT.map((k) => [k, empty()]));
for (const [corpus, classes] of [...totals].sort()) {
	for (const kind of KIT) {
		const row = classes.get(kind)!;
		if (!row.refs) continue;
		const g = grand.get(kind)!;
		g.refs += row.refs;
		g.hit += row.hit;
		g.proposals += row.proposals;
		const recall = row.hit / row.refs;
		console.log(`${corpus.padEnd(10)} ${kind.padEnd(7)} ${String(row.refs).padStart(6)} ${String(row.proposals).padStart(10)}`
			+ `  ${pct(recall)}%  ${oracleF(recall).toFixed(3)}  ${(row.proposals / row.refs).toFixed(2)}`);
	}
}
console.log('');
for (const kind of KIT) {
	const row = grand.get(kind)!;
	if (!row.refs) continue;
	const recall = row.hit / row.refs;
	console.log(`${'ALL'.padEnd(10)} ${kind.padEnd(7)} ${String(row.refs).padStart(6)} ${String(row.proposals).padStart(10)}`
		+ `  ${pct(recall)}%  ${oracleF(recall).toFixed(3)}  ${(row.proposals / row.refs).toFixed(2)}`);
}

if (by === 'track') {
	console.log('\nworst tracks by candidate recall (at least 20 references)');
	for (const t of tracks.filter((t) => t.refs >= 20).sort((a, b) => a.hit / a.refs - b.hit / b.refs).slice(0, 40)) {
		console.log(`${pct(t.hit / t.refs)}%  ${t.kind.padEnd(7)} ${String(t.refs).padStart(5)} refs  ${t.key}`);
	}
}
