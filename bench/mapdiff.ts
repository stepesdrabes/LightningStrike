// Compare a frozen map with analysis boundaries and signed offsets.
// node bench/mapdiff.ts <map.json> <analysis.json>
import { readFileSync } from 'node:fs';

interface Span {
	kind: string;
	startTime: number;
	movement?: number;
}
const [mapPath, analysisPath] = process.argv.slice(2);
if (!mapPath || !analysisPath) throw new Error('usage: node bench/mapdiff.ts <map.json> <analysis.json>');
const map = JSON.parse(readFileSync(mapPath, 'utf8')) as { sections: Span[] };
const analysis = JSON.parse(readFileSync(analysisPath, 'utf8')) as { sections: Span[]; movements?: { startTime: number }[] };

const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
/** Within this the boundary is the same bar line; the maps are drawn to the frame. */
const HIT_S = 0.6;
let hits = 0;
console.log(`${'owner'.padEnd(22)} | ${'analysis'.padEnd(26)} | delta`);
for (const own of map.sections) {
	const near = analysis.sections.reduce((best, s) => (Math.abs(s.startTime - own.startTime) < Math.abs(best.startTime - own.startTime) ? s : best));
	const delta = near.startTime - own.startTime;
	const hit = Math.abs(delta) <= HIT_S;
	if (hit) hits++;
	const kind = near.kind === own.kind ? 'same' : `kind ${near.kind}`;
	console.log(
		`${clock(own.startTime).padStart(8)} ${own.kind.padEnd(12)} | ${clock(near.startTime).padStart(8)} ${near.kind.padEnd(10)} m${String(near.movement ?? '-').padEnd(4)} | ${(delta >= 0 ? '+' : '') + delta.toFixed(2)}s ${kind}${hit ? '' : '  <-- off'}`
	);
}
const seams = (analysis.movements ?? []).slice(1).map((m) => clock(m.startTime));
console.log(`boundaries within ${HIT_S} s: ${hits} of ${map.sections.length}; seams ${seams.join(', ') || '-'}`);
