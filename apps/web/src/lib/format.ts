/** m:ss, clamped, for scrubbers and queue rows. */
export function clock(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const total = Math.floor(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
	return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Title-cased for display without touching the underlying kind string. */
export function titleCase(word: string): string {
	return word.length === 0 ? word : word[0].toUpperCase() + word.slice(1);
}
