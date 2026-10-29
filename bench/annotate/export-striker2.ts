// node bench/annotate/export-striker2.ts [--list=clips.json | --tag=jazz | --ids=A,B] [--min-pages=1]
//   [--root=DIR] [--out=FILE]
// Writes the confirmed pages of the chosen clips (every reviewed clip by default) as plain onset
// lists in one JSON for striker-2 to convert. Times are seconds from `source.start` in ffmpeg's
// 44.1 kHz decode of `source.file`; spans are [from, to); only onsets inside `confirmed` are truth.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashFile } from '../../packages/analysis/src/fileHash.ts';
import { STRIKER2_CLASSES } from '../../packages/analysis/src/striker2Decode.ts';
import { tracks, trackKey } from '../drumeval/corpus.ts';
import { EVAL_ROOT } from '../drumeval/evidence.ts';
import { readClipList } from './cliplist.ts';
import { plainReview, type Annotation, type ClipTimes } from './reviewed.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const minPages = Number(flag('min-pages') ?? 1);
const ROOT = resolve(flag('root') ?? join(EVAL_ROOT, '..', 'annotate'));
const OUT = resolve(flag('out') ?? join(ROOT, 'striker2-reviews.json'));

type Clip = ClipTimes & {
	id: string; title: string; artist?: string; genre: string; tags?: string[]; source?: string;
	start: number;
};

const index = JSON.parse(readFileSync(join(ROOT, 'clips', 'index.json'), 'utf8')) as {
	id: string; tags?: string[];
}[];
const list = flag('list');
const tag = flag('tag');
const ids = list ? readClipList(resolve(list)).map((c) => c.id)
	: flag('ids')?.split(',')
	?? index.filter((c) => !tag || c.tags?.includes(tag)).map((c) => c.id);

/** The audio a clip was cut from: named in clip.json since Striker 2.0, else its corpus track. */
function sourceOf(clip: Clip, annotation: Annotation): string | null {
	if (clip.source) return clip.source;
	return tracks([`${annotation.corpus}:${annotation.track}`])
		.find((t) => trackKey(t) === `${annotation.corpus}/${annotation.track}`)?.audio ?? null;
}

const clips: unknown[] = [];
const waiting: string[] = [];
for (const id of ids) {
	const clipPath = join(ROOT, 'clips', id, 'clip.json');
	const reviewPath = join(ROOT, 'annotations', `${id}.json`);
	if (!existsSync(clipPath)) {
		console.log(`skip ${id}: no such clip`);
		continue;
	}
	const annotation = existsSync(reviewPath)
		? JSON.parse(readFileSync(reviewPath, 'utf8')) as Annotation : null;
	const counted = annotation?.reviewed ? Infinity : annotation?.confirmed?.length ?? 0;
	if (!annotation || counted < minPages) {
		waiting.push(id);
		continue;
	}
	const clip = JSON.parse(readFileSync(clipPath, 'utf8')) as Clip;
	const file = sourceOf(clip, annotation);
	if (!file) console.log(`${id}: its source audio is not known`);
	const review = plainReview(annotation, clip);
	clips.push({
		id, title: clip.title, artist: clip.artist ?? '', genre: clip.genre, tags: clip.tags ?? [],
		source: {
			file, sha256: file && existsSync(file) ? await hashFile(file) : null,
			start: clip.start, seconds: clip.seconds
		},
		...review
	});
	const seconds = review.confirmed.reduce((sum, [from, to]) => sum + to - from, 0);
	const counts = review.classes.map((cls) => `${cls} ${review.onsets.filter((o) => o.class === cls).length}`);
	console.log(`${id}: ${review.confirmed.length} pages, ${seconds.toFixed(1)} s confirmed, `
		+ counts.join(' '));
}

writeFileSync(OUT, JSON.stringify({
	format: 'lightningstrike-drum-reviews', version: 1, classes: STRIKER2_CLASSES,
	time: 'seconds from source.start in ffmpeg\'s 44.1 kHz decode of source.file; spans are [from, to)',
	clips
}, null, '\t'));
if (waiting.length) console.log(`not reviewed yet: ${waiting.join(', ')}`);
console.log(`\n${clips.length} clips -> ${OUT}`);
