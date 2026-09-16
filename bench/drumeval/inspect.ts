// node bench/drumeval/inspect.ts --track=library/AHaIdOXzzuE [--model=models/striker.json] [--from=24 --to=48]
// One track's candidates and what the model makes of them: how many each view proposes, the spread
// of probabilities, what the threshold accepts, and, with labels, the references nothing proposed.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { referenceTimes, tracks, trackKey, type DrumClass } from './corpus.ts';
import { evidenceDir, files, readF32, readJson, type AudioRecord, type BeatsRecord } from './evidence.ts';
import { matchEvents } from './score.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const wanted = flag('track')!;
const modelPath = resolve(flag('model') ?? join(import.meta.dirname, '..', '..', 'models', 'striker.json'));
const from = Number(flag('from') ?? 0);
const to = Number(flag('to') ?? Infinity);
const SRC = join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src');
const load = async (file: string) => import(pathToFileURL(join(SRC, file)).href);

const track = tracks([wanted.split('/')[0] + ':' + wanted.split('/')[1]]).find((t) => trackKey(t) === wanted);
if (!track) throw new Error(`no track ${wanted}`);

const { analyzeTrack } = await load('analyze.ts');
const { onsetsFromActivations } = await load('adtof.ts');
const { sourceOnsets } = await load('separatedDrums.ts');
const { decodeAudio } = await load('decode.ts');
const { validateStrikerModel, strikerProbabilities, STRIKER_FEATURES } = await load('striker.ts');
const model = existsSync(modelPath) ? validateStrikerModel(JSON.parse(readFileSync(modelPath, 'utf8'))) : null;

const dir = evidenceDir(track);
const audio = readJson<AudioRecord>(join(dir, files.audio))!;
const beats = readJson<BeatsRecord>(join(dir, files.beats))!;
const decoded = await decodeAudio(track.audio);
if (decoded.hash !== audio.hash22) throw new Error('stale evidence');
const mixAct = readF32(join(dir, files.adtofMix));
const [kick, snare, hat, cymbal] = [files.kick22, files.snare22, files.hat22, files.cymbal22]
	.map((file) => readF32(join(dir, file)));
const probe: { striker?: { candidates?: Record<string, { times: number[]; features: Float32Array }> } } = { striker: {} };
analyzeTrack({
	mono: decoded.mono, left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate,
	duration: decoded.duration, hash: decoded.hash, trackId: track.name, title: track.name,
	beats: beats.beats, downbeats: beats.downbeats, drums: onsetsFromActivations(mixAct),
	separatedDrums: { kick, snare, hat, cymbal, sampleRate: 22050 },
	separatedOnsets: {
		kick: sourceOnsets(kick, 22050), snare: sourceOnsets(snare, 22050),
		hat: sourceOnsets(hat, 22050), cymbal: sourceOnsets(cymbal, 22050)
	},
	stemActivations: readF32(join(dir, files.adtofDrums)),
	sourceActivations: {
		kick: readF32(join(dir, files.adtofKick)), snare: readF32(join(dir, files.adtofSnare)),
		hat: readF32(join(dir, files.adtofHat)), cymbal: readF32(join(dir, files.adtofCymbal))
	},
	striker: model, probe
});

const FROM_MIX = STRIKER_FEATURES.indexOf('fromMix');
// The proposal flags are contiguous from fromMix; count them all so a new stream shows up here.
const VIEWS = ['mix', 'stem', 'attk', 'src', 'odf'] as const;
const period = beats.beats.length > 1
	? (beats.beats[beats.beats.length - 1] - beats.beats[0]) / (beats.beats.length - 1) : 0.5;
console.log(`${trackKey(track)}  ${decoded.duration.toFixed(1)} s, ${(60 / period).toFixed(1)} bpm, `
	+ `${beats.beats.filter((t) => t >= from && t < to).length} beats in view`);
console.log(`class   cand ${VIEWS.map((v) => v.padStart(4)).join('')}   p>=.5  p>=thr  thr    labels  no candidate`);

for (const [kind, candidates] of Object.entries(probe.striker!.candidates!)) {
	const inside = candidates.times.map((t, i) => ({ t, i })).filter(({ t }) => t >= from && t < to);
	const probabilities = model ? strikerProbabilities(model, kind, candidates) : new Float64Array(candidates.times.length);
	const threshold = model?.classes[kind]?.threshold ?? 1;
	const width = STRIKER_FEATURES.length;
	const views = VIEWS.map(() => 0);
	for (const { i } of inside) {
		for (let v = 0; v < VIEWS.length; v++) views[v] += candidates.features[i * width + FROM_MIX + v];
	}
	const above = inside.filter(({ i }) => probabilities[i] >= 0.5).length;
	const accepted = inside.filter(({ i }) => probabilities[i] >= threshold).length;
	let missing = '';
	if (track.labeled !== false) {
		// Required references only: optional ones are articulations and unreviewed stretches, which
		// a detector is free to answer or ignore, so counting them as misses says nothing.
		const refs = referenceTimes(track, kind as DrumClass, false).filter((t) => t >= from && t < to);
		const pairs = matchEvents(refs, inside.map(({ t }) => t), 0.05);
		missing = `${refs.length}  ${refs.filter((_, i) => pairs[i] < 0).length}`;
	}
	console.log(`${kind.padEnd(7)} ${String(inside.length).padStart(4)} `
		+ views.map((v) => String(v).padStart(4)).join('')
		+ `${String(above).padStart(8)}${String(accepted).padStart(8)}  ${threshold.toFixed(2)}  ${missing}`);
	const sorted = inside.map(({ i }) => probabilities[i]).sort((a, b) => b - a);
	const at = (q: number) => (sorted[Math.floor(q * (sorted.length - 1))] ?? 0).toFixed(3);
	console.log(`        probabilities: max ${at(0)}  p90 ${at(0.1)}  p75 ${at(0.25)}  median ${at(0.5)}`);
}
