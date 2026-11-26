import type { Show, TrackAnalysis, TrackContext } from '@mv/core';
import { lintShow } from '@mv/author-engine';
import { decodePack, encodePack, portedEffects, type PackMeta } from '@mv/roblox';

/** The first Luau build's set (ADR-0001): 28 show effects and 3 for the first rest scenes. */
export const MVP_EFFECTS = [
	'wash', 'twoTone', 'chorusBloom', 'anthemWash', 'undertow', 'spectrumBed', 'blackout', 'pump',
	'snapSplit', 'blockChase', 'vortex', 'comet', 'meterBuild', 'riser', 'snareBlade', 'pingPong',
	'clapAlong', 'kitTicks', 'crownSpill', 'vocalGlow', 'pitchRibbon', 'bandBloom', 'buildStrobe',
	'silhouette', 'blinderWall', 'slam', 'strobe', 'colorBump', 'harmonicRibbon', 'ambientDrift', 'breathe'
];

/**
 * What is wrong with a show composed for a build that ported `ids`: an effect its pack names
 * outside the set, which is the check a game server makes, or a lint error.
 */
export function compositionProblems(
	show: Show,
	analysis: TrackAnalysis,
	ids: readonly string[],
	context: TrackContext | null,
	meta: PackMeta
): string[] {
	const defs = portedEffects(ids);
	const allowed = new Set(defs.map((d) => d.id));
	const named = decodePack(encodePack({ analysis, show, meta })).meta.effects;
	const problems = named.filter((id) => !allowed.has(id)).map((id) => `plays ${id}, outside the set`);
	const verdict = lintShow(show, { analysis, effects: new Map(defs.map((d) => [d.id, d])), context });
	for (const e of verdict.errors) problems.push(`lint ${e.rule}${e.bar === undefined ? '' : ` at bar ${e.bar}`}: ${e.message}`);
	return problems;
}
