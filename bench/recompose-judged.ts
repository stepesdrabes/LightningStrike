// Recompose every judged track's cached analysis at HEAD with the judged seed and diff
// cues/hits against the cached show. cached == fresh proves the judged complaints are live
// against this working tree; any diff means a stale build was judged (or the tree moved).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { composeShow } from '@mv/author-engine';
import type { Show } from '@mv/core';

const cache = benchmarkCache();
const judgeDir = join(cache, 'judge');

let same = 0;
let diff = 0;
for (const f of readdirSync(judgeDir).filter((f) => f.endsWith('.json'))) {
	const judge = JSON.parse(readFileSync(join(judgeDir, f), 'utf8'));
	const id = judge.trackId as string;
	const paths = {
		analysis: join(cache, `${id}.analysis.json`),
		show: join(cache, `${id}.show.json`),
		meta: join(cache, `${id}.meta.json`),
		context: join(cache, `${id}.context.json`)
	};
	if (!existsSync(paths.analysis) || !existsSync(paths.show)) {
		console.log(`${id}  MISSING CACHE`);
		continue;
	}
	const analysis = JSON.parse(readFileSync(paths.analysis, 'utf8'));
	const cached = JSON.parse(readFileSync(paths.show, 'utf8')) as Show;
	const meta = existsSync(paths.meta) ? JSON.parse(readFileSync(paths.meta, 'utf8')) : {};
	const context = existsSync(paths.context)
		? JSON.parse(readFileSync(paths.context, 'utf8'))
		: undefined;
	const fresh = composeShow(analysis, { artHue: meta.artHue, context, seed: judge.showSeed });
	const cueDiff = JSON.stringify(fresh.cues) !== JSON.stringify(cached.cues);
	const hitDiff = JSON.stringify(fresh.hits) !== JSON.stringify(cached.hits);
	if (cueDiff || hitDiff) {
		diff++;
		console.log(
			`${id}  DIFF  cues:${cueDiff} hits:${hitDiff}  (${judge.title ?? ''})  cachedV=${cached.version}`
		);
	} else {
		same++;
	}
}
console.log(`\n${same} identical, ${diff} differ (of ${same + diff})`);
