import { describe, expect, it } from 'vitest';
import { isFill, refineBoundaries, type BarFeatures } from './structure.ts';

/**
 * A bar table from a list of bars, each a level and a pattern. Two-second bars, no dips
 * inside a bar, chroma flat: only what the refine and the fill test read.
 */
function table(rows: { rms: number; pattern: number[] }[]): BarFeatures {
	const count = rows.length;
	const patternDim = rows[0].pattern.length;
	const pattern = new Float32Array(count * patternDim);
	const rms = new Float32Array(count);
	for (let b = 0; b < count; b++) {
		const p = rows[b].pattern;
		const norm = Math.sqrt(p.reduce((a, v) => a + v * v, 0)) || 1;
		for (let k = 0; k < patternDim; k++) pattern[b * patternDim + k] = p[k] / norm;
		rms[b] = rows[b].rms;
	}
	const chroma = new Float32Array(count * 12);
	for (let b = 0; b < count; b++) chroma[b * 12] = 1;
	return {
		count,
		time: Float64Array.from({ length: count + 1 }, (_, b) => b * 2),
		pattern,
		patternDim,
		chroma,
		rms,
		low: new Float32Array(count),
		mid: new Float32Array(count),
		high: new Float32Array(count),
		floor: Float32Array.from(rms)
	};
}

const refine = (bounds: number[], bars: BarFeatures, kicks: Int32Array, pickupGuard: boolean, fillVeto: boolean) =>
	refineBoundaries(bounds, bars, kicks, undefined, 2, null, null, null, 0, 1, new Set(), 1.45, 2, 0, 1, pickupGuard, fillVeto);

describe('the anacrusis guard', () => {
	// A quiet intro, a verse, and a chorus whose riff enters a bar before the phrase downbeat:
	// bar 15 carries the chorus pattern at the chorus level while the kit plays on unchanged.
	const verse = [1, 0.9, 0.2, 0.1];
	const chorus = [1, 0.7, 0.5, 0.1];
	const rows = [
		...Array.from({ length: 8 }, () => ({ rms: 0.05, pattern: verse })),
		...Array.from({ length: 15 }, () => ({ rms: 0.15, pattern: verse })),
		{ rms: 0.3, pattern: chorus },
		...Array.from({ length: 24 }, () => ({ rms: 0.3, pattern: chorus }))
	];
	const bars = table(rows);
	const steady = new Int32Array(rows.length).fill(2);

	it('is the refine moving a phrase-grid boundary onto the pickup without it', () => {
		expect(refine([0, 8, 24, 48], bars, steady, false, false)).toEqual([0, 8, 23, 48]);
	});

	it('keeps the boundary on the phrase downbeat when the kit does not land', () => {
		expect(refine([0, 8, 24, 48], bars, steady, true, false)).toEqual([0, 8, 24, 48]);
	});

	it('still lets a kit landing take the boundary off the grid', () => {
		const landing = Int32Array.from(steady);
		landing[23] = 6;
		expect(refine([0, 8, 24, 48], bars, landing, true, false)).toEqual([0, 8, 23, 48]);
	});

	it('still lets a section rise out of the quiet floor off the grid', () => {
		// Three bars of intro then the band: the section starts where the music does.
		const short = table([
			...Array.from({ length: 3 }, () => ({ rms: 0.02, pattern: verse })),
			...Array.from({ length: 21 }, () => ({ rms: 0.2, pattern: verse }))
		]);
		expect(refine([0, 4, 24], short, new Int32Array(24), true, false)).toEqual([0, 3, 24]);
	});
});

describe('the fill veto', () => {
	// A loud bar of its own pattern between a groove and the breakdown after it.
	const groove = [1, 0.8, 0.1, 0];
	const fill = [0.1, 0, 1, 0.9];
	const breakdown = [0.6, 0.1, 0.1, 1];
	const rows = [
		...Array.from({ length: 10 }, () => ({ rms: 0.2, pattern: groove })),
		{ rms: 0.28, pattern: fill },
		...Array.from({ length: 13 }, () => ({ rms: 0.1, pattern: breakdown }))
	];
	const bars = table(rows);
	const kicks = Int32Array.from(rows, (_, b) => (b === 10 ? 7 : b < 10 ? 2 : 0));

	it('names the fill and nothing else', () => {
		const db = Float32Array.from(bars.rms, (v) => 20 * Math.log10(v));
		expect(isFill(bars, db, 10)).toBe(true);
		expect(isFill(bars, db, 9)).toBe(false);
		expect(isFill(bars, db, 11)).toBe(false);
	});

	it('is the refine moving the breakdown onto the fill without it', () => {
		expect(refine([0, 11, 24], bars, kicks, false, false)).toEqual([0, 10, 24]);
	});

	it('leaves the breakdown where the kit leaves with it', () => {
		expect(refine([0, 11, 24], bars, kicks, false, true)).toEqual([0, 11, 24]);
	});
});

