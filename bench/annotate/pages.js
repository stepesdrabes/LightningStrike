/**
 * A clip's pages: two bars each, from the downbeats the beat tracker found.
 *
 * A confirmation is stored as a page index, so the annotator and the exporters must agree on what
 * index 0 covers: all of them import this rather than keeping a copy.
 */
export function buildPages(clip) {
	const bars = clip.downbeats.length >= 2 ? [...clip.downbeats] : [];
	if (!bars.length) for (let t = 0; t < clip.seconds; t += 2) bars.push(t);
	if (bars[0] > 0.2) bars.unshift(0);
	bars.push(clip.seconds);
	const pages = [];
	for (let i = 0; i < bars.length - 1; i += 2) {
		pages.push({ from: bars[i], to: bars[Math.min(bars.length - 1, i + 2)] });
	}
	return pages;
}

/** The classes a clip was cut to be reviewed for: Striker 1.x clips never had a tom lane. */
export function clipClasses(clip) {
	return clip.classes ?? ['kick', 'snare', 'hat', 'cymbal'];
}
