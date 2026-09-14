// node bench/drumeval/convert-mdbpp.ts --root=DIR [--out=bench/corpus/mdb-drums-pp]
// MDBDrums++ (github.com/xavriley/MDBDrumsPlusPlus, CC BY-NC-SA 4.0): MIDI re-annotations with
// velocities of MDB Drums' 23 drum-only recordings. Its audio is sample-identical to MDB Drums'
// drum_only files, so tracks point at those.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ROOT, type DrumEvent } from './corpus.ts';
import { SHAKERS, gmClass, readMidi } from './midi.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(flag('root')!);
const out = resolve(flag('out') ?? 'bench/corpus/mdb-drums-pp');
const audioDir = join(ROOT, 'bench', 'corpus', 'mdb-drums', 'audio', 'drum_only');

const [header, ...rows] = readFileSync(join(root, 'metadata.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const column = (name: string) => header.split(',').indexOf(name);
const tracks = rows.map((row) => {
	const cells = row.split(',');
	const audio = basename(cells[column('audio_path')]);
	if (!existsSync(join(audioDir, audio))) throw new Error(`MDB Drums audio ${audio} is missing from ${audioDir}.`);
	const events: DrumEvent[] = readMidi(readFileSync(join(root, cells[column('midi_path')]))).map((n) => ({
		time: +n.time.toFixed(4), cls: gmClass(n.note), sub: `GM${n.note}`, ...(SHAKERS.includes(n.note) ? { optional: true } : {})
	}));
	return { name: audio.replace('MusicDelta_', '').replace('_Drum.wav', ''), audio: join(audioDir, audio), events };
});
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'tracks.json'), JSON.stringify({
	corpus: 'mdbpp', variantOf: 'mdb', source: 'MDBDrums++ (github.com/xavriley/MDBDrumsPlusPlus)',
	license: 'CC BY-NC-SA 4.0', tracks
}, null, '\t'));
console.log(`${tracks.length} tracks, ${tracks.reduce((n, t) => n + t.events.length, 0)} events`);
