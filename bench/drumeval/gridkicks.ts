// node bench/drumeval/gridkicks.ts [--corpus=library] [--genres=bass,techno,trance,edm,house] [--seconds=90]
// Kick labels for four-on-the-floor tracks, taken from the beat grid rather than from a person.
//
// In hardstyle, hard techno, house and trance the kick is on every beat. Which band shows it is
// not fixed: a house kick rises in 80 to 200 Hz, a hard techno kick in 30 to 80, and a hardstyle
// kick only in 500 to 1500, because its sub rings through the whole beat and is in fact louder
// between the beats than on them. So the band is chosen per track, as the one where this track's
// grid stands furthest above its own off-grid moments. Where that holds across a whole phrase the
// label is as good as hand annotation, and it is real audio from the music the product plays,
// which is exactly what the classifier has never been trained on. What the rule cannot vouch for
// is marked
// `unreviewed`, so it is neither taught nor counted: the other classes entirely, and any strong
// low attack that does not sit on a beat, which could be a kick the grid misses.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tracks, type DrumEvent } from './corpus.ts';
import { EVAL_ROOT, evidenceDir, files, readJson, type AudioRecord, type BeatsRecord } from './evidence.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const corpusName = flag('corpus') ?? 'library';
const genres = (flag('genres') ?? 'bass,techno,trance,edm,house,disco').split(',');
const seconds = Number(flag('seconds') ?? 90);
const OUT = join(EVAL_ROOT, '..', '..', 'corpus', 'grid');
const SRC = join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src');
const RATE = 44100;
/** The phrase a rule has to hold across before any of it is believed. */
const RUN_BEATS = 16;
const RUN_SHARE = 0.85;
/** A track that does not play this way at least this often is not four on the floor. */
const TRACK_SHARE = 0.55;
/** How far above the track's own off-grid attacks a beat has to stand, in dB. Limiting flattens
 * the low band in a modern master, so this is a small number measured against that track, not an
 * absolute level. */
const MARGIN_DB = 1.5;
const CLASSES = ['kick', 'snare', 'hat', 'cymbal'] as const;
const FILLER_S = 0.02;

const { decodeAudio } = await import(pathToFileURL(join(SRC, 'decode.ts')).href);
const { RealFft, hannWindow } = await import(pathToFileURL(join(SRC, 'dsp', 'fft.ts')).href);

const FFT = 1024;
const HOP = 128;

const EDGES = [30, 80, 200, 500, 1500, 4000, 8000, 16000];
/** Only bands a kick can live in are allowed to choose the grid. Above this the rule starts
 * following the hi-hat, which is on every beat in music whose kick is not. */
const KICK_BANDS = 4;

/** One rise curve per band: dB above the tenth of a second before, per frame. */
function bandRises(mono: Float32Array, rate: number): { curves: Float32Array[]; fps: number } {
	const fft = new RealFft(FFT);
	const window = hannWindow(FFT);
	const mags = new Float32Array(fft.bins);
	const frames = Math.max(1, Math.ceil(mono.length / HOP));
	const bands = EDGES.length - 1;
	const edge = EDGES.map((hz) => Math.min(fft.bins - 1, Math.round((hz * FFT) / rate)));
	const energy = Array.from({ length: bands }, () => new Float32Array(frames));
	for (let f = 0; f < frames; f++) {
		fft.magnitudes(mono, f * HOP - (FFT >> 1), window, mags, 2 / FFT);
		for (let b = 0; b < bands; b++) {
			let acc = 0;
			for (let k = edge[b]; k < Math.max(edge[b] + 1, edge[b + 1]); k++) acc += mags[k] * mags[k];
			energy[b][f] = Math.sqrt(acc);
		}
	}
	const fps = rate / HOP;
	const back = Math.max(1, Math.round(0.1 * fps));
	const curves = energy.map((band) => {
		const curve = new Float32Array(frames);
		for (let f = 0; f < frames; f++) {
			let quiet = 0;
			let n = 0;
			for (let i = Math.max(0, f - back); i < f; i++, n++) quiet += band[i];
			quiet = n ? quiet / n : 1e-6;
			curve[f] = 20 * Math.log10(Math.max(1e-6, band[f]) / Math.max(1e-6, quiet));
		}
		return curve;
	});
	return { curves, fps };
}

const peak = (curve: Float32Array, fps: number, time: number, radius = 0.03) => {
	let m = -120;
	const to = Math.min(curve.length - 1, Math.round((time + radius) * fps));
	for (let i = Math.max(0, Math.round((time - radius) * fps)); i <= to; i++) if (curve[i] > m) m = curve[i];
	return m;
};

