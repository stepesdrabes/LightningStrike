// What a review starts from and what the proposals add to it, shared by the annotator and its tests.

/** Seconds within which a mark answers a proposal, so the proposal is no longer drawn as open. */
const ANSWERED_S = 0.04;
/** Seconds within which `a` treats a supported proposal as already marked. */
const ACCEPTED_S = 0.02;

/**
 * A proposal this strong is real evidence; weaker ones stay a tick and are never bulk accepted. A
 * Striker 2.0 clip names its own, on its probability scale.
 */
export const supportOf = (clip) => clip.support ?? 0.12;

/**
 * A new review's marks. A clip says whether it starts from Striker's hits: library clips do, clips
 * from a clip list start empty so no mark is Striker's unless someone accepted it. A clip that
 * predates the flag does.
 */
export function startingHits(clip, classes) {
	const prefill = clip.prefill ?? true;
	return Object.fromEntries(classes.map((cls) =>
		[cls, prefill ? (clip.striker?.[cls] ?? []).slice() : []]));
}

/** How a proposal is drawn: answered by a mark, an open ring for a supported one, else a tick. */
export function proposalState(p, hits, support) {
	if (hits.some((t) => Math.abs(t - p.t) < ANSWERED_S)) return 'answered';
	return p.score >= support ? 'ring' : 'tick';
}

/** The marks of [from, to) after `a`: those already there and every supported proposal not yet marked. */
export function withSupported(proposals, hits, view, support) {
	const inPage = (t) => t >= view.from && t < view.to;
	const added = hits.filter(inPage);
	for (const p of proposals) {
		if (!inPage(p.t) || p.score < support) continue;
		if (!added.some((t) => Math.abs(t - p.t) < ACCEPTED_S)) added.push(p.t);
	}
	return added;
}
