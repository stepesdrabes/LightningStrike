import { PHRASE_BARS, sectionBase, type SectionKind } from '@mv/core';
import type { Segment } from './arrange.ts';

/** What the learned labeller says, frame-major [t x kinds.length]. */
export interface SectionPosteriors {
	fps: number;
	kinds: readonly string[];
	data: Float32Array;
}

/**
 * Assign mean-posterior labels without moving boundaries. Preserve carved kinds, measured
 * silence, the opening two-phrase drop ban, and the track's club/song vocabulary.
 */
export function applyHeadLabels(
	segments: Segment[],
	post: SectionPosteriors,
	barTime: Float64Array,
	barCount: number,
	club: boolean
): void {
	const classes = post.kinds.length;
	const frames = Math.floor(post.data.length / classes);
	if (frames === 0) return;
	const acc = new Float64Array(classes);

	for (const s of segments) {
		if (s.group < 0) continue;
		const f0 = Math.max(0, Math.round(barTime[s.startBar] * post.fps));
		const f1 = Math.min(frames, Math.round(barTime[Math.min(s.endBar, barCount)] * post.fps));
		if (f1 <= f0) continue;

		acc.fill(0);
		for (let f = f0; f < f1; f++) {
			const o = f * classes;
			for (let c = 0; c < classes; c++) acc[c] += post.data[o + c];
		}
		let best = 0;
		for (let c = 1; c < classes; c++) if (acc[c] > acc[best]) best = c;
		let kind = post.kinds[best] as SectionKind;

		if (club) {
			if (kind === 'chorus') kind = 'drop';
			else if (kind === 'verse') kind = 'groove';
		}
		if (sectionBase(kind) === 'drop' && s.startBar < 2 * PHRASE_BARS) {
			kind = club ? 'groove' : 'verse';
		}
		// The head has no business inventing silence: a void is measured, never predicted.
		if (kind === 'void') continue;
		s.kind = kind;
	}
}
