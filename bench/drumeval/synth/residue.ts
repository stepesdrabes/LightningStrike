// node bench/drumeval/synth/residue.ts
// Rewrites each backing's residue as one list per class, without touching the rendered audio.
//
// backing.ts flattened all four classes into one set of times, and render.py then marked every
// class at every one of them, so an `unreviewed` reference covered about 69% of a synthetic
// track's timeline for each class and that corpus stopped penalising false positives at all.
// A residual kick should withhold the kick class's signal, not every class's.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tracks } from '../corpus.ts';
import { EVAL_ROOT, evidenceDir } from '../evidence.ts';
import { proposals, readProposalInputs, SOURCES } from '../../annotate/proposals.ts';

const BACKING = join(EVAL_ROOT, 'synth', 'backing');
const byName = new Map(tracks(['library']).map((track) => [track.name, track]));

let written = 0;
let before = 0;
let after = 0;
for (const entry of JSON.parse(readFileSync(join(BACKING, 'index.json'), 'utf8')) as { name: string }[]) {
	const path = join(BACKING, `${entry.name}.json`);
	const meta = JSON.parse(readFileSync(path, 'utf8')) as {
		name: string; start: number; seconds: number; residue: number[]; residueBy?: Record<string, number[]>;
	};
	const track = byName.get(meta.name);
	if (!track || !existsSync(join(evidenceDir(track), 'beats.json'))) {
		console.log(`skip ${meta.name}: no evidence`);
		continue;
	}
	const inputs = readProposalInputs(evidenceDir(track));
	const end = meta.start + meta.seconds;
	const residueBy: Record<string, number[]> = {};
	for (const kind of SOURCES) {
		residueBy[kind] = [...new Set(proposals(kind, inputs).map((p) => p.t))]
			.filter((t) => t >= meta.start && t < end)
			.map((t) => +(t - meta.start).toFixed(4))
			.sort((a, b) => a - b);
		after += residueBy[kind].length;
	}
	before += meta.residue.length * SOURCES.length;
	writeFileSync(path, JSON.stringify({ ...meta, residueBy }));
	written++;
}
console.log(`${written} backings | class-marks before ${before}, after ${after}`
	+ ` (${(100 * after / Math.max(1, before)).toFixed(1)}%)`);
