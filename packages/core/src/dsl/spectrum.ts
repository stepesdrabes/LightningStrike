import type { ShowFrame } from '../contracts/frame.ts';

/** Sample the spectrum at normalized frequency u (0..1), interpolating between bands. */
export function bandAt(f: ShowFrame, u: number): number {
	const s = f.spectrum;
	const n = s.length;
	if (n === 0) return 0;
	const x = (u <= 0 ? 0 : u >= 1 ? 1 : u) * (n - 1);
	const i = Math.floor(x);
	return i + 1 < n ? s[i] + (s[i + 1] - s[i]) * (x - i) : s[i];
}

/** Mean level over a slice of the spectrum, `from` and `to` in the same 0..1 as `bandAt`. */
export function bandBetween(f: ShowFrame, from: number, to: number): number {
	const s = f.spectrum;
	const n = s.length;
	if (n === 0) return 0;
	const lo = Math.max(0, Math.min(n - 1, Math.floor(from * n)));
	const hi = Math.max(lo + 1, Math.min(n, Math.ceil(to * n)));
	let acc = 0;
	for (let i = lo; i < hi; i++) acc += s[i];
	return acc / (hi - lo);
}

/** The loudest band right now, 0..1. What a meter's ceiling should be scaled against. */
export function spectrumPeak(f: ShowFrame): number {
	const s = f.spectrum;
	let peak = 0;
	for (let i = 0; i < s.length; i++) if (s[i] > peak) peak = s[i];
	return peak;
}

/** Spectral centroid, 0..1. Silence returns 0.5 to avoid an artificial move to either edge. */
export function spectralTilt(f: ShowFrame): number {
	const s = f.spectrum;
	const n = s.length;
	if (n < 2) return 0.5;
	let weighted = 0;
	let total = 0;
	for (let i = 0; i < n; i++) {
		weighted += s[i] * i;
		total += s[i];
	}
	return total > 1e-6 ? weighted / total / (n - 1) : 0.5;
}

/** Spectral concentration: 0 for equal bands, 1 for all energy in one band. */
export function spectrumFocus(f: ShowFrame): number {
	const s = f.spectrum;
	const n = s.length;
	if (n < 2) return 0;
	let total = 0;
	let peak = 0;
	for (let i = 0; i < n; i++) {
		total += s[i];
		if (s[i] > peak) peak = s[i];
	}
	if (peak < 1e-6) return 0;
	const flat = total / n / peak;
	return 1 - flat;
}
