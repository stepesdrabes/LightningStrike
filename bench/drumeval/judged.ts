// node bench/drumeval/judged.ts --label=RUN [--judged=bench/judged/drums]
// Listener-confirmed partial labels against a library run: every confirmed hit should be found
// within 50 ms, and no emitted hit should sit within 50 ms of a confirmed non-hit.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadRun } from './evaluate.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const run = loadRun(flag('label')!);
const dir = resolve(flag('judged') ?? 'bench/judged/drums');
const WINDOW = 0.05;

interface Judged { trackId: string; title: string; snare?: number[]; kick?: number[]; nonSnare?: number[]; nonKick?: number[] }

let found = 0;
let total = 0;
let wrong = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
	const judged = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Judged;
	const result = run.find((r) => r.corpus === 'library' && r.name === judged.trackId);
	if (!result) {
		console.log(`${judged.title}: not in this run`);
		continue;
	}
	for (const kind of ['kick', 'snare'] as const) {
		const { times: emitted, levels } = result.final[kind];
		const near = (t: number) => emitted.some((e) => Math.abs(e - t) <= WINDOW);
		const levelAt = (t: number) => Math.max(...emitted.map((e, i) => (Math.abs(e - t) <= WINDOW ? levels[i] : 0)));
		const positives = judged[kind] ?? [];
		const negatives = kind === 'snare' ? judged.nonSnare ?? [] : judged.nonKick ?? [];
		if (!positives.length && !negatives.length) continue;
		const missed = positives.filter((t) => !near(t));
		const hit = negatives.filter(near);
		found += positives.length - missed.length;
		total += positives.length;
		wrong += hit.length;
		const heard = positives.filter(near).map(levelAt).sort((a, b) => a - b);
		console.log(`${judged.title} ${kind}: ${positives.length - missed.length}/${positives.length} confirmed`
			+ `${missed.length ? ` (missed ${missed.map((t) => t.toFixed(3)).join(', ')})` : ''}`
			+ `${heard.length ? `, levels ${heard[0].toFixed(2)}-${heard[heard.length - 1].toFixed(2)}` : ''}, `
			+ `${hit.length}/${negatives.length} confirmed non-hits emitted${hit.length ? ` (${hit.map((t) => t.toFixed(3)).join(', ')})` : ''}`);
	}
}
console.log(`total: ${found}/${total} confirmed hits, ${wrong} confirmed non-hits emitted`);
