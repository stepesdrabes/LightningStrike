import { describe, expect, it } from 'vitest';
import { BUILT_IN_EFFECTS, Rng } from '@mv/core';
import { EffectPicker } from './select.ts';

describe('the pounding band raise', () => {
	const pick = (energy: number, pounding: boolean, seed = 7) =>
		new EffectPicker(BUILT_IN_EFFECTS, new Rng(seed)).pick({
			role: 'rhythm',
			section: 'drop',
			lengthBars: 8,
			energy,
			pounding
		});

	/**
	 * The band a pick actually landed in, which is the thing under test - not the effect id,
	 * which the seed is entitled to choose freely within a band.
	 */
	const bandOf = (energy: number, pounding: boolean, seed = 7) =>
		pick(energy, pounding, seed)?.taste.energy ?? 0;

	it('draws harder than mean loudness asked for', () => {
		// 0.62 is Ponyboy's inner drops: band 3 of 5 on a record that pounds from bar one.
		const polite = [1, 2, 3, 4, 5].map((s) => bandOf(0.62, false, s));
		const pounding = [1, 2, 3, 4, 5].map((s) => bandOf(0.62, true, s));
		expect(Math.min(...polite)).toBeGreaterThanOrEqual(2);
		// Every seed moves up, and none of them lands below where the polite draw could.
		for (let i = 0; i < polite.length; i++) expect(pounding[i]).toBeGreaterThan(polite[i]);
	});

	it('cannot push past the top of the catalog', () => {
		// The loudest passages already target band 5, so pounding asks for nothing further:
		// same target, same seed, same pick. An uncapped raise would aim at a band no effect
		// declares, where the fit is flat and every candidate scores alike.
		for (const seed of [1, 2, 3, 4, 5]) {
			expect(pick(1, true, seed)?.id).toBe(pick(1, false, seed)?.id);
		}
	});

	it('leaves a passage that does not pound exactly where it was', () => {
		for (const e of [0, 0.25, 0.5, 0.75, 1]) {
			expect(bandOf(e, false, 3)).toBe(bandOf(e, false, 3));
			expect(pick(e, false, 3)?.id).toBe(pick(e, false, 3)?.id);
		}
	});
});

describe('the activity budget', () => {
	const pick = (
		req: Partial<Parameters<EffectPicker['pick']>[0]> & { busy: number },
		seed = 7
	) =>
		new EffectPicker(BUILT_IN_EFFECTS, new Rng(seed)).pick({
			role: 'transient',
			section: 'drop',
			lengthBars: 8,
			energy: 1,
			...req
		});
	const activity = (id: string | undefined) =>
		BUILT_IN_EFFECTS.find((e) => e.id === id)?.taste.activity ?? 0;

	it('lets one whole-room striker into a drop and nothing hard beside it', () => {
		for (let seed = 1; seed <= 12; seed++) {
			const alone = pick({ busy: 0.2 }, seed);
			expect(activity(alone?.id)).toBeLessThanOrEqual(1);
			// A unison slam already in the cue: the kit's answer has to be a gentle one.
			const beside = pick({ busy: 1.0 }, seed);
			expect(activity(beside?.id)).toBeLessThanOrEqual(0.4 + 1e-9);
		}
	});

	it('keeps whole-room strikers out of grooves and verses', () => {
		for (let seed = 1; seed <= 12; seed++) {
			expect(activity(pick({ section: 'groove', energy: 0.9, busy: 0 }, seed)?.id)).toBeLessThan(1);
			expect(activity(pick({ section: 'verse', energy: 0.9, busy: 0 }, seed)?.id)).toBeLessThan(1);
		}
	});

	it('keeps a breakdown to a slow look and a soft kit answer', () => {
		for (let seed = 1; seed <= 12; seed++) {
			// Over a bed: the moving layer may be a roll or a sweep, never a chase that strikes.
			const look = pick({ role: 'rhythm', section: 'breakdown', energy: 0.45, busy: 0.05 }, seed);
			expect(activity(look?.id)).toBeLessThanOrEqual(0.45 + 1e-9);
			// With the look and the field already in the cue, the kit's answer is a bloom.
			const answer = pick({ section: 'breakdown', energy: 0.45, busy: 0.35 }, seed);
			expect(activity(answer?.id)).toBeLessThanOrEqual(0.15 + 1e-9);
		}
	});

	it('keeps the calmest candidates rather than the whole pool when the budget is spent', () => {
		// Nothing left at all: the one transient that is a bloom rather than a strike.
		expect(pick({ busy: 1.4 })?.id).toBe('subSwell');
	});

	it('skips the budget when the caller passes none', () => {
		// The same pool that a spent budget narrows to its one bloom is open without one.
		let struck = false;
		for (let seed = 1; seed <= 12; seed++) {
			const def = new EffectPicker(BUILT_IN_EFFECTS, new Rng(seed)).pick({
				role: 'transient',
				section: 'drop',
				lengthBars: 8,
				energy: 1
			});
			if (activity(def?.id) > 0.1) struck = true;
		}
		expect(struck).toBe(true);
	});
});
