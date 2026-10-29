// What a review makes ground truth: the pages the owner confirmed and the marks inside them. Both
// exporters read reviews through this, paging each clip with pages.js as the annotator does.
import type { DrumClass, DrumEvent } from '../drumeval/corpus.ts';
import { buildPages, clipClasses } from './pages.js';

export interface Annotation {
	id: string;
	corpus: string;
	track: string;
	title: string;
	genre: string;
	start: number;
	seconds: number;
	hits: Record<string, number[]>;
	confirmed: number[];
	/** True counts every page as confirmed. */
	reviewed?: boolean;
}

/** What paging needs from clip.json. */
export interface ClipTimes {
	beats: number[];
	downbeats: number[];
	seconds: number;
	classes?: string[];
}

export interface Span {
	from: number;
	to: number;
}

/** One unreviewed reference per this many seconds: dense enough to absorb any detection there. */
const FILLER_S = 0.02;

/** The clip's pages and those that count: confirmed by index, or all of them when reviewed. */
export function confirmedPages(
	annotation: Annotation, clip: ClipTimes
): { pages: Span[]; confirmed: Span[] } {
	const pages = buildPages(clip) as Span[];
	const confirmed = pages.filter((_, i) => (annotation.confirmed ?? []).includes(i) || annotation.reviewed);
	return { pages, confirmed };
}

const insideAny = (spans: Span[]) => (t: number) => spans.some((p) => t >= p.from && t < p.to);

/**
 * The `owner` corpus events: every mark on a confirmed page, and `unreviewed` references over
 * everything else that neither policy teaches or counts.
 */
export function ownerEvents(annotation: Annotation, clip: ClipTimes, confirmed: Span[]): DrumEvent[] {
	const classes = clipClasses(clip) as DrumClass[];
	const inside = insideAny(confirmed);
	const events: DrumEvent[] = [];
	for (const cls of classes) {
		for (const time of annotation.hits[cls] ?? []) {
			if (inside(time)) events.push({ time: +time.toFixed(4), cls });
		}
	}
	for (let t = 0; t < annotation.seconds; t += FILLER_S) {
		if (inside(t)) continue;
		for (const cls of classes) {
			events.push({ time: +t.toFixed(4), cls, sub: 'unreviewed', optional: true });
		}
	}
	events.sort((a, b) => a.time - b.time);
	return events;
}

export interface PlainReview {
	/** The classes the clip was reviewed for; any other class is unannotated everywhere. */
	classes: string[];
	/** [from, to) seconds of each confirmed page, in order. */
	confirmed: [number, number][];
	/** [from, to) seconds nobody confirmed, adjacent pages merged. Marks there are not truth. */
	unreviewed: [number, number][];
	onsets: { time: number; class: string }[];
}

/** One review as plain onset lists, times in seconds from the clip's start. */
export function plainReview(annotation: Annotation, clip: ClipTimes): PlainReview {
	const classes = clipClasses(clip) as string[];
	const { confirmed } = confirmedPages(annotation, clip);
	const inside = insideAny(confirmed);
	const unreviewed: [number, number][] = [];
	let at = 0;
	for (const page of confirmed) {
		if (page.from > at) unreviewed.push([at, page.from]);
		at = Math.max(at, page.to);
	}
	if (at < clip.seconds) unreviewed.push([at, clip.seconds]);
	const onsets = classes.flatMap((cls) => (annotation.hits[cls] ?? []).filter(inside)
		.map((t) => ({ time: +t.toFixed(4), class: cls })));
	onsets.sort((a, b) => a.time - b.time || classes.indexOf(a.class) - classes.indexOf(b.class));
	return { classes, confirmed: confirmed.map((p) => [p.from, p.to]), unreviewed, onsets };
}
