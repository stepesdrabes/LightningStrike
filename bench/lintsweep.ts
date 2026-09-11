// Compose and lint every cached track to catch shows the app would reject.
// node bench/lintsweep.ts [cacheDir]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { BUILT_IN_EFFECTS } from '@mv/core';
import { composeShow, lintShow } from '@mv/author-engine';

const cache = benchmarkCache(process.argv[2]);
const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));

let ok = 0;
let bad = 0;
let buttons = 0;
/** Warnings by rule over the whole cache: the engine's own shows should raise none it cares about. */
const warnings = new Map<string, number>();
for (const f of readdirSync(cache).filter((f) => f.endsWith('.analysis.json'))) {
	const id = f.replace('.analysis.json', '');
	const analysis = JSON.parse(readFileSync(join(cache, f), 'utf8'));
	const meta = JSON.parse(readFileSync(join(cache, `${id}.meta.json`), 'utf8'));
	const ctxPath = join(cache, `${id}.context.json`);
	const context = existsSync(ctxPath) ? JSON.parse(readFileSync(ctxPath, 'utf8')) : undefined;
	const show = composeShow(analysis, { artHue: meta.artHue, context });
	const verdict = lintShow(show, { analysis, effects, context });
	if (show.hits.some((h) => h.bar === analysis.bars.length - 1)) buttons++;
	for (const w of verdict.warnings) warnings.set(w.rule, (warnings.get(w.rule) ?? 0) + 1);
	if (verdict.errors.length) {
		bad++;
		console.log(`LINT FAIL  ${meta.title}  ${verdict.errors.map((e) => `${e.rule}@${e.bar}`).join(' ')}`);
	} else {
		ok++;
	}
}
console.log(`${ok} lint-clean, ${bad} rejected, ${buttons} buttons placed`);
console.log('warnings: ' + ([...warnings.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ') || 'none'));
