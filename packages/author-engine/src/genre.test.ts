import { describe, expect, it } from 'vitest';
import { BUILT_IN_EFFECTS, Rng, emptyContext, sectionBase, type TrackContext } from '@mv/core';
import { composeShow } from './plan.ts';
import { lintShow } from './lint.ts';
import { allowedFlashes, profileFor } from './genre.ts';
import { EffectPicker } from './select.ts';
import { fixture } from './fixture.ts';

function contextFor(family: TrackContext['genreFamily']): TrackContext {
	return { ...emptyContext(), genreFamily: family, sources: ['test'] };
}

describe('flash allowance', () => {
	it('scales the family budget by how hard the track goes', () => {
		const analysis = fixture();
		const techno = allowedFlashes(analysis, contextFor('techno'));
		const pop = allowedFlashes(analysis, contextFor('pop'));
		expect(techno).toBeGreaterThan(pop);
	});

	it('is zero for the families that forbid the gesture', () => {
		expect(allowedFlashes(fixture(), contextFor('ballad'))).toBe(0);
		expect(allowedFlashes(fixture(), contextFor('rnb'))).toBe(0);
		expect(allowedFlashes(fixture(), contextFor('ambient'))).toBe(0);
	});

	it('falls back to one for a track nobody could identify', () => {
		expect(allowedFlashes(fixture(), null)).toBe(1);
	});
});

