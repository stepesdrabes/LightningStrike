// node bench/drumeval/convert-gmd.ts --root=DIR [--split=test] [--out=bench/corpus/gmd]
// Groove MIDI Dataset (Gillick et al. 2019, CC BY 4.0): drummers on a Roland TD-11 kit, with the
// module's audio of each performance. Lists one official split's sequences that have audio.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DrumClass, DrumEvent } from './corpus.ts';
import { readMidi } from './midi.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(flag('root')!);
const split = flag('split') ?? 'test';
const out = resolve(flag('out') ?? 'bench/corpus/gmd');

/** TD-11 keys, rims, edges and the pedal hat included, grouped as ADTOF's MIDI_REDUCED_5. */
const TD11: Record<number, DrumClass> = {
	36: 'kick', 37: 'snare', 38: 'snare', 40: 'snare', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom', 58: 'tom',
	22: 'hat', 26: 'hat', 42: 'hat', 44: 'hat', 46: 'hat',
	49: 'cymbal', 51: 'cymbal', 52: 'cymbal', 53: 'cymbal', 55: 'cymbal', 57: 'cymbal', 59: 'cymbal'
};

const [header, ...rows] = readFileSync(join(root, 'info.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const column = (name: string) => header.split(',').indexOf(name);
const tracks = rows.map((row) => row.split(',')).filter((cells) => cells[column('split')] === split && cells[column('audio_filename')])
	.map((cells) => {
		const events: DrumEvent[] = readMidi(readFileSync(join(root, cells[column('midi_filename')]))).map((n) => ({
			time: +n.time.toFixed(4), cls: TD11[n.note] ?? 'other', sub: `TD${n.note}`
		}));
		return {
			name: cells[column('id')].split('/').join('_'), genre: cells[column('style')].split('/')[0],
			audio: join(root, cells[column('audio_filename')]), events
		};
	});
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'tracks.json'), JSON.stringify({
	corpus: 'gmd', source: `Groove MIDI Dataset v1.0.0 ${split} split (magenta.tensorflow.org/datasets/groove)`,
	license: 'CC BY 4.0', tracks
}, null, '\t'));
console.log(`${tracks.length} tracks, ${tracks.reduce((n, t) => n + t.events.length, 0)} events`);
