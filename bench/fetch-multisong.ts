// The multi-song test corpus: records that are several songs stitched together, and the
// hard negatives that merely change tempo or feel inside one song.
//
//   node bench/fetch-multisong.ts            # fetch what is missing, track beats, write expect.json
//
// Audio comes through the app's own search path (YouTube Music art tracks, so a clean
// release rather than a live cut), lands in bench/corpus/multisong/audio, and the beat
// model's output is cached beside the other corpora in bench/corpus/.beats so
// `bench/movements.ts --set=multisong` reads it without loading the graph again.
//
// The expectations are public knowledge, not annotations: approximate seconds where a
// listener hears a different song begin, and which tracks must NOT split. They are what the
// detector is scored against, at a tolerance of a few seconds either way.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio, downloadAudio } from '../packages/analysis/src/decode.ts';
import { searchSongs, watchUrl } from '../packages/analysis/src/ytmusic.ts';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';

interface Want {
	key: string;
	query: string;
	/** Seconds where a new song starts; empty for a track that must stay one song. */
	switches: number[];
	note: string;
}

const WANTED: Want[] = [
	{ key: 'nights', query: 'Frank Ocean Nights', switches: [208], note: 'the beat returns at 3:28 after a beatless bridge; part 1 stops at 2:58' },
	{ key: 'dna', query: 'Kendrick Lamar DNA.', switches: [111], note: 'song 1 stops at 1:51 for the Fox News sample; the second beat at 2:00 (detector-placed, unverified by ear)' },
	{ key: 'maadcity', query: 'Kendrick Lamar m.A.A.d city', switches: [148], note: 'tempo 75 to 91 with a pause at 2:28 (detector-placed, unverified by ear)' },
	{ key: 'stargazing', query: 'Travis Scott STARGAZING', switches: [156], note: 'the beat stops at 2:29, new tempo from 2:39 (detector-placed, unverified by ear)' },
	{ key: 'familyties', query: 'Baby Keem Kendrick Lamar family ties', switches: [136], note: "Baby Keem's beat stops at 1:59 and Kendrick enters at 2:16 after 15 s of none; a pause that long is the old song's ending, so the one seam is the new beat (detector-placed, unverified by ear)" },
	{ key: 'bohemian', query: 'Queen Bohemian Rhapsody', switches: [49, 183, 247, 295], note: 'a cappella, ballad, opera, hard rock, outro - the opera and rock sections are the same tempo either side so the detector reads them as a breakdown; known miss' },
	{ key: 'paranoid', query: 'Radiohead Paranoid Android', switches: [117, 208, 337], note: 'three parts; the third at 3:28 after a pause, the second returning at 5:37 via an accelerando' },
	{ key: 'suburbia', query: 'Green Day Jesus of Suburbia', switches: [113, 220, 308, 391], note: 'five movements; the two the detector places sit on pauses at 3:40 and 6:31 (unverified by ear)' },
	{ key: '911lonely', query: 'Tyler, The Creator 911 / Mr. Lonely', switches: [149], note: 'Mr. Lonely starts after an 11 s pause at 2:29' },
	{ key: 'dayinthelife', query: 'The Beatles A Day in the Life', switches: [131], note: "McCartney's section at 2:11 in the 2017 mix, back to Lennon later: an A-B-A the detector reads as a breakdown; known miss" },
	{ key: 'warmgun', query: 'The Beatles Happiness Is a Warm Gun', switches: [72, 94], note: 'three sections' },
	{ key: 'knowyourself', query: 'Drake Know Yourself', switches: [94], note: 'running through the 6 at 1:34, same tempo, related key: a near miss' },
	{ key: 'singaboutme', query: "Kendrick Lamar Sing About Me, I'm Dying of Thirst", switches: [400], note: 'the second song at ~6:40; not found' },
	{ key: 'stairway', query: 'Led Zeppelin Stairway to Heaven', switches: [], note: 'NEGATIVE: gradual acceleration, one song' },
	{ key: 'freebird', query: 'Lynyrd Skynyrd Free Bird', switches: [], note: 'NEGATIVE: accelerando into the solo, one song' },
	{ key: 'thisisamerica', query: 'Childish Gambino This Is America', switches: [], note: 'NEGATIVE: alternating feels at one tempo' },
	{ key: 'runaway', query: 'Kanye West Runaway', switches: [], note: 'NEGATIVE: nine minutes, one song, long vocoder outro' },
	{ key: 'cydonia', query: 'Muse Knights of Cydonia', switches: [], note: 'NEGATIVE: tempo sections inside one song' }
];

const ROOT = join(import.meta.dirname, 'corpus', 'multisong');
const AUDIO = join(ROOT, 'audio');
const BEATS = join(import.meta.dirname, 'corpus', '.beats');
mkdirSync(AUDIO, { recursive: true });
mkdirSync(BEATS, { recursive: true });

const AUDIO_EXT = /\.(m4a|webm|opus|mp3|ogg|oga|aac|wav|flac|mp4|mka)$/i;
const have = (key: string) => readdirSync(AUDIO).find((f) => f.startsWith(`${key}.`) && AUDIO_EXT.test(f));

let model: BeatThis | null = null;
const expect: Record<string, { id: string; title: string; switches: number[]; note: string }> = {};

for (const want of WANTED) {
	let file = have(want.key);
	let id = '';
	let title = want.query;
	if (!file) {
		try {
			const songs = await searchSongs(want.query, 3);
			const song = songs[0];
			if (!song) {
				console.log(`${want.key}: no search result`);
				continue;
			}
			id = song.id;
			title = `${song.artist} - ${song.title}`;
			console.log(`${want.key}: ${title} (${song.id}, ${Math.round(song.duration)}s) downloading`);
			await downloadAudio(watchUrl(song.id), join(AUDIO, `${want.key}.%(ext)s`));
			file = have(want.key);
		} catch (e) {
			console.log(`${want.key}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
			continue;
		}
	}
	if (!file) {
		console.log(`${want.key}: download wrote nothing`);
		continue;
	}
	const beatsPath = join(BEATS, `multisong-${want.key}.json`);
	if (!existsSync(beatsPath)) {
		const decoded = await decodeAudio(join(AUDIO, file));
		model ??= await BeatThis.create();
		const tracked = await model.run(decoded.mono);
		writeFileSync(beatsPath, JSON.stringify(tracked));
		console.log(`${want.key}: ${tracked.beats.length} beats, ${tracked.downbeats.length} downbeats over ${Math.round(decoded.duration)}s`);
	}
	expect[want.key] = { id, title, switches: want.switches, note: want.note };
}

writeFileSync(join(ROOT, 'expect.json'), JSON.stringify(expect, null, '\t'));
if (model) await model.close();
console.log('multisong corpus ready');
