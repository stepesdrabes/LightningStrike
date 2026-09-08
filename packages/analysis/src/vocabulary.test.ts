import { describe, expect, it } from 'vitest';
import type { LyricLine } from '@mv/core';
import type { Segment } from './arrange.ts';
import {
	chorusSpansFromLyrics,
	demoteVersesFromLyrics,
	hookBars,
	hookStarts,
	promoteChorusesFromLyrics,
	snapToHooks,
	spanOverlap,
	speaksClub,
	splitAtHooks,
	sungPhaseShift,
	toSongVocabulary
} from './vocabulary.ts';

describe('speaksClub', () => {
	it('follows the genre family when the record corroborates it', () => {
		expect(speaksClub('techno', 1.0)).toBe(true);
		// Halftime bass sits near half the four-on-the-floor rate and keeps its drops.
		expect(speaksClub('bass', 0.5)).toBe(true);
		expect(speaksClub('pop', 1.0)).toBe(false);
		expect(speaksClub('rock', 1.0)).toBe(false);
	});

	it('refuses the club vocabulary when the floor never kicks, whatever the tag says', () => {
		// The judged failure: a piano ballad filed as house got six kickless "drops".
		expect(speaksClub('house', 0.0)).toBe(false);
		expect(speaksClub('ambient', 0.0)).toBe(false);
		expect(speaksClub('ambient', 0.55)).toBe(true);
	});

	it('falls back to the four-on-the-floor signature when unidentified', () => {
		expect(speaksClub(null, 0.85)).toBe(true);
		expect(speaksClub(null, 0.5)).toBe(false);
	});
});

describe('toSongVocabulary', () => {
	it('re-reads club labels and leaves the rest alone', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 8, kind: 'intro', group: 0 },
			{ startBar: 8, endBar: 16, kind: 'groove', group: 1 },
			{ startBar: 16, endBar: 24, kind: 'drop', group: 2 },
			{ startBar: 24, endBar: 28, kind: 'build', group: 3 }
		];
		toSongVocabulary(segments);
		expect(segments.map((s) => s.kind)).toEqual(['intro', 'verse', 'chorus', 'build']);
	});
});

describe('chorus from lyrics', () => {
	const line = (t: number, text: string): LyricLine => ({ t, text });
	// Two verses of unique lines around two identical chorus blocks.
	const lyrics: LyricLine[] = [
		line(2, 'first verse line one'),
		line(6, 'first verse line two'),
		line(10, 'unique thought here'),
		line(14, 'hook line alpha'),
		line(18, 'hook line beta'),
		line(22, 'hook line gamma'),
		line(30, 'second verse says other things'),
		line(34, 'and keeps saying them'),
		line(38, 'still nothing repeated'),
		line(44, 'hook line alpha'),
		line(48, 'hook line beta'),
		line(52, 'hook line gamma')
	];

	it('finds the repeated blocks', () => {
		const spans = chorusSpansFromLyrics(lyrics, 60);
		expect(spans.length).toBe(2);
		expect(spans[0].start).toBe(14);
		expect(spans[1].start).toBe(44);
	});

	it('promotes the loud verse the words sit on', () => {
		const spans = chorusSpansFromLyrics(lyrics, 60);
		const segments: Segment[] = [
			{ startBar: 0, endBar: 7, kind: 'verse', group: 0 },
			{ startBar: 7, endBar: 13, kind: 'verse', group: 1 },
			{ startBar: 13, endBar: 20, kind: 'verse', group: 0 },
			{ startBar: 20, endBar: 28, kind: 'verse', group: 1 }
		];
		// Two-second bars: block one covers bars 7-11, block two bars 22-27.
		promoteChorusesFromLyrics(segments, [0.6, 0.9, 0.6, 0.88], (bar) => bar * 2, spans);
		expect(segments.map((s) => s.kind)).toEqual(['verse', 'chorus', 'verse', 'chorus']);
	});
});

