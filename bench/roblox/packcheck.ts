/**
 * node bench/roblox/packcheck.ts [cacheDir ...]
 *
 * Packs every cached song, reports its raw, zstd and wire sizes, and renders it through the room
 * director twice, from its analysis and show and from its decoded pack: its opening, a seek to
 * its first drop, a seek to its ending and the handover into the next song, in the Frame's room
 * and in the club's. A difference in bytes, lamps, light or show frames fails the song.
 */
import { CLUB_ROOM, DEFAULT_ROOM, roomModel } from '@mv/core';
import { compressPack, decodePack, encodePack, packToWire } from '@mv/roblox';
import { compareJourney } from '../../packages/roblox/src/journey.ts';
import { benchmarkCache } from '../cache.ts';
import { cacheArgs, cachedSongs } from './songs.ts';

const caches = cacheArgs(process.argv.slice(2), benchmarkCache());
for (const { dir, tag } of caches) console.log(`${tag} = ${dir}`);
const songs = caches.flatMap(({ dir, tag }) => cachedSongs(dir, tag));
const rooms = [
	{ name: 'frame', model: roomModel(DEFAULT_ROOM) },
	{ name: 'club', model: roomModel(CLUB_ROOM) }
];
const packs = songs.map((song) => encodePack(song));
const decoded = packs.map((pack) => decodePack(pack));

const kb = (n: number) => (n / 1024).toFixed(1).padStart(6);
let failures = 0;
const totals = { raw: 0, zstd: 0, wire: 0, seconds: 0 };
const heading = ['song'.padEnd(14), 'length'.padStart(7), 'raw KB'.padStart(6), 'zstd'.padStart(6), 'wire'.padStart(6)];
console.log(`\n${heading.join(' ')}  render`);
for (let k = 0; k < songs.length; k++) {
	const next = (k + 1) % songs.length;
	const zstd = compressPack(packs[k]).length;
	const wire = packToWire(packs[k]).length;
	const seconds = songs[k].analysis.duration;
	totals.raw += packs[k].length;
	totals.zstd += zstd;
	totals.wire += wire;
	totals.seconds += seconds;
	const verdicts = rooms.map(({ name, model }) => {
		const pair = [songs[k], songs[next]] as const;
		const run = compareJourney(pair, [decoded[k], decoded[next]], model.geometry, model.lamps.length);
		if (run.difference) failures++;
		return `${name} ${run.difference ? `DIFFERS at ${run.difference}` : `same over ${run.frames} frames`}`;
	});
	const sizes = `${kb(packs[k].length)} ${kb(zstd)} ${kb(wire)}`;
	console.log(`${songs[k].label.padEnd(14)} ${seconds.toFixed(1).padStart(6)}s ${sizes}  ${verdicts.join(', ')}`);
}
const n = songs.length;
const perSecond = (totals.zstd / totals.seconds / 1024).toFixed(2);
console.log(
	`\n${n} songs, ${(totals.seconds / 60).toFixed(1)} min. Mean raw ${kb(totals.raw / n)} KB, ` +
		`zstd ${kb(totals.zstd / n)} KB, wire ${kb(totals.wire / n)} KB; zstd ${perSecond} KB per second of audio.`
);
console.log(failures === 0 ? 'Every pack renders identically.' : `${failures} difference(s).`);
process.exitCode = failures === 0 ? 0 : 1;