/** The refine with the round's dials: the guard on, the fill veto on, and the two under test. */
const refineWith = (
	bounds: number[],
	bars: BarFeatures,
	kicks: Int32Array,
	opts: { quietPhysics?: number; straddle?: boolean; hooks?: Uint8Array | null } = {}
) =>
	refineBoundaries(
		bounds, bars, kicks, undefined, 2, null, opts.hooks ?? null, null, 0, 1, new Set(), 1.45, 2, 0, 1, true, true,
		undefined, undefined, opts.quietPhysics ?? 2.5, opts.straddle ?? false
	);

describe('the quiet floor needs an arrival', () => {
	// Three bars of near-silence, a pad seven decibels up for the build, then the chorus twenty
	// above that: Panama's intro, where the pad enters a bar before the phrase downbeat the
	// build starts on, out of a floor deep enough for the quiet rule to see.
	const pad = [1, 0.9, 0.2, 0.1];
	const soft = table([
		...Array.from({ length: 3 }, () => ({ rms: 0.0137, pattern: pad })),
		...Array.from({ length: 21 }, () => ({ rms: 0.03, pattern: pad })),
		...Array.from({ length: 24 }, () => ({ rms: 0.3, pattern: pad }))
	]);
	const silent = new Int32Array(48);

	it('keeps a weak rise on the grid', () => {
		expect(refineWith([0, 4, 24, 48], soft, silent)).toEqual([0, 4, 24, 48]);
	});

	it('is the refine floor alone that let it off', () => {
		expect(refineWith([0, 4, 24, 48], soft, silent, { quietPhysics: 2 })).toEqual([0, 3, 24, 48]);
	});
});

describe('the straddle', () => {
	const verse = [1, 0.9, 0.2, 0.1];
	const chorus = [1, 0.7, 0.5, 0.1];
	// Stranded: the riff steps up a little at 16, the band lands with the kit and the singer
	// at 17, and the DP fenced the arrival in with boundaries at 16 and 18.
	const rows = [
		...Array.from({ length: 16 }, () => ({ rms: 0.15, pattern: verse })),
		{ rms: 0.18, pattern: chorus },
		...Array.from({ length: 23 }, () => ({ rms: 0.3, pattern: chorus }))
	];
	const bars = table(rows);
	const kicks = Int32Array.from(rows, (_, b) => (b >= 17 ? 6 : 2));
	const sung = new Uint8Array(40);
	sung[17] = 1;

	it('collapses the two boundaries onto the arrival between them', () => {
		expect(refineWith([0, 16, 18, 40], bars, kicks, { straddle: true, hooks: sung })).toEqual([0, 17, 40]);
	});

	it('is the two-bar minimum that held them apart without it', () => {
		expect(refineWith([0, 16, 18, 40], bars, kicks, { hooks: sung })).toEqual([0, 16, 18, 40]);
	});

	it('leaves a two-bar breakdown whose second bar only sings', () => {
		// goosebumps at 33: the kit stays out, the level barely moves, and the hook lands.
		const flat = table([
			...Array.from({ length: 16 }, () => ({ rms: 0.3, pattern: chorus })),
			...Array.from({ length: 2 }, () => ({ rms: 0.12, pattern: verse })),
			...Array.from({ length: 22 }, () => ({ rms: 0.14, pattern: verse }))
		]);
		const kit = Int32Array.from({ length: 40 }, (_, b) => (b < 16 ? 4 : 0));
		const hooks = new Uint8Array(40);
		hooks[17] = 1;
		expect(refineWith([0, 16, 18, 40], flat, kit, { straddle: true, hooks })).toEqual([0, 16, 18, 40]);
	});
});
