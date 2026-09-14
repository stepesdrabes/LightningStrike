// node bench/drumeval/judge/build.ts --a=LABEL --b=LABEL --kinds=kick,snare,hat --out=DIR [--corpus=library]
//   [--count=12] (per kind) [--seconds=16] [--per-track=2] [--min-level=0.05] [--title=...] [--prompt=...]
// Builds a blind A/B listening session from the passages where two evaluation runs disagree most.
// Clips are cut from the same 44.1 kHz decode the analysis times refer to, so clicks stay aligned.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeAudio } from '../../../packages/analysis/src/decode.ts';
import { tracks, type Kind } from '../corpus.ts';
import { loadRun } from '../evaluate.ts';
import { matchEvents } from '../score.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const labelA = flag('a')!;
const labelB = flag('b')!;
const kinds = (flag('kinds') ?? flag('kind') ?? 'kick').split(',') as Kind[];
const out = resolve(flag('out')!);
const count = Number(flag('count') ?? 12);
const seconds = Number(flag('seconds') ?? 16);
const perTrack = Number(flag('per-track') ?? 2);
const minLevel = Number(flag('min-level') ?? 0.05);
const corpus = tracks(flag('corpus')?.split(',') ?? ['library']);
const runA = loadRun(labelA);
const runB = loadRun(labelB);

interface Candidate { key: string; kind: Kind; start: number; end: number; differences: number; events: Record<'a' | 'b', [number, number][]> }

const picked: Candidate[] = [];
for (const kind of kinds) {
	const candidates: Candidate[] = [];
	for (const track of corpus) {
		const key = `${track.corpus}/${track.name}`;
		const ra = runA.find((r) => `${r.corpus}/${r.name}` === key);
		const rb = runB.find((r) => `${r.corpus}/${r.name}` === key);
		if (!ra || !rb) continue;
		const pick = (s: { times: number[]; levels: number[] }) =>
			s.times.map((t, i) => [t, s.levels[i]] as [number, number]).filter(([, l]) => l >= minLevel);
		const ea = pick(ra.final[kind]);
		const eb = pick(rb.final[kind]);
		const pairs = matchEvents(ea.map((e) => e[0]), eb.map((e) => e[0]), 0.05);
		const matchedB = new Set(pairs);
		const differ = [...ea.filter((_, i) => pairs[i] < 0), ...eb.filter((_, j) => !matchedB.has(j))].map((e) => e[0]).sort((x, y) => x - y);
		const chosen: Candidate[] = [];
		// Greedy windows around the densest disagreement, never overlapping within a track.
		const remaining = [...differ];
		while (chosen.length < perTrack && remaining.length) {
			let best = { start: 0, n: 0 };
			for (const t of remaining) {
				const start = Math.max(0, Math.min(ra.duration - seconds, t - seconds * 0.3));
				const n = remaining.filter((x) => x >= start + 0.5 && x <= start + seconds - 0.5).length;
				if (n > best.n) best = { start, n };
			}
			if (best.n === 0) break;
			const start = best.start;
			const end = Math.min(ra.duration, start + seconds);
			if (!chosen.some((c) => start < c.end && end > c.start)) {
				chosen.push({ key, kind, start, end, differences: best.n,
					events: { a: ea.filter(([t]) => t >= start && t <= end), b: eb.filter(([t]) => t >= start && t <= end) } });
			}
			for (let i = remaining.length - 1; i >= 0; i--) if (remaining[i] >= start && remaining[i] <= end) remaining.splice(i, 1);
		}
		candidates.push(...chosen);
	}
	candidates.sort((x, y) => y.differences - x.differences);
	picked.push(...candidates.slice(0, count).sort((x, y) => x.key.localeCompare(y.key) || x.start - y.start));
}

mkdirSync(join(out, 'clips'), { recursive: true });
const questions = [];
for (const [n, c] of picked.entries()) {
	const track = corpus.find((t) => `${t.corpus}/${t.name}` === c.key)!;
	const wide = await decodeAudio(track.audio, 44100);
	const from = Math.round(c.start * 44100);
	const to = Math.min(wide.left.length, Math.round(c.end * 44100));
	const frames = to - from;
	const wav = Buffer.alloc(44 + frames * 4);
	wav.write('RIFF', 0); wav.writeUInt32LE(36 + frames * 4, 4); wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(44100, 24);
	wav.writeUInt32LE(44100 * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
	wav.writeUInt32LE(frames * 4, 40);
	for (let i = 0; i < frames; i++) {
		wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(wide.left[from + i] * 32767))), 44 + i * 4);
		wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(wide.right[from + i] * 32767))), 46 + i * 4);
	}
	const id = `q${String(n + 1).padStart(2, '0')}`;
	writeFileSync(join(out, 'clips', `${id}.wav`), wav);
	// Blind order, stable for a given session: which run plays as A is hidden from the listener.
	const swap = createHash('sha256').update(`${c.key}:${c.kind}:${c.start}:${labelA}:${labelB}`).digest()[0] % 2 === 1;
	const [left, right] = swap ? [c.events.b, c.events.a] : [c.events.a, c.events.b];
	const rel = (events: [number, number][]) => events.map(([t]) => +(t - c.start).toFixed(4));
	const pairs = matchEvents(rel(left), rel(right), 0.05);
	const matched = new Set(pairs);
	questions.push({
		id, track: c.key, title: `${(track as { title?: string }).title ?? track.name}`, kind: c.kind, clip: `clips/${id}.wav`,
		start: c.start, end: c.end, events: { A: rel(left), B: rel(right) },
		levels: { A: left.map(([, l]) => l), B: right.map(([, l]) => l) },
		only: { A: [...pairs].flatMap((j, i) => (j < 0 ? [i] : [])), B: right.flatMap((_, j) => (matched.has(j) ? [] : [j])) },
		hidden: swap ? { A: labelB, B: labelA } : { A: labelA, B: labelB }
	});
}
const session = {
	title: flag('title') ?? 'Which clicks follow the drums?',
	prompt: flag('prompt') ?? 'Each passage plays with clicks from two detectors, A and B, for the drum named beside the title. '
		+ 'Pick the side whose clicks match what you hear, and mark the highlighted clicks only one side has.',
	created: new Date().toISOString(), kinds, runs: [labelA, labelB], questions
};
writeFileSync(join(out, 'session.json'), JSON.stringify(session, null, '\t'));
console.log(`${questions.length} questions in ${out}`);
