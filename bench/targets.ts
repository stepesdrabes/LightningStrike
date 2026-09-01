// The frozen boundary ground truth: the owner's marked seams from the 2026-08-14 judged
// round, with the bar each build emitted and the bar the ear puts it at.
//
// Shared by `earlybars.ts`, which scores by BAR, and `phasegrid.ts`, which scores the same
// seams by TIME. They have to be one list: a bar-numbered target stops naming the same
// instant the moment a grid re-phases, so the two instruments disagree by construction
// unless they are reading the same rows.

export interface Target {
	id: string;
	title: string;
	/** The boundary bar the judged build emitted (v16, from snapshot.json). */
	judged: number;
	/** Where the owner's ear puts it. */
	trueBar: number;
	note: string;
	/** Lower confidence: the true bar is read from energy windows, not an explicit note. */
	tentative?: boolean;
}

// Direction skew of the round: 22 early vs 7 late. Every pair below has a specific bar.
export const TARGETS: Target[] = [
	{ id: 'juRFjpB5Ppg', title: 'Tití Me Preguntó', judged: 53, trueBar: 54, note: 'chorus missed (too early); slam is at 54' },
	{ id: 'juRFjpB5Ppg', title: 'Tití Me Preguntó', judged: 73, trueBar: 72, note: 'last chorus misses (too late)' },
	{ id: 't-E2gm0a_N0', title: 'EARFQUAKE', judged: 38, trueBar: 40, note: 'chorus too early again; e7 at 38, e93 at 40' },
	{ id: 't-E2gm0a_N0', title: 'EARFQUAKE', judged: 6, trueBar: 8, note: 'owner note at 23.3s = bar 7.87; the DP put 8 (arrival 6.48) and the snap dragged it to 6' },
	{ id: 'ZqSlV5LmrTg', title: 'Snooze', judged: 17, trueBar: 23, note: 'WAY TOO early; owner marks 23 exactly' },
	{ id: 'ZD6rXLXZOEI', title: 'bad guy', judged: 23, trueBar: 24, note: 'chorus too early, later are okay', tentative: true },
	{ id: '2o9aoL0NWpw', title: 'Killing In the Name', judged: 21, trueBar: 22, note: 'chorus too early; vocal 0.26 at 21, 1.0 at 22', tentative: true },
	{ id: '4wOLVrGHiIU', title: 'Lose Yourself', judged: 22, trueBar: 23, note: 'verse too early; e57 at 22, e77 at 23', tentative: true },
	{ id: 'ZiJWFrSJ7Gk', title: 'Vítej mezi náma', judged: 81, trueBar: 82, note: 'last drop too early; e72 k0 at 81, e95 k4 at 82' },
	{ id: 'nTzU8TjvxyE', title: 'Safír', judged: 33, trueBar: 34, note: 'breakdown too early; vocal still on at 33, collapse at 34', tentative: true },
	{ id: 'nTzU8TjvxyE', title: 'Safír', judged: 43, trueBar: 42, note: 'owner marks 42 TWICE (rounds 1+2); snap blocked by the 2-bar build 41-43 vs minSegmentBars' },
	{ id: 'zgychWIo6UA', title: 'Stranded', judged: 18, trueBar: 16, note: 'verse missed (too late); owner marks 16' },
	{ id: '6JHu3b-pbh8', title: 'Thinkin Bout You', judged: 2, trueBar: 1, note: 'chorus starts too late; voice enters bar 1', tentative: true },
	{ id: 'i9gxO_5vA-Q', title: 'PROVENZA', judged: 79, trueBar: 80, note: 'last chorus missed (too early)', tentative: true },
	{ id: 'rgN9j5WQVdc', title: 'Cígo a káva', judged: 50, trueBar: 49, note: 'chorus missed (too late); owner marks 49', tentative: true },
	{ id: 'V2W9QCfYOGU', title: 'Kisses', judged: 61, trueBar: 63, note: 'round-3 note: last drop should start at 63; v19 has it at 61' },
	{ id: 'f0pPL5nrFz8', title: 'Way Too Self Aware', judged: 84, trueBar: 83, note: 'owner marked 82 in round 3; v20 landed the stay-pin arrival at 83 and the room said GOOD - 83 is the ear-confirmed bar' },
	// Sentinels: verified-good boundaries (praised, or window-confirmed on well-rated
	// tracks). judged == trueBar, so any drift at all prints WORSE.
	{ id: 'RAYQTfFh4xk', title: 'Le Freak', judged: 45, trueBar: 45, note: 'SENTINEL: restart window, lyric overlap 1.00 - the veto must not touch restarts' },
	{ id: 'nTzU8TjvxyE', title: 'Safír', judged: 9, trueBar: 9, note: 'SENTINEL: the v16 hook-snap win' },
	{ id: 'NZtZzsI8JTA', title: 'Praha/Vídeň', judged: 24, trueBar: 24, note: 'SENTINEL: window+1, effects-only complaints' },
	// Formerly a sentinel at 63; the owner's round-2 note says "maybe 64" - contested,
	// and the settle variants that pushed it to 64 were scored WORSE against the old
	// sentinel. Tentative complaint now, not ground truth in either direction.
	{ id: 'NZtZzsI8JTA', title: 'Praha/Vídeň', judged: 63, trueBar: 64, note: 'owner: last chorus maybe at 64 (round-2 note, low confidence)', tentative: true },
	{ id: '2o9aoL0NWpw', title: 'Killing In the Name', judged: 49, trueBar: 49, note: 'SENTINEL: in-window, praised as correct' },
	{ id: '2o9aoL0NWpw', title: 'Killing In the Name', judged: 58, trueBar: 58, note: 'SENTINEL: restart window' },
	{ id: 'rtRf-iukdvc', title: 'Hannah Montana', judged: 16, trueBar: 16, note: 'SENTINEL: 4*, sections mostly correct' },
	{ id: 'rtRf-iukdvc', title: 'Hannah Montana', judged: 48, trueBar: 48, note: 'SENTINEL' },
	{ id: 'rtRf-iukdvc', title: 'Hannah Montana', judged: 72, trueBar: 72, note: 'SENTINEL: the juicy last chorus' },
	{ id: 'y9fwZvB84r8', title: 'Pistácie', judged: 12, trueBar: 12, note: 'SENTINEL: the 5*' },
	{ id: 'y9fwZvB84r8', title: 'Pistácie', judged: 36, trueBar: 36, note: 'SENTINEL' }
];