describe('demoteVersesFromLyrics', () => {
	const spans = [
		{ start: 20, end: 40 },
		{ start: 80, end: 100 }
	];

	it('demotes the loud verse that carries none of the hook', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 10, kind: 'chorus', group: 2 },
			{ startBar: 10, endBar: 20, kind: 'chorus', group: 1 },
			{ startBar: 40, endBar: 50, kind: 'chorus', group: 0 }
		];
		// Two-second bars: segments 1 and 2 sit on the hook blocks, segment 0 carries nothing.
		demoteVersesFromLyrics(segments, (bar) => bar * 2, spans);
		expect(segments.map((s) => s.kind)).toEqual(['verse', 'chorus', 'chorus']);
	});

	it('keeps the instrumental reprise its sung siblings vouch for', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 10, kind: 'chorus', group: 0 },
			{ startBar: 10, endBar: 20, kind: 'chorus', group: 1 },
			{ startBar: 40, endBar: 50, kind: 'chorus', group: 0 }
		];
		// Segment 0 repeats segment 2's audio (same group) but carries no lines - a final
		// instrumental chorus, not a verse.
		demoteVersesFromLyrics(segments, (bar) => bar * 2, spans);
		expect(segments.map((s) => s.kind)).toEqual(['chorus', 'chorus', 'chorus']);
	});

	it('leaves everything alone when no chorus anchors the lyric blocks', () => {
		const segments: Segment[] = [{ startBar: 0, endBar: 5, kind: 'chorus', group: 0 }];
		demoteVersesFromLyrics(segments, (bar) => bar * 2, spans);
		expect(segments[0].kind).toBe('chorus');
	});
});

describe('hookBars', () => {
	const line = (t: number, text: string): LyricLine => ({ t, text });
	// Bars two seconds long; the repeated block starts at t=14 (bar 7) and t=44 (bar 22).
	const lyrics: LyricLine[] = [
		line(2, 'verse one'),
		line(6, 'verse two'),
		line(10, 'verse three'),
		line(14, 'hook alpha'),
		line(18, 'hook beta'),
		line(30, 'more verse'),
		line(34, 'other words'),
		line(38, 'still other words'),
		line(44, 'hook alpha'),
		line(48, 'hook beta')
	];
	const barTime = Float64Array.from({ length: 40 }, (_, b) => b * 2);

	it('flags the bar each repeated block starts in', () => {
		const hooks = hookBars(lyrics, 80, barTime, 39);
		const flagged = [...hooks].flatMap((v, b) => (v ? [b] : []));
		expect(flagged).toEqual([7, 22]);
	});

	it('rolls a back-quarter start into the next bar', () => {
		// Same blocks shifted to t=15.6: 80% into bar 7, sung into bar 8.
		const late = lyrics.map((l) => ({ ...l, t: l.t + 1.6 }));
		const hooks = hookBars(late, 80, barTime, 39);
		const flagged = [...hooks].flatMap((v, b) => (v ? [b] : []));
		expect(flagged).toEqual([8, 23]);
	});
});

describe('hookStarts', () => {
	const line = (t: number, text: string): LyricLine => ({ t, text });

	it('finds run starts and the cycle restart a merged run hides', () => {
		// The Safír shape: the opening chorus flows straight into the first real one, so
		// lines 0..7 are one unbroken repeated run and the second statement begins at
		// line 4, betrayed by "line b" coming round again.
		const lyrics: LyricLine[] = [
			line(0, 'restated opener'),
			line(4, 'line b'),
			line(8, 'line c'),
			line(12, 'line d'),
			line(16, 'restated opener'),
			line(20, 'line b'),
			line(24, 'line c'),
			line(28, 'line d'),
			line(40, 'a verse of its own'),
			line(44, 'saying unrepeated things'),
			line(60, 'restated opener'),
			line(64, 'line b')
		];
		expect(hookStarts(lyrics)).toEqual([
			{ t: 0, restart: false },
			{ t: 16, restart: true },
			{ t: 60, restart: false }
		]);
	});

	it('does not call a line chanted twice a new block', () => {
		const lyrics: LyricLine[] = [
			line(0, 'hey'),
			line(2, 'hey'),
			line(4, 'hey'),
			line(6, 'hey'),
			line(20, 'verse alpha'),
			line(24, 'verse beta'),
			line(40, 'hey'),
			line(42, 'hey')
		];
		expect(hookStarts(lyrics)).toEqual([
			{ t: 0, restart: false },
			{ t: 40, restart: false }
		]);
	});
});

