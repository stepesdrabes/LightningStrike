/**
 * node bench/roblox/mvpcheck.ts [cacheDir ...]
 *
 * Composes every cached song from the MVP set as the box will, with its cover hue and context,
 * and checks that its pack names only effects in the set and that it lints clean; each show must
 * also render like its decoded pack. Prints the set's engineSet, how many shows use each effect,
 * and the lint warnings next to those of the same songs composed from every effect.
 */
import { ANALYSIS_VERSION, BUILT_IN_EFFECTS, DEFAULT_ROOM, SHOW_VERSION, roomModel } from '@mv/core';
import { composeShow, lintShow } from '@mv/author-engine';
import { PACK_VERSION, decodePack, encodePack, engineSetDigest, portedEffects } from '@mv/roblox';
import { compareJourney } from '../../packages/roblox/src/journey.ts';
import { benchmarkCache } from '../cache.ts';
import { MVP_EFFECTS, compositionProblems } from './mvp.ts';
import { cacheArgs, cachedSongs } from './songs.ts';

const caches = cacheArgs(process.argv.slice(2), benchmarkCache());
for (const { dir, tag } of caches) console.log(`${tag} = ${dir}`);
const songs = caches.flatMap(({ dir, tag }) => cachedSongs(dir, tag));
const effects = portedEffects(MVP_EFFECTS);
const engineSet = engineSetDigest({
	packVersion: PACK_VERSION,
	analysisVersion: ANALYSIS_VERSION,
	showVersion: SHOW_VERSION,
	ids: MVP_EFFECTS
});
console.log(`MVP set: ${effects.length} effects, engineSet ${engineSet}\n`);

const room = roomModel(DEFAULT_ROOM);
const everything = new Map(BUILT_IN_EFFECTS.map((d) => [d.id, d]));
const ported = new Map(effects.map((d) => [d.id, d]));
const used = new Map(effects.map((d) => [d.id, 0]));
const warnings = { mvp: new Map<string, number>(), all: new Map<string, number>() };
const tally = (into: Map<string, number>, rules: { rule: string }[]) => {
	for (const { rule } of rules) into.set(rule, (into.get(rule) ?? 0) + 1);
};

const composed = songs.map((song) => ({
	...song,
	show: composeShow(song.analysis, { artHue: song.artHue, context: song.context, effects })
}));
let failures = 0;
for (let k = 0; k < composed.length; k++) {
	const song = composed[k];
	const next = composed[(k + 1) % composed.length];
	const problems = compositionProblems(song.show, song.analysis, MVP_EFFECTS, song.context, song.meta);
	const packed = [song, next].map((s) => decodePack(encodePack(s)));
	for (const id of packed[0].meta.effects) used.set(id, (used.get(id) ?? 0) + 1);
	const render = compareJourney([song, next], [packed[0], packed[1]], room.geometry, room.lamps.length);
	if (render.difference) problems.push(`its pack renders differently at ${render.difference}`);
	if (problems.length > 0) failures++;

	const { analysis, context } = song;
	const mvpWarnings = lintShow(song.show, { analysis, effects: ported, context }).warnings;
	const full = composeShow(analysis, { artHue: song.artHue, context });
	tally(warnings.mvp, mvpWarnings);
	tally(warnings.all, lintShow(full, { analysis, effects: everything, context }).warnings);
	const counts = [
		`${String(packed[0].meta.effects.length).padStart(2)} effects`,
		`${String(song.show.cues.length).padStart(2)} cues`,
		`${String(song.show.hits.length).padStart(2)} hits`,
		`${mvpWarnings.length} warnings`
	];
	console.log(`${song.label.padEnd(14)} ${counts.join(', ')}  ${problems.length > 0 ? problems.join('; ') : 'clean'}`);
}

const list = (m: Map<string, number>) =>
	[...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
console.log(`\nShows using each effect: ${list(used)}`);
console.log(`Lint warnings, MVP set: ${list(warnings.mvp)}`);
console.log(`Lint warnings, every effect: ${list(warnings.all)}`);
console.log(
	failures === 0
		? 'Every MVP show stays in its set, lints clean and packs losslessly.'
		: `${failures} show(s) with problems.`
);
process.exitCode = failures === 0 ? 0 : 1;
