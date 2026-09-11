import { describe, expect, it } from 'vitest';
import type { Segment } from './arrange.ts';
import { consolidateSections } from './consolidate.ts';

/** Five 24-bar same-material drops, the shape the DP's segment cap forces onto a long rave. */
function fragmented(): Segment[] {
	return [0, 24, 48, 72, 96].map((startBar, i) => ({
		startBar,
		endBar: startBar + 24,
		kind: 'drop' as const,
		group: i
	}));
}

/** Arrivals flat at `quiet` everywhere except the listed bars. */
function arrivals(count: number, quiet: number, peaks: Record<number, number> = {}): Float32Array {
	const out = new Float32Array(count).fill(quiet);
	for (const [bar, v] of Object.entries(peaks)) out[Number(bar)] = v;
	return out;
}

function simFor(material: number[]): Float32Array {
	const n = material.length;
	const sim = new Float32Array(n * n);
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			sim[i * n + j] = i === j ? 1 : material[i] === material[j] ? 0.85 : 0.3;
		}
	}
	return sim;
}

const uniform = (count: number) => simFor(new Array(count).fill(0));

/** Energy flat at 0.5 except the listed bar ranges. */
function energy(count: number, hot: [number, number][] = []): Float32Array {
	const out = new Float32Array(count).fill(0.5);
	for (const [from, to] of hot) for (let b = from; b < to; b++) out[b] = 0.9;
	return out;
}

describe('consolidateSections', () => {
	it('leaves the fragmentation in place when disabled - the pre-consolidation behaviour', () => {
		const segments = fragmented();
		const merged = consolidateSections(
			segments,
			arrivals(120, 0.4),
			uniform(120),
			120,
			0,
			energy(120)
		);
		expect(merged).toEqual([]);
		expect(segments).toHaveLength(5);
	});

	it('reads a force-split homogeneous passage back together, sparing the loudest segment', () => {
		// The last drop is the peak: its seam survives because the peak cue, the reserved
		// master and the intensity ceiling all hang off that segment's start and rank.
		const segments = fragmented();
		const merged = consolidateSections(
			segments,
			arrivals(120, 0.4),
			uniform(120),
			120,
			1.6,
			energy(120, [[96, 120]])
		);
		expect(merged).toEqual([24, 48, 72]);
		expect(segments.map((s) => [s.startBar, s.endBar])).toEqual([
			[0, 96],
			[96, 120]
		]);
	});

	it('keeps a seam the music actually arrives on', () => {
		const segments = fragmented();
		consolidateSections(
			segments,
			arrivals(120, 0.4, { 72: 2.6 }),
			uniform(120),
			120,
			1.6,
			energy(120, [[96, 120]])
		);
		expect(segments.map((s) => s.startBar)).toEqual([0, 72, 96]);
	});

	it('keeps a seam whose arrival sits one bar late - the boundary work needs it', () => {
		// The judged early-boundary class: the seam bar is the fill, the slam is a bar
		// later. Deleting it would turn "starts too early" into "missed entirely".
		const segments = fragmented();
		consolidateSections(
			segments,
			arrivals(120, 0.4, { 49: 2.6 }),
			uniform(120),
			120,
			1.6,
			energy(120, [[96, 120]])
		);
		expect(segments.map((s) => s.startBar)).toEqual([0, 48, 96]);
	});

	it('never undoes a protected seam, however weak it measures', () => {
		const segments = fragmented();
		consolidateSections(
			segments,
			arrivals(120, 0.4),
			uniform(120),
			120,
			1.6,
			energy(120, [[96, 120]]),
			new Set([48])
		);
		expect(segments.map((s) => s.startBar)).toEqual([0, 48, 96]);
	});

	it('refuses a merge that would put the absorbed half off its own phrase grid', () => {
		// 0-10 is not a phrase multiple: interior cues of the merged span would subdivide
		// from bar 0 and land off the absorbed material's grid - the "split unevenly" complaint.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 10, kind: 'chorus', group: 0 },
			{ startBar: 10, endBar: 26, kind: 'chorus', group: 1 },
			{ startBar: 26, endBar: 30, kind: 'breakdown', group: 2 }
		];
		consolidateSections(
			segments,
			arrivals(30, 0.2),
			uniform(30),
			30,
			1.6,
			energy(30, [[26, 30]])
		);
		expect(segments).toHaveLength(3);
	});

	it('keeps a soft seam between different material - the gentle real boundary', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 16, kind: 'verse', group: 0 },
			{ startBar: 16, endBar: 32, kind: 'verse', group: 1 },
			{ startBar: 32, endBar: 36, kind: 'chorus', group: 2 }
		];
		const material = [...new Array(16).fill(0), ...new Array(16).fill(1), ...new Array(4).fill(2)];
		consolidateSections(
			segments,
			arrivals(36, 0.2),
			simFor(material),
			36,
			1.6,
			energy(36, [[32, 36]])
		);
		expect(segments).toHaveLength(3);
	});

	it('never merges across a kind change, however weak the seam', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 16, kind: 'verse', group: 0 },
			{ startBar: 16, endBar: 32, kind: 'chorus', group: 1 },
			{ startBar: 32, endBar: 48, kind: 'verse', group: 0 }
		];
		consolidateSections(segments, arrivals(48, 0), uniform(48), 48, 1.6, energy(48));
		expect(segments).toHaveLength(3);
	});

	it('never merges voids', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 16, kind: 'void', group: -1 },
			{ startBar: 16, endBar: 18, kind: 'void', group: -1 }
		];
		consolidateSections(segments, arrivals(18, 0), uniform(18), 18, 1.6, energy(18));
		expect(segments).toHaveLength(2);
	});

	it('assigns a merged chain the plurality group of its constituent bars', () => {
		// A(8) + B(12) + C(16): C is the plurality however the pairwise walk met them.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 8, kind: 'chorus', group: 2 },
			{ startBar: 8, endBar: 20, kind: 'chorus', group: 5 },
			{ startBar: 20, endBar: 36, kind: 'chorus', group: 9 },
			{ startBar: 36, endBar: 40, kind: 'breakdown', group: 1 }
		];
		consolidateSections(
			segments,
			arrivals(40, 0.2),
			uniform(40),
			40,
			1.6,
			energy(40, [[36, 40]])
		);
		expect(segments[0]).toEqual({ startBar: 0, endBar: 36, kind: 'chorus', group: 9 });
	});

	it('keeps the earlier group when the halves are equal', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 8, kind: 'verse', group: 2 },
			{ startBar: 8, endBar: 16, kind: 'verse', group: 5 },
			{ startBar: 16, endBar: 20, kind: 'chorus', group: 0 }
		];
		consolidateSections(
			segments,
			arrivals(20, 0.4),
			uniform(20),
			20,
			1.6,
			energy(20, [[16, 20]])
		);
		expect(segments[0].group).toBe(2);
	});
});
