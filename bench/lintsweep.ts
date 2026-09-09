// Compose and lint every track in a cache. The gate judged-after cannot be: it found
// the round-2 ship-blocker (a hit the linter refused deletes the whole show, and the
// app fails DARK). Run over the owner's library before any handover.
//
//   node bench/lintsweep.ts [cacheDir]   # default: the desktop cache
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BUILT_IN_EFFECTS } from '@mv/core';
import { composeShow, lintShow } from '@mv/author-engine';

const cache =
	process.argv[2] ?? join(homedir(), 'Library/Application Support/cz.drabek.lightningstrike/cache');
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
