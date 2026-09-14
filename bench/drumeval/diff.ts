// node bench/drumeval/diff.ts --a=LABEL --b=LABEL [--corpus=library] [--kind=kick] [--min-level=0.05]
//   [--top=25] [--list]
// Unlabelled comparison of two runs' final streams: events only one run emits, per track.
import { KIT, tracks, type Kind } from './corpus.ts';
import { loadRun } from './evaluate.ts';
import { matchEvents } from './score.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const a = loadRun(flag('a')!);
const b = loadRun(flag('b')!);
const select = flag('corpus')?.split(',') ?? [];
const kinds = (flag('kind')?.split(',') ?? KIT) as Kind[];
const minLevel = Number(flag('min-level') ?? 0.05);
const wanted = new Set(tracks(select).map((t) => `${t.corpus}/${t.name}`));
const titles = new Map(tracks(select).map((t) => [`${t.corpus}/${t.name}`, (t as { title?: string }).title ?? t.name]));

interface Difference { track: string; kind: Kind; onlyA: [number, number][]; onlyB: [number, number][]; both: number }

function differences(kind: Kind): Difference[] {
	const out: Difference[] = [];
	for (const ra of a) {
		const key = `${ra.corpus}/${ra.name}`;
		if (!wanted.has(key)) continue;
		const rb = b.find((r) => r.corpus === ra.corpus && r.name === ra.name);
		if (!rb) continue;
		const pick = (s: { times: number[]; levels: number[] }) => s.times.map((t, i) => [t, s.levels[i]] as [number, number])
			.filter(([, l]) => l >= minLevel);
		const ea = pick(ra.final[kind]);
		const eb = pick(rb.final[kind]);
		const pairs = matchEvents(ea.map((e) => e[0]), eb.map((e) => e[0]), 0.05);
		const usedB = new Set<number>();
		const onlyA: [number, number][] = [];
		pairs.forEach((j, i) => (j < 0 ? onlyA.push(ea[i]) : usedB.add(j)));
		const onlyB = eb.filter((_, j) => !usedB.has(j));
		out.push({ track: key, kind, onlyA, onlyB, both: usedB.size });
	}
	return out;
}

for (const kind of kinds) {
	const rows = differences(kind).sort((x, y) => (y.onlyA.length + y.onlyB.length) - (x.onlyA.length + x.onlyB.length));
	const total = rows.reduce((acc, r) => ({ a: acc.a + r.onlyA.length, b: acc.b + r.onlyB.length, both: acc.both + r.both }),
		{ a: 0, b: 0, both: 0 });
	console.log(`\n== ${kind}: both ${total.both}, only ${flag('a')} ${total.a}, only ${flag('b')} ${total.b}`);
	for (const r of rows.slice(0, Number(flag('top') ?? 25))) {
		if (!r.onlyA.length && !r.onlyB.length) continue;
		console.log(`${r.track} ${titles.get(r.track)}: both ${r.both}, -${r.onlyA.length} +${r.onlyB.length}`
			+ (args.includes('--list') ? `\n   only a: ${r.onlyA.map(([t, l]) => `${t.toFixed(2)}(${l.toFixed(2)})`).join(' ')}`
				+ `\n   only b: ${r.onlyB.map(([t, l]) => `${t.toFixed(2)}(${l.toFixed(2)})`).join(' ')}` : ''));
	}
}