describe('snapToHooks', () => {
	// Two-second bars throughout; a hook time of 21.2 is bar 10 + 0.6.
	const barTime = Float64Array.from({ length: 61 }, (_, b) => b * 2);
	const entrance = (t: number) => ({ t, restart: false });
	const restart = (t: number) => ({ t, restart: true });

	it('pulls back a boundary the pickup slam dragged late', () => {
		// The Safír case: hook sung at bar 8.4, chorus truly at 9, boundary landed at 11.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 11, kind: 'verse', group: 0 },
			{ startBar: 11, endBar: 24, kind: 'chorus', group: 1 }
		];
		const moves = snapToHooks(segments, [restart(16.8)], barTime, 60);
		expect(moves).toEqual([{ from: 11, to: 9 }]);
		expect(segments[0].endBar).toBe(9);
	});

	it('leaves a boundary anywhere inside the hook window alone', () => {
		// A pickup sung at bar 9.3 belongs to bar 9 or 10 and the phase cannot say which,
		// so a boundary on either is evidence, not error.
		for (const startBar of [9, 10]) {
			const segments: Segment[] = [
				{ startBar: 0, endBar: startBar, kind: 'verse', group: 0 },
				{ startBar, endBar: 24, kind: 'chorus', group: 1 }
			];
			expect(snapToHooks(segments, [entrance(18.6)], barTime, 60)).toEqual([]);
		}
	});

	it('moves one bar later only toward a restart, never toward an entrance', () => {
		// The Cikády case against the VYZEE case: a block returning mid-flow at bar 24.6
		// marks the drop the boundary undershot; a vocal ENTERING there could as easily
		// be lagging the drop that already happened.
		const segments = (): Segment[] => [
			{ startBar: 0, endBar: 23, kind: 'groove', group: 0 },
			{ startBar: 23, endBar: 40, kind: 'drop', group: 1 }
		];
		expect(snapToHooks(segments(), [entrance(49.2)], barTime, 60)).toEqual([]);
		const moved = segments();
		expect(snapToHooks(moved, [restart(49.2)], barTime, 60)).toEqual([{ from: 23, to: 24 }]);
		expect(moved[1].startBar).toBe(24);
	});

	it('refuses the pull-back when the boundary sits on a dominant arrival', () => {
		// The EARFQUAKE case: the singer leads the drop a cappella, so the hook window
		// sits two near-silent bars before the beat lands. The DP put the boundary on the
		// beat; the snap must not drag it onto the pickup.
		const arrivals = new Float32Array(61);
		arrivals[40] = 3.2;
		arrivals[38] = 0.2;
		const segments: Segment[] = [
			{ startBar: 0, endBar: 40, kind: 'build', group: 0 },
			{ startBar: 40, endBar: 52, kind: 'chorus', group: 1 }
		];
		// Hook sung at bar 37.2, window {37, 38}; without arrivals the old rule pulls
		// the boundary from the beat at 40 onto the pickup edge at 38.
		expect(snapToHooks(segments, [entrance(74.4)], barTime, 60, 2, arrivals)).toEqual([]);
		expect(segments[1].startBar).toBe(40);
		// And with an edge that arrives comparably, the snap still works.
		const weak = new Float32Array(61);
		weak[40] = 0.8;
		weak[38] = 0.7;
		const again: Segment[] = [
			{ startBar: 0, endBar: 40, kind: 'build', group: 0 },
			{ startBar: 40, endBar: 52, kind: 'chorus', group: 1 }
		];
		expect(snapToHooks(again, [entrance(74.4)], barTime, 60, 2, weak)).toEqual([
			{ from: 40, to: 38 }
		]);
	});

	it('refuses the restart pull-back onto a bar where nothing arrives', () => {
		// The Kisses case: the singer never stops, so a repeated line mid-flow reads as a
		// restart two bars before the band lands. The refiner pinned the band's bar; the
		// snap must not drag the last drop onto a window the record has not arrived at.
		const arrivals = new Float32Array(61);
		arrivals[23] = 5.4;
		arrivals[21] = 0.2;
		const segments: Segment[] = [
			{ startBar: 0, endBar: 23, kind: 'groove', group: 0 },
			{ startBar: 23, endBar: 40, kind: 'drop', group: 1 }
		];
		// Hook restarts at bar 20.3, window {20, 21}, so the full-reach edge is 21.
		expect(snapToHooks(segments, [restart(40.6)], barTime, 60, 2, arrivals)).toEqual([]);
		expect(segments[1].startBar).toBe(23);
	});

	it('still pulls back onto a restart the band corroborates', () => {
		// The Le Freak shape: the restart window carries a real arrival of its own - the
		// band hits with the singer - and a decisive incumbent two bars later must not
		// hold the chorus off it. Physics cannot rank these two bars; the lyric can.
		const arrivals = new Float32Array(61);
		arrivals[23] = 4.1;
		arrivals[21] = 1.6;
		const segments: Segment[] = [
			{ startBar: 0, endBar: 23, kind: 'verse', group: 0 },
			{ startBar: 23, endBar: 40, kind: 'chorus', group: 1 }
		];
		expect(snapToHooks(segments, [restart(40.6)], barTime, 60, 2, arrivals)).toEqual([
			{ from: 23, to: 21 }
		]);
		expect(segments[1].startBar).toBe(21);
	});

	it('absorbs a two-bar build leftward when the hook window sits inside it', () => {
		// The Safir shape, marked by the owner in two rounds: chorus at 43, hook window
		// {41, 42}, and the 2-bar build 41-43 holding the minimum-length refusal in place.
		const segments: Segment[] = [
			{ startBar: 33, endBar: 41, kind: 'breakdown', group: 2 },
			{ startBar: 41, endBar: 43, kind: 'build', group: -1 },
			{ startBar: 43, endBar: 67, kind: 'chorus', group: 1 }
		];
		const moves = snapToHooks(segments, [restart(83.2)], barTime, 60);
		expect(moves).toEqual([{ from: 43, to: 42 }]);
		expect(segments).toEqual([
			{ startBar: 33, endBar: 42, kind: 'breakdown', group: 2 },
			{ startBar: 42, endBar: 67, kind: 'chorus', group: 1 }
		]);
	});

	it('still refuses the shrink when the blocker is not a two-bar build', () => {
		const segments: Segment[] = [
			{ startBar: 33, endBar: 41, kind: 'breakdown', group: 2 },
			{ startBar: 41, endBar: 44, kind: 'build', group: -1 },
			{ startBar: 44, endBar: 67, kind: 'chorus', group: 1 }
		];
		expect(snapToHooks(segments, [restart(83.2)], barTime, 60)).toEqual([]);
		expect(segments).toHaveLength(3);
	});

	it('never delays a boundary by two bars onto a lagging club vocal', () => {
		// The VYZEE case: the drop hits at 13, the hook line only enters at bar 15.7.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 13, kind: 'build', group: 0 },
			{ startBar: 13, endBar: 37, kind: 'drop', group: 1 }
		];
		expect(snapToHooks(segments, [restart(31.4)], barTime, 60)).toEqual([]);
	});

	it('discards refrain hooks cycling faster than a phrase', () => {
		// Hooks at bars 51, 53, 55, 57: a chant, not four sections. Too few survive the
		// spacing guard to put a window within reach of the chorus at 60.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 60, kind: 'build', group: 0 },
			{ startBar: 60, endBar: 61, kind: 'chorus', group: 1 }
		];
		const chant = [102.2, 106.2, 110.2, 114.2].map(restart);
		expect(snapToHooks(segments, chant, barTime, 61)).toEqual([]);
	});

	it('never moves a boundary shared with a void', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 30, kind: 'groove', group: 0 },
			{ startBar: 30, endBar: 32, kind: 'void', group: -1 },
			{ startBar: 32, endBar: 40, kind: 'drop', group: 1 }
		];
		expect(snapToHooks(segments, [restart(60.4)], barTime, 60)).toEqual([]);
	});

	it('leaves verse and build starts to the energy evidence', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 8, kind: 'intro', group: 0 },
			{ startBar: 8, endBar: 16, kind: 'verse', group: 1 },
			{ startBar: 16, endBar: 20, kind: 'build', group: 2 }
		];
		expect(snapToHooks(segments, [entrance(12.4)], barTime, 60)).toEqual([]);
	});

	it('refuses a move that would squeeze a neighbour under two bars', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 3, kind: 'intro', group: 0 },
			{ startBar: 3, endBar: 11, kind: 'chorus', group: 1 }
		];
		// Hook at bar 0.5, window {0, 1}: reaching bar 1 would leave a one-bar intro.
		expect(snapToHooks(segments, [entrance(1.0)], barTime, 60)).toEqual([]);
	});
});