mkdirSync(join(OUT, 'audio'), { recursive: true });
const out: unknown[] = [];
let labelled = 0;
for (const track of tracks([corpusName])) {
	if (!genres.includes(track.genre ?? '')) continue;
	const dir = evidenceDir(track);
	const beats = readJson<BeatsRecord>(join(dir, files.beats))?.beats;
	const audio = readJson<AudioRecord>(join(dir, files.audio));
	if (!beats || beats.length < 64 || !audio) continue;
	const decoded = await decodeAudio(track.audio, RATE);
	if (decoded.hash !== audio.hash44) continue;
	const start = Math.min(30, Math.max(0, decoded.duration - seconds - 1));
	const end = Math.min(decoded.duration, start + seconds);
	const inside = beats.filter((t) => t >= start && t < end);
	if (inside.length < 64) continue;

	const { curves, fps } = bandRises(decoded.mono, RATE);
	// A beat tracker that locked an octave high puts a kick on every other beat, so both the grid
	// and the band are chosen as whichever pair this track's kick actually follows.
	const options = [inside, inside.filter((_, i) => i % 2 === 0), inside.filter((_, i) => i % 2 === 1)];
	let grid = inside;
	let strong: boolean[] = [];
	let floor = 0;
	let share = 0;
	let chosen = 0;
	for (const option of options) {
		if (option.length < 48) continue;
		for (let b = 0; b < KICK_BANDS; b++) {
			const curve = curves[b];
			const rises = option.map((t) => peak(curve, fps, t));
			const between: number[] = [];
			for (let i = 1; i < option.length; i++) between.push(peak(curve, fps, (option[i - 1] + option[i]) / 2));
			between.sort((a, b) => a - b);
			const level = Math.max(between[Math.floor(between.length * 0.9)] ?? 0,
				(between[between.length >> 1] ?? 0) + MARGIN_DB);
			const hits = rises.map((r) => r >= level);
			const got = hits.filter(Boolean).length / hits.length;
			if (got > share) {
				share = got;
				grid = option;
				strong = hits;
				floor = level;
				chosen = b;
			}
		}
	}
	if (share < TRACK_SHARE) {
		console.log(`skip ${track.name.padEnd(13)} ${(track.genre ?? '').padEnd(7)} `
			+ `${(100 * share).toFixed(0)}% of beats clear ${floor.toFixed(1)} dB in ${EDGES[chosen]} Hz`);
		continue;
	}
	const curve = curves[chosen];

	// Keep only phrases where the pattern actually holds.
	const keep = new Array<boolean>(grid.length).fill(false);
	for (let i = 0; i + RUN_BEATS <= grid.length; i++) {
		let hits = 0;
		for (let k = i; k < i + RUN_BEATS; k++) if (strong[k]) hits++;
		if (hits / RUN_BEATS >= RUN_SHARE) for (let k = i; k < i + RUN_BEATS; k++) keep[k] = strong[k];
	}
	const kicks = grid.filter((_, i) => keep[i]).map((t) => +(t - start).toFixed(4));
	if (kicks.length < 48) continue;

	const events: DrumEvent[] = kicks.map((time) => ({ time, cls: 'kick' as const }));
	// A strong low attack away from the grid may be a kick the grid missed, so it is unjudged.
	for (let f = 0; f < curve.length; f++) {
		const t = f / fps;
		if (t < start || t >= end || curve[f] < floor) continue;
		if (f > 0 && curve[f - 1] >= curve[f]) continue;
		const at = +(t - start).toFixed(4);
		if (kicks.some((k) => Math.abs(k - at) < 0.06)) continue;
		events.push({ time: at, cls: 'kick', sub: 'unreviewed', optional: true });
	}
	// Nothing here says anything about the other classes.
	for (let t = 0; t < end - start; t += FILLER_S) {
		for (const cls of CLASSES) {
			if (cls !== 'kick') events.push({ time: +t.toFixed(4), cls, sub: 'unreviewed', optional: true });
		}
	}
	events.sort((a, b) => a.time - b.time);

	const from = Math.round(start * RATE);
	const to = Math.round(end * RATE);
	const length = to - from;
	const body = Buffer.alloc(length * 4);
	for (let i = 0; i < length; i++) {
		body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, decoded.left[from + i])) * 32767), i * 4);
		body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, decoded.right[from + i])) * 32767), i * 4 + 2);
	}
	const head = Buffer.alloc(44);
	head.write('RIFF', 0);
	head.writeUInt32LE(36 + body.length, 4);
	head.write('WAVEfmt ', 8);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(2, 22);
	head.writeUInt32LE(RATE, 24);
	head.writeUInt32LE(RATE * 4, 28);
	head.writeUInt16LE(4, 32);
	head.writeUInt16LE(16, 34);
	head.write('data', 36);
	head.writeUInt32LE(body.length, 40);
	writeFileSync(join(OUT, 'audio', `${track.name}.wav`), Buffer.concat([head, body]));
	out.push({ name: track.name, audio: `audio/${track.name}.wav`, genre: track.genre ?? '', events });
	labelled += kicks.length;
	console.log(`${track.name.padEnd(13)} ${track.genre?.padEnd(7)} ${kicks.length} kicks of ${inside.length} beats`
		+ ` (${(100 * kicks.length / grid.length).toFixed(0)}%) from ${EDGES[chosen]} to ${EDGES[chosen + 1]} Hz`);
}

writeFileSync(join(OUT, 'tracks.json'), JSON.stringify({
	corpus: 'grid', labeled: true, classes: ['kick'],
	source: 'bench/drumeval/gridkicks.ts, four on the floor kicks read off the beat grid',
	tracks: out
}));
console.log(`\n${out.length} tracks, ${labelled} kicks -> ${OUT}`);
