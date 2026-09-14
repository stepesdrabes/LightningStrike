// node bench/drumeval/errors.ts --label=NAME [--stage=final] [--metric=light] [--corpus=mdb]
// Attributes each false positive to the nearest reference of another class (or none) and each
// miss to a same-time detection of another class (or none), pooled and per track.
import { KIT, tracks } from './corpus.ts';
import { loadRun } from './evaluate.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = flag('label') ?? 'worktree';
const stage = flag('stage') ?? 'final';
const metric = flag('metric') ?? 'light';
const select = flag('corpus')?.split(',') ?? [];
const WINDOW = 0.05;

const corpus = tracks(select);
const results = loadRun(label).filter((r) => corpus.some((t) => t.corpus === r.corpus && t.name === r.name));
for (const kind of KIT) {
	const fpCause = new Map<string, number>();
	const fnCause = new Map<string, number>();
	const perTrack: string[] = [];
	for (const r of results) {
		const track = corpus.find((t) => t.corpus === r.corpus && t.name === r.name)!;
		const d = (r.scores[stage] as Record<string, Record<string, { fpTimes: number[]; fnTimes: number[] }>>)[kind][metric];
		const trackFp = new Map<string, number>();
		for (const t of d.fpTimes) {
			const near = track.events.filter((e) => e.cls !== kind && Math.abs(e.time - t) <= WINDOW);
			const cause = near.length ? [...new Set(near.map((e) => e.sub ?? e.cls))].sort().join('+') : 'nothing';
			fpCause.set(cause, (fpCause.get(cause) ?? 0) + 1);
			trackFp.set(cause, (trackFp.get(cause) ?? 0) + 1);
		}
		for (const t of d.fnTimes) {
			const others = KIT.filter((k) => k !== kind && r.final[k].times.some((x) => Math.abs(x - t) <= WINDOW));
			const sub = track.events.find((e) => e.cls === kind && Math.abs(e.time - t) < 1e-6)?.sub;
			const cause = `${sub ?? kind}${others.length ? ` as ${others.join('+')}` : ' unheard'}`;
			fnCause.set(cause, (fnCause.get(cause) ?? 0) + 1);
		}
		if (d.fpTimes.length || d.fnTimes.length) {
			perTrack.push(`  ${r.corpus}/${r.name}: fp ${d.fpTimes.length} [${[...trackFp].map(([c, n]) => `${c} ${n}`).join(', ')}], `
				+ `fn ${d.fnTimes.length}`);
		}
	}
	const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ');
	console.log(`\n== ${kind} (${stage}/${metric})`);
	console.log(`FP causes: ${sorted(fpCause)}`);
	console.log(`FN causes: ${sorted(fnCause)}`);
	if (args.includes('--tracks')) console.log(perTrack.join('\n'));
}