describe('spanOverlap', () => {
	it('measures coverage', () => {
		const spans = [{ start: 10, end: 20 }];
		expect(spanOverlap(spans, 10, 20)).toBe(1);
		expect(spanOverlap(spans, 15, 25)).toBe(0.5);
		expect(spanOverlap(spans, 30, 40)).toBe(0);
	});
});

describe('demoteVersesFromLyrics: siblings', () => {
	it('keeps a chorus whose sibling keeps its label on thinner evidence', () => {
		// Someone You Loved: three statements of one material; the sync file words the second
		// differently, so it carries none of the repeated lines while the first carries a third.
		const spans = [{ start: 20, end: 26 }];
		const segments: Segment[] = [
			{ startBar: 10, endBar: 20, kind: 'chorus', group: 3 },
			{ startBar: 40, endBar: 50, kind: 'chorus', group: 3 },
			{ startBar: 60, endBar: 70, kind: 'verse', group: 1 }
		];
		demoteVersesFromLyrics(segments, (bar) => bar * 2, [...spans, { start: 130, end: 140 }]);
		expect(segments.map((s) => s.kind)).toEqual(['chorus', 'chorus', 'verse']);
	});
});

describe('sungPhaseShift', () => {
	// Best Part: hooks sung at 16, 40 and 52, every boundary a bar before the sung grid, and
	// the build at 51 where the kit stops.
	const hooks = new Uint8Array(64);
	for (const b of [16, 40, 52]) hooks[b] = 1;
	const kicks = Int32Array.from({ length: 64 }, (_, b) => (b >= 51 && b < 55 ? 0 : 2));

	it('moves the table onto the singer\'s grid', () => {
		const bounds = [0, 3, 11, 15, 27, 39, 51, 55, 64];
		const moved = sungPhaseShift(bounds, hooks, kicks, 64, new Set());
		expect(bounds).toEqual([0, 4, 12, 16, 28, 40, 51, 56, 64]);
		expect(moved).toEqual([4, 12, 16, 28, 40, 56]);
	});

	it('leaves a table that already sits on it', () => {
		const bounds = [0, 4, 12, 16, 28, 40, 51, 56, 64];
		expect(sungPhaseShift(bounds, hooks, kicks, 64, new Set())).toEqual([]);
		expect(bounds).toEqual([0, 4, 12, 16, 28, 40, 51, 56, 64]);
	});

	it('needs three hooks that agree and a table that mostly sits early', () => {
		const two = new Uint8Array(64);
		two[16] = 1;
		two[40] = 1;
		expect(sungPhaseShift([0, 3, 11, 15, 27, 39, 64], two, kicks, 64, new Set())).toEqual([]);
		const split = new Uint8Array(64);
		for (const b of [16, 41, 54]) split[b] = 1;
		expect(sungPhaseShift([0, 3, 11, 15, 27, 39, 64], split, kicks, 64, new Set())).toEqual([]);
		expect(sungPhaseShift([0, 4, 12, 15, 28, 40, 64], hooks, kicks, 64, new Set())).toEqual([]);
	});

	it('leaves the bar the kit lands on and a pinned move alone', () => {
		const landing = Int32Array.from(kicks);
		landing[26] = 0;
		landing[27] = 4;
		const bounds = [0, 3, 11, 15, 27, 39, 55, 64];
		sungPhaseShift(bounds, hooks, landing, 64, new Set([15]));
		expect(bounds).toEqual([0, 4, 12, 15, 27, 40, 56, 64]);
	});
});

