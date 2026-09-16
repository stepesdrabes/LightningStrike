// node bench/drumeval/fourfloor.ts --run=lib-v19 [--compare=lib-v22] [--corpus=library] [--genres=bass,techno]
// How much of the beat grid the kick stream covers. In four on the floor the kick is on every beat,
// so on hardstyle, hard techno, house and trance this is close to recall without anyone annotating
// anything. It says nothing on genres that do not play that way, so read it per track.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tracks } from './corpus.ts';
import { EVAL_ROOT, evidenceDir, files, readJson, type BeatsRecord } from './evidence.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const run = flag('run')!;
const compare = flag('compare');
const corpusName = flag('corpus') ?? 'library';
const genres = flag('genres')?.split(',');
const WINDOW = 0.05;

interface Result { final: Record<string, { times: number[] }> }

function coverage(label: string, name: string, beats: number[]): { share: number; rate: number } | null {
	const path = join(EVAL_ROOT, 'runs', label, 'tracks', `${corpusName}__${name}.json`);
	if (!existsSync(path)) return null;
	const result = JSON.parse(readFileSync(path, 'utf8')) as Result & { duration: number };
	const kicks = result.final.kick?.times ?? [];
	const share = (grid: number[]) => {
		let at = 0;
		let covered = 0;
		for (const beat of grid) {
			while (at < kicks.length && kicks[at] < beat - WINDOW) at++;
			if (at < kicks.length && kicks[at] <= beat + WINDOW) covered++;
		}
		return grid.length ? covered / grid.length : 0;
	};
	// A beat tracker that locked an octave high would show half coverage for a perfect kick, so
	// the grid this scores against is the one the kicks fit best.
	const best = Math.max(share(beats), share(beats.filter((_, i) => i % 2 === 0)),
		share(beats.filter((_, i) => i % 2 === 1)));
	return { share: best, rate: kicks.length / Math.max(1, result.duration) };
}

const rows: { name: string; genre: string; title: string; a: number; b: number | null; rate: number }[] = [];
for (const track of tracks([corpusName])) {
	if (genres && !genres.includes(track.genre ?? '')) continue;
	const beats = readJson<BeatsRecord>(join(evidenceDir(track), files.beats))?.beats;
	if (!beats || beats.length < 20) continue;
	const a = coverage(run, track.name, beats);
	if (!a) continue;
	const b = compare ? coverage(compare, track.name, beats) : null;
	rows.push({
		name: track.name, genre: track.genre ?? '', a: a.share, b: b ? b.share : null, rate: a.rate,
		title: ((track as { title?: string }).title ?? track.name).slice(0, 34)
	});
}

rows.sort((x, y) => (x.b ?? x.a) - (y.b ?? y.a));
const pct = (v: number) => `${(100 * v).toFixed(0)}%`.padStart(5);
console.log(`kick coverage of the beat grid, ${rows.length} tracks`);
console.log(compare ? `${run.padEnd(9)} ${compare.padEnd(9)} change  genre    track` : `${run}  genre    track`);
for (const row of rows) {
	const change = row.b === null ? '' : `${row.b - row.a >= 0 ? '+' : ''}${(100 * (row.b - row.a)).toFixed(0)}%`;
	console.log(`${pct(row.a)}     ${row.b === null ? '' : pct(row.b) + '     '}${change.padStart(6)}  `
		+ `${row.genre.padEnd(8)} ${row.title}`);
}
const mean = (pick: (r: typeof rows[number]) => number | null) => {
	const values = rows.map(pick).filter((v): v is number => v !== null);
	return values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
};
console.log(`\nmean ${pct(mean((r) => r.a))}` + (compare ? ` -> ${pct(mean((r) => r.b))}` : ''));
