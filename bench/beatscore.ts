import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { decodeAudio } from '@mv/analysis';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';
import { scoreBeats } from './metrics.ts';

/**
 * Score GTZAN beats and annotated beat-1 downbeats with F-measure.
 * node bench/beatscore.ts [--limit 100]
 */
const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : d;
};
const limit = Number(flag('limit', '100'));
/** An alternative checkpoint exported by bench/export-beatthis.py, in models/. */
const modelFile = flag('model', 'beat_this.onnx');

const ROOT = join(import.meta.dirname, 'corpus');
const AUDIO = join(ROOT, 'gtzan_mini-main', 'genres');
const BEATS = join(ROOT, 'gtzan_tempo_beat-main', 'beats');

interface Ref {
	id: string;
	audio: string;
	beats: number[];
	downbeats: number[];
}

/** `<time>\t<beat number>`, where 1 is the downbeat. */
async function annotation(path: string): Promise<{ beats: number[]; downbeats: number[] }> {
	const beats: number[] = [];
	const downbeats: number[] = [];
	for (const line of (await readFile(path, 'utf8')).split('\n')) {
		const [t, n] = line.trim().split(/\s+/);
		const time = Number(t);
		if (!Number.isFinite(time) || line.trim() === '') continue;
		beats.push(time);
		if (Number(n) === 1) downbeats.push(time);
	}
	return { beats, downbeats };
}

const refs: Ref[] = [];
for (const genre of await readdir(AUDIO, { withFileTypes: true })) {
	if (!genre.isDirectory()) continue;
	for (const file of await readdir(join(AUDIO, genre.name))) {
		if (!file.endsWith('.wav')) continue;
		// pop.00009.wav against gtzan_pop_00009.beats
		const id = basename(file, '.wav').replace('.', '_');
		const marks = join(BEATS, `gtzan_${id}.beats`);
		if (!existsSync(marks)) continue;
		refs.push({ id, audio: join(AUDIO, genre.name, file), ...(await annotation(marks)) });
	}
}
refs.sort((a, b) => a.id.localeCompare(b.id));
const tracks = refs.slice(0, limit);
console.error(`${tracks.length} annotated tracks`);

const model = await BeatThis.create(modelFile);
const beat = { f: 0, cmlT: 0, amlT: 0 };
const down = { f: 0, cmlT: 0, amlT: 0 };
let done = 0;

for (const track of tracks) {
	try {
		const decoded = await decodeAudio(track.audio);
		const tracked = await model.run(decoded.mono);
		const b = scoreBeats(track.beats, tracked.beats);
		const d = scoreBeats(track.downbeats, tracked.downbeats);
		beat.f += b.f;
		beat.cmlT += b.cmlT;
		beat.amlT += b.amlT;
		down.f += d.f;
		down.cmlT += d.cmlT;
		down.amlT += d.amlT;
		done++;
		if (done % 20 === 0) console.error(`  ${done}/${tracks.length}`);
	} catch (e) {
		console.error(`  ${track.id}: ${(e as Error).message.split('\n')[0]}`);
	}
}
await model.close();

const mean = (v: number) => (v / Math.max(1, done)).toFixed(3);
console.log(`n=${done}  ${modelFile}`);
console.log(`  beat      F=${mean(beat.f)}  CMLt=${mean(beat.cmlT)}  AMLt=${mean(beat.amlT)}`);
console.log(`  downbeat  F=${mean(down.f)}  CMLt=${mean(down.cmlT)}  AMLt=${mean(down.amlT)}`);