describe('splitAtHooks', () => {
	const barTime = Float64Array.from({ length: 61 }, (_, b) => b * 2);
	const start = (t: number) => ({ t, restart: false });
	const restart = (t: number) => ({ t, restart: true });

	it('splits a long section where a sung block begins a phrase into it', () => {
		// Thinkin Bout You: one groove, the pre-chorus repeated four bars in and the hook
		// restarting eight bars in, sung a third of a bar early.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 2, kind: 'intro', group: 0 },
			{ startBar: 2, endBar: 18, kind: 'chorus', group: 1 },
			{ startBar: 18, endBar: 40, kind: 'verse', group: 1 }
		];
		const hooks = [start(12.1), restart(19.3), start(44.2), restart(51.4)];
		expect(splitAtHooks(segments, hooks, barTime, 60)).toEqual([10, 26]);
		expect(segments.map((s) => [s.kind, s.startBar, s.endBar])).toEqual([
			['intro', 0, 2],
			['chorus', 2, 10],
			['chorus', 10, 18],
			['verse', 18, 26],
			['chorus', 26, 40]
		]);
	});

	it('ignores short sections, edges, club kinds and hooks off the eight-bar grid', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 10, kind: 'chorus', group: 0 },
			{ startBar: 10, endBar: 30, kind: 'chorus', group: 1 },
			{ startBar: 30, endBar: 50, kind: 'drop', group: 2 }
		];
		const hooks = [start(8.2), start(28.1), restart(32.5), start(56.2), start(76.1)];
		expect(splitAtHooks(segments, hooks, barTime, 60)).toEqual([]);
		expect(segments).toHaveLength(3);
	});
});

