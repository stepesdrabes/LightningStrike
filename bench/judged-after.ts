// Compare a scratch reanalysis with the judged snapshot: boundary tables, phantom splits and
// cue bars.
// node bench/judged-after.ts <scratch-cache-dir>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { composeShow } from '@mv/author-engine';

const scratch = process.argv[2];
if (!scratch) throw new Error('usage: node bench/judged-after.ts <scratch-cache-dir>');
const snapshot = JSON.parse(
	readFileSync(join(import.meta.dirname, 'judged/round-2026-08-14/snapshot.json'), 'utf8')
) as {
	tracks: {
		id: string;
		title: string;
		rating: number | null;
		tags: string[];
		sectionCount: number;
		sections: { kind: string; startBar: number; endBar: number }[];
		cues: { bar: number }[];
	}[];
};

const sameKindShare = (secs: { kind: string }[]) => {
	if (secs.length < 2) return 0;
	let same = 0;
	for (let i = 1; i < secs.length; i++) if (secs[i].kind === secs[i - 1].kind) same++;
	return same / (secs.length - 1);
};
const table = (secs: { kind: string; startBar: number; endBar: number }[]) =>
	secs.map((s) => `${s.kind} ${s.startBar}-${s.endBar}`).join(' | ');

let oldPhantom = 0;
let newPhantom = 0;
let oldBounds = 0;
let newBounds = 0;
const rows: string[] = [];
for (const t of snapshot.tracks) {
	const anaPath = join(scratch, `${t.id}.analysis.json`);
	if (!existsSync(anaPath)) {
		rows.push(`${t.title}  MISSING re-analysis`);
		continue;
	}
	const ana = JSON.parse(readFileSync(anaPath, 'utf8'));
	const metaPath = join(scratch, `${t.id}.meta.json`);
	const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
	const ctxPath = join(scratch, `${t.id}.context.json`);
	const context = existsSync(ctxPath) ? JSON.parse(readFileSync(ctxPath, 'utf8')) : undefined;
	const show = composeShow(ana, { artHue: meta.artHue, context });

	const oldSecs = t.sections;
	const newSecs = ana.sections as { kind: string; startBar: number; endBar: number }[];
	oldPhantom += oldSecs.filter((s, i) => i > 0 && s.kind === oldSecs[i - 1].kind).length;
	newPhantom += newSecs.filter((s, i) => i > 0 && s.kind === newSecs[i - 1].kind).length;
	oldBounds += oldSecs.length - 1;
	newBounds += newSecs.length - 1;

	const changed = table(oldSecs) !== table(newSecs);
	const oldPeak = (t as { sections: { energyRank?: number; startBar: number }[] }).sections.find(
		(s) => s.energyRank === 1
	)?.startBar;
	const newPeak = (newSecs as { energyRank?: number; startBar: number }[]).find(
		(s) => s.energyRank === 1
	)?.startBar;
	const oldHits = ((t as { hits?: { bar: number; kind: string }[] }).hits ?? [])
		.map((h) => `${h.kind}@${h.bar}`)
		.join(' ');
	const newHits = (show.hits ?? []).map((h) => `${h.kind}@${h.bar}`).join(' ');
	rows.push(
		`${String(t.rating ?? '-')}* ${t.title.slice(0, 40).padEnd(42)} sections ${t.sectionCount}->${newSecs.length}` +
			`  phantomShare ${sameKindShare(oldSecs).toFixed(2)}->${sameKindShare(newSecs).toFixed(2)}` +
			`  cues ${t.cues.length}->${show.cues.length}` +
			`  peak ${oldPeak}->${newPeak}${oldPeak === newPeak ? '' : ' MOVED'}${changed ? '' : '  UNCHANGED'}`
	);
	if (oldHits !== newHits && (t.rating === null || t.rating <= 2 || t.tags.includes('sections wrong'))) {
		rows.push(`      hits old: ${oldHits}`);
		rows.push(`      hits new: ${newHits}`);
	}
	if (changed && (t.rating === null || t.rating <= 2 || t.tags.includes('sections wrong'))) {
		rows.push(`      old: ${table(oldSecs)}`);
		rows.push(`      new: ${table(newSecs)}`);
	}
}
for (const r of rows) console.log(r);
console.log(
	`\nphantom same-kind boundaries: ${oldPhantom}/${oldBounds} -> ${newPhantom}/${newBounds}` +
		`  (${((100 * oldPhantom) / oldBounds).toFixed(0)}% -> ${((100 * newPhantom) / Math.max(1, newBounds)).toFixed(0)}%)`
);
