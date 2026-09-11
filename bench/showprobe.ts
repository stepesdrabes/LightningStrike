import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	buildGeometry,
	sectionBase,
	type TrackAnalysis,
	type TrackContext
} from '@mv/core';
import { CACHE_DIR } from '@mv/analysis';
import { composeShow, lintShow, measureShow, allowedFlashes } from '@mv/author-engine';

/**
 * Compose, lint and measure cached shows: contrast, coverage, hits, smoothness and corpus
 * variety.
 */
const geometry = buildGeometry(DEFAULT_ROOM);
const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
const fps = Number(process.argv.find((a) => a.startsWith('--fps='))?.slice(6) ?? 60);

const metas = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.meta.json'));
interface Row {
	title: string;
	family: string;
	sections: string;
	flashes: number;
	allowance: number;
	slams: number;
	bumps: number;
	contrast: number;
	litQuiet: number;
	hueJumps: number;
	darkBars: number;
	misfires: number;
	lintErrors: number;
	palette: string;
	peakEffect: string;
}
const rows: Row[] = [];

for (const f of metas) {
	const meta = JSON.parse(await readFile(join(CACHE_DIR, f), 'utf8')) as { id: string; title: string; artHue?: number | null };
	let analysis: TrackAnalysis;
	let context: TrackContext | null = null;
	try {
		analysis = JSON.parse(await readFile(join(CACHE_DIR, `${meta.id}.analysis.json`), 'utf8')) as TrackAnalysis;
	} catch {
		continue;
	}
	try {
		context = JSON.parse(await readFile(join(CACHE_DIR, `${meta.id}.context.json`), 'utf8')) as TrackContext;
	} catch {
		// Uncontexted is a legal state.
	}

	const show = composeShow(analysis, { artHue: meta.artHue, context });
	const verdict = lintShow(show, { analysis, effects, context });
	const reading = measureShow(show, analysis, effects, geometry, { fps });

	const quiet = reading.cues.filter((c) => ['intro', 'outro', 'breakdown'].includes(sectionBase(c.section)));
	const litQuiet = quiet.length > 0 ? quiet.reduce((a, c) => a + c.lit, 0) / quiet.length : 1;
	const kinds = new Map<string, number>();
	for (const s of analysis.sections) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
	const peakCue = show.cues.find((c) => (c.intensity ?? 0) >= 1);

	rows.push({
		title: meta.title.slice(0, 34),
		family: context?.genreFamily ?? '-',
		sections: [...kinds.entries()].map(([k, n]) => `${k}:${n}`).join(' '),
		flashes: show.hits.filter((h) => h.kind === 'strobe' || h.kind === 'blackout').length,
		allowance: allowedFlashes(analysis, context),
		slams: show.hits.filter((h) => h.kind === 'slam').length,
		bumps: show.hits.filter((h) => h.kind === 'bump').length,
		contrast: reading.contrast,
		litQuiet,
		hueJumps: reading.hueJumps,
		darkBars: reading.darkBars.length,
		misfires: reading.hits.filter((h) => !h.fired).length,
		lintErrors: verdict.errors.length,
		palette: `${show.palette.base}/${show.palette.accent}${show.palette.third !== undefined ? '/' + show.palette.third : ''}`,
		peakEffect: peakCue?.layers.master?.effect ?? '-'
	});
	console.log(
		rows[rows.length - 1].title.padEnd(35),
		rows[rows.length - 1].family.padEnd(8),
		`flash ${rows[rows.length - 1].flashes}/${rows[rows.length - 1].allowance}`,
		`slam ${rows[rows.length - 1].slams}`,
		`bump ${String(rows[rows.length - 1].bumps).padStart(2)}`,
		`contrast ${reading.contrast.toFixed(2)}`,
		`quiet lit ${(litQuiet * 100).toFixed(0)}%`,
		`jumps ${reading.hueJumps}`,
		`dark ${reading.darkBars.length}`,
		`miss ${rows[rows.length - 1].misfires}`,
		verdict.errors.length > 0 ? `LINT ERRORS ${verdict.errors.length}` : ''
	);
}

const mean = (get: (r: Row) => number) => rows.reduce((a, r) => a + get(r), 0) / Math.max(1, rows.length);
const distinct = (get: (r: Row) => string) => new Set(rows.map(get)).size;

console.log('');
console.log(
	`${rows.length} tracks · contrast mean ${mean((r) => r.contrast).toFixed(2)} · ` +
		`quiet coverage ${(100 * mean((r) => r.litQuiet)).toFixed(0)}% · ` +
		`flashes ${rows.reduce((a, r) => a + r.flashes, 0)} of ${rows.reduce((a, r) => a + r.allowance, 0)} allowed · ` +
		`hue jumps ${rows.reduce((a, r) => a + r.hueJumps, 0)} · ` +
		`dark bars ${rows.reduce((a, r) => a + r.darkBars, 0)} · ` +
		`misfires ${rows.reduce((a, r) => a + r.misfires, 0)} · ` +
		`lint errors ${rows.reduce((a, r) => a + r.lintErrors, 0)}`
);
console.log(
	`diversity: ${distinct((r) => r.palette)} palettes, ${distinct((r) => r.peakEffect)} peak effects across ${rows.length} shows`
);
