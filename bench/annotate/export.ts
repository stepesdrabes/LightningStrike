// node bench/annotate/export.ts [--min-pages=1] [--root=DIR] [--out=DIR]
// Turns the saved annotations of library clips into the `owner` drumeval corpus: the clip's audio at
// full rate and one event per confirmed hit. Pages nobody confirmed are filled with `unreviewed`
// references so a detection there is neither credited nor counted, which lets partial reviews score
// honestly. Clips cut from a clip list are not the library; export-striker2.ts writes those.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tracks, trackKey } from '../drumeval/corpus.ts';
import { EVAL_ROOT } from '../drumeval/evidence.ts';
import { wav16 } from './cut.ts';
import { clipClasses } from './pages.js';
import { confirmedPages, ownerEvents, type Annotation, type ClipTimes } from './reviewed.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const minPages = Number(flag('min-pages') ?? 1);
const ROOT = resolve(flag('root') ?? join(EVAL_ROOT, '..', 'annotate'));
const OUT = resolve(flag('out') ?? join(EVAL_ROOT, '..', '..', 'corpus', 'owner'));
const SRC = join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src');
const RATE = 44100;

const { decodeAudio } = await import(pathToFileURL(join(SRC, 'decode.ts')).href);

const saved = join(ROOT, 'annotations');
if (!existsSync(saved)) throw new Error(`no annotations in ${saved}`);
mkdirSync(join(OUT, 'audio'), { recursive: true });
const out: unknown[] = [];
let hits = 0;
let reviewedSeconds = 0;

for (const file of readdirSync(saved).filter((f) => f.endsWith('.json')).sort()) {
	const annotation = JSON.parse(readFileSync(join(saved, file), 'utf8')) as Annotation;
	const clipPath = join(ROOT, 'clips', annotation.id, 'clip.json');
	if (!existsSync(clipPath)) {
		console.log(`skip ${annotation.id}: the clip is gone`);
		continue;
	}
	const clip = JSON.parse(readFileSync(clipPath, 'utf8')) as ClipTimes;
	if ((annotation.confirmed?.length ?? 0) < minPages) continue;

	// Rebuild the pages the app drew, so a confirmed index means the same stretch of time.
	const { pages, confirmed } = confirmedPages(annotation, clip);
	if (!confirmed.length) continue;
	const inside = (t: number) => confirmed.some((p) => t >= p.from && t < p.to);
	if (annotation.corpus === 'file') {
		console.log(`skip ${annotation.id}: a clip from a clip list, which export-striker2.ts writes`);
		continue;
	}

	const source = tracks([`${annotation.corpus}:${annotation.track}`])
		.find((t) => trackKey(t) === `${annotation.corpus}/${annotation.track}`);
	if (!source) {
		console.log(`skip ${annotation.id}: the source track is gone`);
		continue;
	}
	const decoded = await decodeAudio(source.audio, RATE);
	const from = Math.round(annotation.start * RATE);
	const to = Math.min(decoded.left.length, from + Math.round(annotation.seconds * RATE));
	writeFileSync(join(OUT, 'audio', `${annotation.id}.wav`),
		wav16([decoded.left.subarray(from, to), decoded.right.subarray(from, to)], RATE));

	const events = ownerEvents(annotation, clip, confirmed);
	hits += events.filter((e) => e.sub !== 'unreviewed').length;
	reviewedSeconds += confirmed.reduce((sum, p) => sum + (p.to - p.from), 0);
	out.push({
		name: annotation.id, audio: `audio/${annotation.id}.wav`, genre: annotation.genre,
		title: annotation.title, events
	});
	const counts = clipClasses(clip)
		.map((c: string) => `${c[0]}${(annotation.hits[c] ?? []).filter(inside).length}`);
	console.log(`${annotation.id} ${confirmed.length}/${pages.length} pages, ${counts.join(' ')}`);
}

writeFileSync(join(OUT, 'tracks.json'), JSON.stringify({
	corpus: 'owner', labeled: true, heldOut: true,
	source: 'bench/annotate, hand confirmed by the owner in the library the product plays',
	tracks: out
}));
console.log(`\n${out.length} clips, ${reviewedSeconds.toFixed(0)} s confirmed, ${hits} hits -> ${OUT}`);
