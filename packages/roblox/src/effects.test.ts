import { describe, expect, it } from 'vitest';
import type { Hit } from '@mv/core';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	barTimeAt,
	roomModel
} from '@mv/core';
import { HIT_EFFECT, HIT_EFFECTS, engineSetDigest, portedEffects } from './effects.ts';
import { fixtureSong } from './fixture.ts';

describe('hit effects', () => {
	it('are what the player installs for each kind of hit', () => {
		const { analysis, show } = fixtureSong(1);
		const geometry = roomModel(DEFAULT_ROOM).geometry;
		const kinds: Hit['kind'][] = ['slam', 'strobe', 'bump', 'blackout'];
		const installed = Object.fromEntries(
			kinds.map((kind) => {
				const mixer = new Mixer(geometry);
				const player = new ShowPlayer(mixer, new EffectRegistry());
				const cue = { bar: 0, section: 'intro' as const, layers: { bed: { effect: 'wash' } }, note: '' };
				player.load(analysis, { ...show, cues: [cue], hits: [{ bar: 8, kind, beats: 2 }] });
				player.update(barTimeAt(analysis.tempo, 8) + 0.01, 1 / 60);
				if (kind === 'blackout') expect(mixer.dim).toBe(0.02);
				return [kind, mixer.layers.master.def?.id ?? null];
			})
		);
		expect(installed).toEqual(HIT_EFFECT);
		expect([...HIT_EFFECTS].sort()).toEqual(Object.values(HIT_EFFECT).filter((id) => id !== null).sort());
	});
});

describe('the ported set', () => {
	it('composes with its effects in registry order, plus the hit effects', () => {
		const ids = ['wash', 'pump', 'wash', 'blackout'];
		const wanted = new Set([...ids, ...HIT_EFFECTS]);
		const defs = portedEffects(ids);
		expect(defs.map((d) => d.id)).toEqual(BUILT_IN_EFFECTS.filter((d) => wanted.has(d.id)).map((d) => d.id));
		expect(portedEffects([...ids].reverse())).toEqual(defs);
		expect(portedEffects([]).map((d) => d.id).sort()).toEqual([...HIT_EFFECTS].sort());
	});

	it('refuses an effect this LightningStrike does not have', () => {
		expect(() => portedEffects(['wash', 'noSuch', 'alsoNot', 'noSuch'])).toThrow(
			'not built-in effects: noSuch, alsoNot'
		);
	});

	it('is keyed by its versions and the set it composes with', () => {
		const set = { packVersion: 1, analysisVersion: 40, showVersion: 37, ids: ['wash', 'pump'] };
		// {"analysisVersion":40,"ids":["colorBump","pump","slam","strobe","wash"],"packVersion":1,"showVersion":37}
		expect(engineSetDigest(set)).toBe('b2eb12f8');
		expect(engineSetDigest({ ...set, ids: ['pump', 'wash', 'wash', ...HIT_EFFECTS] })).toBe('b2eb12f8');
		expect(engineSetDigest({ ...set, showVersion: 38 })).not.toBe('b2eb12f8');
		expect(engineSetDigest({ ...set, ids: ['wash'] })).not.toBe('b2eb12f8');
		expect(() => engineSetDigest({ ...set, packVersion: Number.NaN })).toThrow('packVersion');
	});
});
