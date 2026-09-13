/** Mouse marks identify a nearby sixteenth-note slot in the grid the listener reviewed. */
export function snapToReviewedGrid(time: number, beats: readonly number[], duration: number): {
	time: number; offsetMs: number; beatIndex: number; fraction: number;
} | null {
	if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0 || time < 0
		|| time > duration || beats.length < 2 || beats.some((beat, i) => !Number.isFinite(beat)
			|| beat < 0 || beat > duration || (i > 0 && beat <= beats[i - 1]))) return null;
	let lo = 0, hi = beats.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (beats[mid] <= time) lo = mid + 1; else hi = mid;
	}
	const beatIndex = lo - 1;
	const period = beatIndex < 0 ? beats[1] - beats[0]
		: beatIndex >= beats.length - 1 ? beats.at(-1)! - beats.at(-2)!
			: beats[beatIndex + 1] - beats[beatIndex];
	const start = beatIndex < 0 ? beats[0] - period : beats[beatIndex];
	if (time < start || time > start + period) return null;
	let nearest: { time: number; fraction: number } | null = null;
	for (let division = 0; division <= 4; division++) {
		const candidate = start + period * division / 4;
		if (candidate < 0 || candidate > duration) continue;
		if (!nearest || Math.abs(time - candidate) < Math.abs(time - nearest.time) - 1e-12) {
			nearest = { time: candidate, fraction: division / 4 };
		}
	}
	return nearest ? { ...nearest, offsetMs: (nearest.time - time) * 1000, beatIndex } : null;
}
