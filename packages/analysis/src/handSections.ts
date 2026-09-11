import type { SectionKind } from '@mv/core';
import { SECTION_KINDS, nearestBarIn } from '@mv/core';

/**
 * Adopt hand-drawn boundaries and kinds as a per-track override. The unmapped analyser is
 * unchanged; bench/reanalyse.ts --no-hand-maps keeps the map usable as independent ground truth.
 */

/** One drawn section: the vocabulary word and where the owner put its start, in seconds. */
export interface HandSection {
	readonly kind: string;
	readonly startTime: number;
	/** Placed between bar lines on purpose; the grid is cut to it rather than rounding it. */
	readonly offGrid?: boolean;
}

/** Fingerprint map contents with rounded milliseconds so inaudible redraw jitter avoids reanalysis. */
export function handMapFingerprint(hand: readonly HandSection[]): string {
	return hand.map((s) => `${s.kind}@${Math.round(s.startTime * 100) / 100}`).join(',');
}

/** Keep persisted kinds as strings across vocabulary changes; unknown kinds use the neutral fallback. */
function coerceKind(kind: string): SectionKind {
	return (SECTION_KINDS as readonly string[]).includes(kind) ? (kind as SectionKind) : 'groove';
}

/**
 * Round hand-map times to the nearest bar because cues use whole bars. Force track edges
 * for complete coverage and drop spans that collapse. Return null when no usable map remains.
 */
export function handSectionBars(
	hand: readonly HandSection[],
	barTime: Float64Array,
	barCount: number
): { bounds: number[]; kinds: SectionKind[] } | null {
	if (hand.length < 2 || barCount < 2) return null;
	const drawn = [...hand].sort((a, b) => a.startTime - b.startTime);

	// Share preview rounding: nearest bar, ties earlier.
	const at = (t: number): number => nearestBarIn(barTime, t, barCount);

	const bounds: number[] = [0];
	const kinds: SectionKind[] = [coerceKind(drawn[0].kind)];
	for (let i = 1; i < drawn.length; i++) {
		const bar = at(drawn[i].startTime);
		if (bar >= barCount) break;
		const kind = coerceKind(drawn[i].kind);
		if (bar <= bounds[bounds.length - 1]) {
			// A collapsed span has no bars; the following section takes its shared boundary.
			kinds[kinds.length - 1] = kind;
			continue;
		}
		bounds.push(bar);
		kinds.push(kind);
	}
	bounds.push(barCount);
	// One span end to end is not a map, it is a track with a label. Adopting it would hand
	// the engine a single-section arrangement on the strength of a boundary that rounded away.
	return kinds.length >= 2 ? { bounds, kinds } : null;
}