describe('genre-shaped shows', () => {
	it('a ballad never flashes and never slams', () => {
		const show = composeShow(fixture(), { context: contextFor('ballad') });
		const kinds = new Set(show.hits.map((h) => h.kind));
		expect(kinds.has('strobe')).toBe(false);
		expect(kinds.has('blackout')).toBe(false);
		expect(kinds.has('slam')).toBe(false);
	});

	it('techno spends more flashes than the default and stays monochrome', () => {
		const techno = composeShow(fixture(), { context: contextFor('techno') });
		const plain = composeShow(fixture());
		const flashes = (s: typeof techno) =>
			s.hits.filter((h) => h.kind === 'strobe' || h.kind === 'blackout').length;
		expect(flashes(techno)).toBeGreaterThanOrEqual(flashes(plain));
		expect(techno.palette.third).toBe(techno.palette.base);
	});

	it('a ballad slows the room down against the default', () => {
		const ballad = composeShow(fixture(), { context: contextFor('ballad') });
		const plain = composeShow(fixture());
		const mean = (s: typeof ballad) =>
			s.cues.reduce((acc, c) => acc + (c.motion ?? 1), 0) / s.cues.length;
		expect(mean(ballad)).toBeLessThan(mean(plain) * 0.7);
	});

	it('every profile row exists and composes a lintable show', () => {
		for (const family of ['techno', 'house', 'edm', 'trance', 'bass', 'pop', 'rock', 'metal', 'punk', 'hiphop', 'rnb', 'ballad', 'ambient', 'latin', 'disco'] as const) {
			const show = composeShow(fixture(), { context: contextFor(family) });
			expect(show.cues.length).toBeGreaterThan(0);
			expect(profileFor(contextFor(family))).toBeDefined();
		}
	});

	it('a swell family arrives on a ramp, not a step', () => {
		const ballad = composeShow(fixture(), { context: contextFor('ballad') });
		const opener = ballad.cues.find((c) => sectionBase(c.section) === 'drop');
		expect(opener?.fadeBeats).toBe(8);
	});

	it('the linter refuses flash-character layers where the allowance is zero', () => {
		const analysis = fixture();
		const show = composeShow(analysis, { context: contextFor('rnb') });
		expect(
			show.cues.every((c) =>
				Object.values(c.layers).every(
					(l) => !l || BUILT_IN_EFFECTS.find((e) => e.id === l.effect)?.taste.character === undefined
				)
			),
			'the engine itself must never spend a flash-character effect at allowance zero'
		).toBe(true);
		// An agent's revision reintroducing one is the linter's to catch.
		show.cues[5].layers.accent = { effect: 'stageBlinders' };
		const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
		const verdict = lintShow(show, { analysis, effects, context: contextFor('rnb') });
		expect(verdict.ok).toBe(false);
		expect(verdict.errors.some((e) => e.rule === 'flash-character')).toBe(true);
	});

	it('a peak master serves the treatment it declares, at every seed', () => {
		// The reserved draw is a seed-broken tie, so adding any master reshuffles who wins;
		// without the style match a bloom look landed on a rap climax (the A/B round's one
		// regression). Sixty seeds, both treatments, no crossover.
		for (let seed = 1; seed <= 60; seed++) {
			const slam = new EffectPicker(BUILT_IN_EFFECTS, new Rng(seed)).strongest('master', 'drop', 1, 'slam');
			const bloom = new EffectPicker(BUILT_IN_EFFECTS, new Rng(seed)).strongest('master', 'chorus', 1, 'bloom');
			expect(slam?.taste.peakStyle ?? 'slam').toBe('slam');
			expect(bloom?.taste.peakStyle ?? 'bloom').toBe('bloom');
		}
		// Pin peak pools explicitly so adding a master cannot silently switch bloom and impact
		// treatments.
		const eligible = (peak: 'slam' | 'bloom') =>
			BUILT_IN_EFFECTS.filter(
				(e) =>
					e.role === 'master' &&
					!e.taste.hitOnly &&
					!(peak === 'bloom' && e.taste.character === 'flash') &&
					!(e.taste.peakStyle && e.taste.peakStyle !== peak)
			)
				.map((e) => e.id)
				.sort();
		expect(eligible('slam')).toEqual(['blinderWall', 'chromaBurst', 'shutterCut', 'silhouette']);
		expect(eligible('bloom')).toEqual(['chromaBurst', 'tideBloom']);
	});

	it('every signature resolves to a catalog effect the picker can actually prefer', () => {
		// A master in a signature row is dead weight pretending to matter: pick() is never
		// called for masters and strongest() ignores prefer by documented design.
		const byId = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
		for (const family of ['techno', 'house', 'edm', 'trance', 'bass', 'pop', 'rock', 'metal', 'punk', 'hiphop', 'rnb', 'ballad', 'ambient', 'latin', 'disco'] as const) {
			for (const id of profileFor(contextFor(family)).signatures) {
				const def = byId.get(id);
				expect(def, `${family} signature ${id} is not in the catalog`).toBeDefined();
				expect(def!.role, `${family} signature ${id} is a master`).not.toBe('master');
			}
		}
	});

	it('every avoided effect resolves, is never also a signature, and is never a master', () => {
		// The same law as signatures: a stale id in an avoid row is a weight against nothing,
		// invisible until someone renames an effect and the family quietly stops avoiding it.
		const byId = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
		for (const family of ['techno', 'house', 'edm', 'trance', 'bass', 'pop', 'rock', 'metal', 'punk', 'hiphop', 'rnb', 'ballad', 'ambient', 'latin', 'disco'] as const) {
			const profile = profileFor(contextFor(family));
			for (const id of profile.avoid) {
				const def = byId.get(id);
				expect(def, `${family} avoids ${id}, which is not in the catalog`).toBeDefined();
				expect(def!.role, `${family} avoids the master ${id}, which pick() never sees`).not.toBe('master');
				expect(
					profile.signatures.includes(id),
					`${family} both prefers and avoids ${id}`
				).toBe(false);
			}
		}
	});

	it('a signature seasons the family, it does not define every show', () => {
		// Signature sampling must allow omission across deterministic seeds while keeping each
		// effect reachable.
		let withSpin = 0;
		const runs = 60;
		for (let seed = 1; seed <= runs; seed++) {
			const show = composeShow(fixture(), { seed: seed * 131, context: contextFor('house') });
			const used = new Set(
				show.cues.flatMap((c) => Object.values(c.layers).map((l) => l!.effect))
			);
			if (used.has('impulseSpin')) withSpin++;
		}
		expect(withSpin / runs).toBeLessThan(0.75);
		expect(withSpin / runs).toBeGreaterThan(0.05);
	});

	it('the wildcard is never a flash or an impact', () => {
		// Its freedom is from the section vocabulary, not from the gesture rules: a strobe as
		// the one surprise in a rap verse reads as a fault. Seeds vary which effect wins, so
		// assert over many.
		const byId = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
		for (let seed = 1; seed <= 40; seed++) {
			const show = composeShow(fixture(), { seed, context: contextFor('hiphop') });
			const wild = show.cues.find((c) => c.note?.includes('one stranger'));
			if (!wild?.layers.accent) continue;
			const def = byId.get(wild.layers.accent.effect);
			expect(def?.taste.character, `seed ${seed} planted ${def?.id}`).toBeUndefined();
		}
	});
});
