import { createHash } from 'node:crypto';
import type { EffectDef, Hit } from '@mv/core';
import { BUILT_IN_EFFECTS } from '@mv/core';

/** The effect each hit kind installs on the master layer, as the player maps them. A blackout dims the mixer. */
export const HIT_EFFECT: Readonly<Record<Hit['kind'], string | null>> = {
	slam: 'slam',
	strobe: 'strobe',
	bump: 'colorBump',
	blackout: null
};

/** Every build needs these: composeShow places hits whatever effects it is given. */
export const HIT_EFFECTS: readonly string[] = ['slam', 'strobe', 'colorBump'];

/**
 * The effects to compose with for a build that has ported `ids`, plus the hit effects. They come
 * in registry order because the picker's draws follow the order it is given, so a set composes
 * the same however it is listed. An id this LightningStrike does not have throws.
 */
export function portedEffects(ids: readonly string[]): EffectDef[] {
	const known = new Set(BUILT_IN_EFFECTS.map((d) => d.id));
	const unknown = [...new Set(ids.filter((id) => !known.has(id)))];
	if (unknown.length > 0) throw new Error(`not built-in effects: ${unknown.join(', ')}`);
	const wanted = new Set([...ids, ...HIT_EFFECTS]);
	return BUILT_IN_EFFECTS.filter((d) => wanted.has(d.id));
}

export interface EngineSet {
	packVersion: number;
	analysisVersion: number;
	showVersion: number;
	/** Ported effect ids, in any order. */
	ids: readonly string[];
}

/**
 * The short key a build asks the box to compose for, and caches packs under: the first 8 hex
 * digits of sha256 over `{"analysisVersion":A,"ids":[...],"packVersion":P,"showVersion":S}`,
 * where ids are the set `portedEffects` composes with (deduplicated, hit effects added), sorted
 * by code unit, which is byte order for these ASCII ids.
 */
export function engineSetDigest(set: EngineSet): string {
	for (const key of ['packVersion', 'analysisVersion', 'showVersion'] as const) {
		if (!Number.isInteger(set[key])) throw new Error(`${key} ${set[key]} is not an integer`);
	}
	const ids = [...new Set([...set.ids, ...HIT_EFFECTS])].sort();
	const canonical = JSON.stringify({
		analysisVersion: set.analysisVersion,
		ids,
		packVersion: set.packVersion,
		showVersion: set.showVersion
	});
	return createHash('sha256').update(canonical).digest('hex').slice(0, 8);
}
