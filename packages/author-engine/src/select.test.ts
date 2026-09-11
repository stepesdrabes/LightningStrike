import { describe, expect, it } from 'vitest';
import { BUILT_IN_EFFECTS, Rng, type EffectDef } from '@mv/core';
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

	/** Assert the chosen energy band; the seed may freely choose an effect inside it. */
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
		for (const seed of [1, 2, 3, 4, 5]) {
			expect(bandOf(1, true, seed)).toBeGreaterThanOrEqual(4);
			expect(bandOf(1, true, seed)).toBeLessThanOrEqual(5);
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

	it('leaves an optional layer out when the activity budget is spent', () => {
		expect(pick({ busy: 1.4 })).toBeNull();
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

describe('individual kick preference', () => {
	const base = BUILT_IN_EFFECTS.find(e => e.id === 'snapSplit')!;
	const pulse = { ...base, id: 'pulse', taste: { ...base.taste, kickAccent: true, activity: 0.5 } };
	const motion = { ...base, id: 'motion', taste: { ...base.taste, kickAccent: false, activity: 0.2 } };
	const request = { role: 'rhythm' as const, section: 'chorus' as const, lengthBars: 8, energy: 0.9, kickAccent: true, drums: {kick: 0.5, snare: 0.25, hat: 2} };
	it('prefers a direct kick rise even over a favored grid gesture', () => {
		expect(new EffectPicker([pulse, motion], new Rng(7)).pick({ ...request, prefer: ['motion'] })?.id).toBe('pulse');
	});
	it('falls back within the activity budget and respects exclusions', () => {
		expect(new EffectPicker([pulse, motion], new Rng(7)).pick({ ...request, busy: 1.1 })?.id).toBe('motion');
		expect(new EffectPicker([pulse, motion], new Rng(7)).pick({ ...request, exclude: ['pulse'] })?.id).toBe('motion');
		expect(new EffectPicker([pulse, motion], new Rng(7)).pick({ ...request, drums: {kick: 0, snare: 1, hat: 2} })).toBeNull();
	});
});

describe('sustained chorus drive', () => {
	const template = BUILT_IN_EFFECTS.find((effect) => effect.role === 'rhythm')!;
	const effect = (id: string, taste: Partial<EffectDef['taste']>): EffectDef => ({
		...template, id,
		taste: { energy: 3, sections: ['chorus', 'drop'], minBars: 2, maxBars: 32,
			peakReserved: false, activity: 0.1, ...taste }
	});
	const subtle = effect('subtle', { energy: 2 });
	const driver = effect('driver', { energy: 4, activity: 0.6, kit: 'kick' });
	const request = {
		role: 'rhythm' as const, section: 'chorus' as const, lengthBars: 8,
		energy: 0.84, pounding: true, drums: { kick: 1, snare: 0, hat: 2 }, busy: 0.1
	};

	it('keeps a strong rhythm after repeated earlier uses have spent its novelty', () => {
		const picker = new EffectPicker([subtle, driver], new Rng(7));
		for (let i = 0; i < 16; i++) picker.reserve(driver.id);
		for (let chorus = 0; chorus < 8; chorus++) expect(picker.pick(request)?.id).toBe(driver.id);
	});

	it('reuses fitting rhythms before importing an avoided genre gesture late in a show', () => {
		const second = effect('second-driver', { energy: 4, activity: 0.4, kit: 'kick' });
		const foreign = effect('foreign-driver', { energy: 4, activity: 0.4, kit: 'kick' });
		const picker = new EffectPicker([subtle, driver, second, foreign], new Rng(7));
		for (let i = 0; i < 16; i++) { picker.reserve(driver.id); picker.reserve(second.id); }
		const choices = Array.from({ length: 8 }, () => picker.pick({ ...request, avoid: [foreign.id] })?.id);
		expect(choices).not.toContain(foreign.id);
		expect(new Set(choices).size).toBe(2);
	});

	it('raises a returning group when its formerly quiet rhythm no longer matches the drums', () => {
		const picker = new EffectPicker([subtle, driver], new Rng(7));
		expect(picker.pick({ ...request, group: 2, pounding: false, energy: 0.25 })?.id).toBe(subtle.id);
		expect(picker.pick({ ...request, group: 2 })?.id).toBe(driver.id);
	});

	it('gives the pounding lead to the detected kit instead of an autonomous high-energy pattern', () => {
		const orbit = effect('orbit', { energy: 4, activity: 0.2 });
		const picker = new EffectPicker([orbit, driver], new Rng(7));
		picker.reserve(driver.id);
		expect(picker.pick(request)?.id).toBe(driver.id);
		expect(picker.pick({ ...request, drums: { kick: 0, snare: 0, hat: 0 } })?.id).toBe(orbit.id);
	});

	it('falls back inside the activity, instrument and character constraints', () => {
		const snare = effect('absent-snare', { energy: 5, kit: 'snare' });
		const flash = effect('forbidden-flash', { energy: 5, character: 'flash' });
		const picker = new EffectPicker([subtle, driver, snare, flash], new Rng(7), { vetoCharacter: true });
		expect(picker.pick({ ...request, busy: 1.2 })?.id).toBe(subtle.id);
		expect(picker.pick({ ...request, busy: 1.4 })).toBeNull();
	});

	it('does not bring back an excluded strong rhythm to satisfy the floor', () => {
		const picker = new EffectPicker([subtle, driver], new Rng(7));
		expect(picker.pick({ ...request, exclude: [driver.id] })?.id).toBe(subtle.id);
	});
});

describe('musical space', () => {
	it.each([undefined, 4.5])('does not invent a quiet preference when all measurements are %s', (quiet) => {
		const template = BUILT_IN_EFFECTS.find((effect) => effect.role === 'rhythm')!;
		const pool = ['first', 'middle', 'last'].map((id): EffectDef => ({
			...template, id,
			taste: { energy: 2, sections: ['intro'], minBars: 2, maxBars: 32, peakReserved: false, quiet }
		}));
		const request = { role: 'rhythm' as const, section: 'intro' as const, lengthBars: 8, energy: 0.25 };
		const chosen = new Set<string>();
		for (let sample = 1; sample <= 32; sample++) {
			const seed = Math.imul(sample, 0x9e3779b9);
			const ordinary = new EffectPicker(pool, new Rng(seed)).pick(request)!;
			const bare = new EffectPicker(pool, new Rng(seed)).pick({ ...request, bare: true })!;
			expect(bare.id).toBe(ordinary.id);
			chosen.add(bare.id);
		}
		expect(chosen.size).toBe(pool.length);
	});

	it('leaves the drum layer out when its entire pool requires an absent instrument', () => {
		const snares = BUILT_IN_EFFECTS.filter((effect) => effect.role === 'transient' && effect.taste.kit === 'snare');
		const picker = new EffectPicker(snares, new Rng(7));
		const request = { role: 'transient' as const, section: 'drop' as const, lengthBars: 8, energy: 1 };
		expect(picker.pick({ ...request, drums: { kick: 1, snare: 0, hat: 2 } })).toBeNull();
		expect(picker.pick({ ...request, drums: { kick: 1, snare: 0.5, hat: 2 } })?.taste.kit).toBe('snare');
	});

	it('keeps group identity only while the returning effect is still allowed', () => {
		const picker = new EffectPicker(BUILT_IN_EFFECTS, new Rng(7));
		const request = { role: 'rhythm' as const, section: 'drop' as const, lengthBars: 8, energy: 0.7, group: 3 };
		const first = picker.pick(request)!;
		expect(picker.pick({ ...request, exclude: [first.id] })?.id).not.toBe(first.id);
	});
});