describe('promoteChorusesFromLyrics: siblings', () => {
	it('promotes the loud verse that is the sung chorus\'s own material', () => {
		// Someone You Loved: the second chorus carries none of the repeated lines the file has
		// for the first and last, and is the same material at the same energy.
		const spans = [
			{ start: 40, end: 56 },
			{ start: 136, end: 152 }
		];
		const segments: Segment[] = [
			{ startBar: 0, endBar: 20, kind: 'verse', group: 1 },
			{ startBar: 20, endBar: 28, kind: 'verse', group: 3 },
			{ startBar: 28, endBar: 44, kind: 'verse', group: 1 },
			{ startBar: 44, endBar: 60, kind: 'verse', group: 3 },
			{ startBar: 60, endBar: 68, kind: 'verse', group: 4 },
			{ startBar: 68, endBar: 76, kind: 'verse', group: 3 }
		];
		promoteChorusesFromLyrics(segments, [0.5, 0.9, 0.6, 0.89, 0.5, 0.93], (bar) => bar * 2, spans);
		expect(segments.map((s) => s.kind)).toEqual(['verse', 'chorus', 'verse', 'chorus', 'verse', 'chorus']);
	});

	it('does not promote a quiet passage of the chorus material', () => {
		const spans = [{ start: 40, end: 56 }, { start: 136, end: 152 }];
		const segments: Segment[] = [
			{ startBar: 20, endBar: 28, kind: 'verse', group: 3 },
			{ startBar: 44, endBar: 60, kind: 'verse', group: 3 },
			{ startBar: 68, endBar: 76, kind: 'verse', group: 3 }
		];
		promoteChorusesFromLyrics(segments, [0.9, 0.4, 0.93], (bar) => bar * 2, spans);
		expect(segments.map((s) => s.kind)).toEqual(['chorus', 'verse', 'chorus']);
	});
});

describe('promoteChorusesFromLyrics: the bed', () => {
	it('leaves a rap record\'s loop verses alone when the hook is the minority of the material', () => {
		// HUMBLE.: eight loud sections on one loop, two of them the sung hook.
		const spans = [{ start: 136, end: 152 }, { start: 184, end: 200 }];
		const segments: Segment[] = Array.from({ length: 8 }, (_, k) => ({ startBar: 4 + k * 12, endBar: 16 + k * 12, kind: 'verse' as const, group: 1 }));
		promoteChorusesFromLyrics(segments, segments.map(() => 0.9), (bar) => bar * 2, spans);
		expect(segments.filter((s) => s.kind === 'chorus')).toHaveLength(2);
	});
});
