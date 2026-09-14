// node bench/drumeval/convert-a2md.ts --root=DIR [--tiers=dist0p00,dist0p10] [--out=bench/corpus/a2md]
// A2MD (Wei et al. 2021): popular-music audio with automatically aligned Lakh MIDI drums. Labels
// are noisy (the MIDI is a cover transcription); lower distance tiers align best.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { DrumEvent } from './corpus.ts';
import { SHAKERS, gmClass, readMidi } from './midi.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(flag('root')!);
const out = resolve(flag('out') ?? 'bench/corpus/a2md');
const tiers = flag('tiers')?.split(',') ?? ['dist0p00', 'dist0p10'];

const tracks = [];
for (const tier of tiers) {
	for (const file of readdirSync(join(root, 'align_mid', tier)).filter((f) => f.endsWith('.mid')).sort()) {
		const id = file.replace('align_mid_', '').replace('.mid', '');
		const audio = join(root, 'ytd_audio', tier, `ytd_audio_${id}.mp3`);
		const notes = readMidi(readFileSync(join(root, 'align_mid', tier, file))).filter((n) => n.channel === 9);
		const events: DrumEvent[] = notes.map((n) => {
			const cls = gmClass(n.note);
			const optional = n.note === 44 || SHAKERS.includes(n.note) || (cls === 'snare' && n.velocity < 40);
			return { time: +n.time.toFixed(4), cls, sub: `GM${n.note}`, ...(optional ? { optional: true } : {}) };
		});
		if (events.filter((e) => e.cls === 'kick' || e.cls === 'snare').length < 10) continue;
		tracks.push({ name: id, genre: tier, audio: relative(out, audio).split('\\').join('/'), events });
	}
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'tracks.json'), JSON.stringify({
	corpus: 'a2md', source: 'A2MD public (github.com/Sma1033/adt_with_a2md)', license: 'unstated; research use', tracks
}, null, '\t'));
console.log(`${tracks.length} tracks, ${tracks.reduce((n, t) => n + t.events.length, 0)} events`);
