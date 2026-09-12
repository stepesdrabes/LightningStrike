// Compare composed shows through the current renderer without changing saved user shows.
// node bench/compositionprobe.ts --snapshot=bench/reports/composition-before.json
// node bench/compositionprobe.ts --compare=bench/reports/composition-before.json --render=8
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BUILT_IN_EFFECTS, DEFAULT_ROOM, buildGeometry, type Show, type TrackAnalysis, type TrackContext } from '@mv/core';
import { composeShow, lintShow, measureShow } from '@mv/author-engine';
import { activityBudget } from '../packages/author-engine/src/select.ts';
import { benchmarkCache } from './cache.ts';

const flag = (key: string) => process.argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const cache = benchmarkCache(flag('cache'));
const effects = new Map(BUILT_IN_EFFECTS.map((effect) => [effect.id, effect]));
const snapshot: Record<string, Show> = {};
const comparison = flag('compare');
const before = comparison ? JSON.parse(readFileSync(comparison, 'utf8')) as Record<string, Show> : {};
const geometry = buildGeometry(DEFAULT_ROOM);
const renderLimit = Number(flag('render') ?? 0);
const renderIds = flag('ids')?.split(',');
let rendered = 0;
let cues = 0;
let overloaded = 0;
let silentKit = 0;
let introCount = 0;
let movingIntros = 0;
let errors = 0;
const readings: { id: string; title: string; before: ReturnType<typeof measureShow> | null; after: ReturnType<typeof measureShow> }[] = [];

for (const file of readdirSync(cache).filter((name) => name.endsWith('.analysis.json'))) {
	const id = file.slice(0, -'.analysis.json'.length);
	const analysis = JSON.parse(readFileSync(join(cache, file), 'utf8')) as TrackAnalysis;
	const contextFile = join(cache, `${id}.context.json`);
	const metaFile = join(cache, `${id}.meta.json`);
	const context = existsSync(contextFile) ? JSON.parse(readFileSync(contextFile, 'utf8')) as TrackContext : undefined;
	const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) as { artHue?: number } : {};
	const show = composeShow(analysis, { context, artHue: meta.artHue });
	snapshot[id] = show;
	errors += lintShow(show, { analysis, context, effects }).errors.length;
	for (let index = 0; index < show.cues.length; index++) {
		const cue = show.cues[index];
		const end = show.cues[index + 1]?.bar ?? analysis.bars.length;
		const rows = analysis.bars.slice(cue.bar, end);
		const energy = (analysis.sections.find((span) => cue.bar >= span.startBar && cue.bar < span.endBar)?.meanEnergy ?? 0) / 100;
		const drums = (key: 'kicks' | 'snares' | 'hats') => rows.reduce((sum, row) => sum + row[key], 0) / Math.max(1, rows.length * analysis.tempo.beatsPerBar);
		const activity = Object.values(cue.layers).reduce((sum, spec) => sum + (effects.get(spec!.effect)?.taste.activity ?? 0), 0);
		if (!cue.layers.master && activity > activityBudget(energy, cue.section) + 1e-9) {
			overloaded++;
			if (process.argv.includes('--details')) console.log(`Activity ${id} ${cue.section}@${cue.bar}: ${activity.toFixed(2)} of ${activityBudget(energy, cue.section).toFixed(2)}`);
		}
		for (const spec of cue.layers.master || cue.note === 'the breath before it lands' ? [] : Object.values(cue.layers)) {
			const kit = effects.get(spec!.effect)?.taste.kit;
			const density = kit === 'any' ? Math.max(drums('kicks'), drums('snares'))
				: kit === 'percussion' ? Math.max(drums('kicks'), drums('snares'), drums('hats'))
					: drums(kit === 'kick' ? 'kicks' : kit === 'snare' ? 'snares' : 'hats');
			if (kit && density < 0.2) {
				silentKit++;
				if (process.argv.includes('--details')) console.log(`Kit ${id} ${cue.section}@${cue.bar}: ${spec!.effect}`);
			}
		}
		if (cue.section === 'intro') {
			introCount++;
			if (cue.layers.rhythm || effects.get(cue.layers.accent?.effect ?? '')?.taste.noteReactive) movingIntros++;
		}
		cues++;
	}
	if (rendered < renderLimit && (!renderIds || renderIds.includes(id)) && show.cues.some((cue) => cue.section === 'intro')) {
		const after = measureShow(show, analysis, effects, geometry);
		const previous = before[id] ? measureShow(before[id], analysis, effects, geometry) : null;
		readings.push({ id, title: analysis.title, before: previous, after });
		const intro = (reading: typeof after) => reading.cues.filter((cue) => cue.section === 'intro');
		const average = (reading: typeof after, field: 'level' | 'drift' | 'ripple') => intro(reading).reduce((sum, cue) => sum + cue[field], 0) / Math.max(1, intro(reading).length);
		console.log(`${analysis.title}: intro level ${previous ? average(previous, 'level').toFixed(1) + ' -> ' : ''}${average(after, 'level').toFixed(1)}, movement ${previous ? average(previous, 'drift').toFixed(2) + ' -> ' : ''}${average(after, 'drift').toFixed(2)}, shimmer ${previous ? average(previous, 'ripple').toFixed(2) + ' -> ' : ''}${average(after, 'ripple').toFixed(2)}, contrast ${previous ? previous.contrast.toFixed(2) + ' -> ' : ''}${after.contrast.toFixed(2)}, dark bars ${after.darkBars.length}`);
		rendered++;
	}
}
console.log(JSON.stringify({ tracks: Object.keys(snapshot).length, cues, overloaded, silentKit, introCount, movingIntros, lintErrors: errors }));
const out = flag('snapshot');
if (out) {
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify(snapshot));
}
const report = flag('report');
if (report) {
	mkdirSync(dirname(report), { recursive: true });
	writeFileSync(report, JSON.stringify(readings));
}
