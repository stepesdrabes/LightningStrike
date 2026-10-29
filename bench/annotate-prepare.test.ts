import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeAudio } from '../packages/analysis/src/decode.ts';
import {
	Striker2, readStriker2, type Striker2Model, type Striker2Result
} from '../packages/analysis/src/striker2.ts';
import {
	STRIKER2_CLASSES, coarseHits, type PeakRule, type Striker2Class
} from '../packages/analysis/src/striker2Decode.ts';
import { CPU, providerSession } from '../packages/analysis/src/striker2Provider.ts';
import { readClipList } from './annotate/cliplist.ts';
import {
	FLOOR, alignedSeconds, cutClip, proposals, relative, wav16, type ByClass, type Hearing
} from './annotate/cut.ts';
import { BANDS, bandOf, nearestProposal } from './annotate/dsp.js';
import { groove } from './annotate/groove.ts';
import { proposalState, startingHits } from './annotate/marks.js';
import { buildPages } from './annotate/pages.js';
import { listen, type DrumHeads } from './hearing.ts';

const RATE = 44100;
const FIXTURE = join(import.meta.dirname, '..', 'packages', 'analysis', 'src', 'testdata', 'striker2');
const C = STRIKER2_CLASSES.length;
const meta = {
	id: 'x', corpus: 'file', track: 'x.wav', title: 'x', artist: '', genre: '', tags: [], source: 'x.wav'
};

/** The samples of a 16-bit mono WAV that wav16 wrote. */
function samples(wav: Buffer): Float32Array {
	return Float32Array.from({ length: (wav.length - 44) / 2 }, (_, i) => wav.readInt16LE(44 + 2 * i) / 32767);
}

const firstAbove = (x: Float32Array, level: number) => x.findIndex((v) => Math.abs(v) > level);

describe('a clip cut from a whole song', () => {
	// 20 s of silence with a click at each hit, and drum heads that put each hit there exactly:
	// a peak frame with the offset that lands on the hit's millisecond.
	const hits = {
		kick: [3.457, 5, 7.25, 12.346], snare: [4, 6.123], hat: [3.6, 3.71], cymbal: [], tom: [9.999]
	};
	const rules = Object.fromEntries(STRIKER2_CLASSES.map((cls) =>
		[cls, { threshold: cls === 'kick' ? 0.8 : 0.9, gap: 2, reach: 2.5 }])) as ByClass<PeakRule>;
	const mono = new Float32Array(20 * RATE);
	const frames = 1 + Math.floor(mono.length / 441);
	const heads: DrumHeads = {
		frames, onset: new Float32Array(frames * C).fill(-12), offset: new Float32Array(frames * C)
	};
	const put = (cls: string, t: number, logit: number) => {
		const c = STRIKER2_CLASSES.indexOf(cls as Striker2Class);
		const f = Math.floor(t * 100 + 1e-9);
		heads.onset[f * C + c] = logit;
		heads.offset[f * C + c] = t * 100 - f;
	};
	for (const [cls, times] of Object.entries(hits)) {
		for (const t of times) {
			put(cls, t, 6);
			mono[Math.round(t * RATE)] = 0.5;
		}
	}
	// Two hats Striker misses at 0.27, and a snare below the floor.
	put('hat', 3.9, -1);
	put('hat', 8.8, -1);
	put('snare', 10.5, -4.5);
	const heard = {
		name: 'test', drums: coarseHits({ ...heads, level: heads.onset, width: C }, 0, rules, 0.02),
		beats: Array.from({ length: 40 }, (_, i) => i / 2),
		downbeats: Array.from({ length: 10 }, (_, i) => 2 * i)
	} as unknown as Striker2Result;
	const hearing: Hearing = { model: { name: 'test', drums: { rules } }, heard, heads };
	const found = proposals(heads, rules);
	const cut = (start: number, seconds: number, prefill = true) => cutClip({
		meta, mono, rate: RATE, hearing, found, start, seconds, floor: FLOOR, support: 0.3, prefill
	});
	const start = 3.337;
	const { clip, mix } = cut(start, 10);
	const audio = samples(wav16([mix], RATE));

	it('times the grid, the hits and the proposals from the start', () => {
		expect(clip.seconds).toBe(10);
		expect(clip.beats).toEqual(heard.beats.filter((t) => t >= start && t < start + 10)
			.map((t) => +(t - start).toFixed(4)));
		expect(clip.downbeats).toEqual([0.663, 2.663, 4.663, 6.663, 8.663]);
		expect(clip.striker.kick).toEqual([0.12, 1.663, 3.913, 9.009]);
		expect(clip.striker.tom).toEqual([6.662]);
		expect(clip.striker.hat).toEqual([0.263, 0.373]);
		expect(clip.proposals.hat).toEqual([
			{ t: 0.263, score: 1 }, { t: 0.373, score: 1 }, { t: 0.563, score: 0.27 }, { t: 5.463, score: 0.27 }
		]);
		expect(clip.proposals.snare.map((p) => p.t)).toEqual([0.663, 2.786]);
	});

	it('puts each hit where the cut audio has it, to a sample', () => {
		// The cut starts on sample 147162, 0.3 samples after 3.337 s.
		for (const cls of STRIKER2_CLASSES) {
			for (const t of clip.striker[cls]) {
				const at = Math.round(t * RATE);
				const click = firstAbove(audio.subarray(at - 3, at + 4), 0.25);
				expect([2, 3, 4], `${cls} ${t}`).toContain(click);
			}
		}
		expect(audio.length).toBe(10 * RATE);
		expect(audio[Math.round((5 - start) * RATE)]).toBeCloseTo(0.5, 4);
	});

	it('draws each probability curve on the clip clock', () => {
		const { from, fps, values } = clip.curves;
		expect([from, fps, values.kick.length]).toEqual([0.003, 100, 1000]);
		for (const cls of STRIKER2_CLASSES) {
			for (const t of clip.striker[cls]) {
				const k = values[cls].findIndex((p, i) => p > 0.9 && Math.abs(from + i / fps - t) < 0.0105);
				expect(k, `${cls} ${t}`).toBeGreaterThanOrEqual(0);
			}
		}
		expect(values.hat[Math.round((3.9 - start - from) * fps)]).toBeCloseTo(0.269, 3);
	});

	it('starts a library review from Striker\'s hits and a validation review empty', () => {
		expect(clip.prefill).toBe(true);
		expect(startingHits(clip, clip.classes)).toEqual(clip.striker);
		const empty = cut(start, 10, false).clip;
		expect(empty.prefill).toBe(false);
		const marks = startingHits(empty, empty.classes);
		expect(Object.values(marks).flat()).toEqual([]);
		// With nothing marked, each of Striker's hits is an open ring and the weak hats too.
		for (const cls of STRIKER2_CLASSES) {
			for (const p of empty.proposals[cls]) {
				const want = p.score >= empty.support ? 'ring' : 'tick';
				expect(proposalState(p, marks[cls], empty.support), `${cls} ${p.t}`).toBe(want);
			}
			for (const t of empty.striker[cls]) {
				const p = empty.proposals[cls].find((q) => q.t === t)!;
				expect(proposalState(p, marks[cls], empty.support)).toBe('ring');
			}
		}
		expect(empty.proposals.hat.map((p) => proposalState(p, [], 0.1)))
			.toEqual(['ring', 'ring', 'ring', 'ring']);
	});

	it('cuts short where the song ends', () => {
		const end = cut(15, 30).clip;
		expect(end.seconds).toBe(5);
		expect(end.curves.values.kick.length).toBe(500);
		expect(Math.max(...end.beats)).toBe(4.5);
	});
});

describe('proposals from Striker 2.0', () => {
	let model: Striker2Model;
	let striker: Striker2;
	beforeAll(async () => {
		model = await readStriker2(FIXTURE);
		striker = await Striker2.create(model, { session: providerSession(CPU) });
	});
	afterAll(async () => {
		await striker?.close();
	});

	function fixtureAudio(): Float32Array {
		const buf = readFileSync(join(FIXTURE, 'audio.s16'));
		return Float32Array.from({ length: buf.length / 2 }, (_, i) => buf.readInt16LE(2 * i) / 32768);
	}

	it('include every hit Striker emits, at its time, and grow as the floor falls', async () => {
		const audio = fixtureAudio();
		const { heard, heads } = await listen(striker, model, audio);
		expect(heard).toEqual(await striker.run(audio));
		const found = proposals(heads, model.drums.rules);
		const lower = proposals(heads, model.drums.rules, 0.01);
		for (const cls of STRIKER2_CLASSES) {
			const times = found[cls].map((p) => p.t);
			for (const t of heard.drums[cls].times) {
				const p = found[cls][times.indexOf(t)];
				expect(p, `${cls} ${t}`).toBeDefined();
				expect(p.score).toBeGreaterThanOrEqual(model.drums.rules[cls].threshold - 0.005);
			}
			expect(found[cls].every((p) => p.score >= FLOOR)).toBe(true);
			const all = lower[cls].map((p) => p.t);
			expect(times.every((t) => all.includes(t)), cls).toBe(true);
		}
		const count = (of: (cls: Striker2Class) => number) => STRIKER2_CLASSES.reduce((n, cls) => n + of(cls), 0);
		const emitted = count((cls) => heard.drums[cls].times.length);
		expect(emitted).toBeGreaterThan(50);
		expect(count((cls) => found[cls].length)).toBeGreaterThan(emitted);
	});

	it('cut a listed file where the list says, through ffmpeg', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'annotate-'));
		try {
			const song = groove(10);
			await writeFile(join(dir, 'groove.wav'), wav16([song.mono], song.rate));
			await writeFile(join(dir, 'clips.json'), JSON.stringify([
				{ file: 'groove.wav', start: 2.5, tags: ['jazz', 'heldOut'] }
			]));
			const [entry] = readClipList(join(dir, 'clips.json'));
			expect(entry).toMatchObject({
				id: 'groove__2.5s', file: join(dir, 'groove.wav'), start: 2.5, genre: 'jazz', prefill: false
			});
			const wide = await decodeAudio(entry.file, RATE);
			expect(wide.mono.length).toBe(song.mono.length);
			const { heard, heads } = await listen(striker, model, wide.mono);
			const { clip, mix } = cutClip({
				meta: { ...meta, id: entry.id }, mono: wide.mono, rate: RATE, hearing: { model, heard, heads },
				found: proposals(heads, model.drums.rules), start: entry.start, seconds: 6, floor: FLOOR,
				support: 0.3, prefill: entry.prefill
			});
			expect(Object.values(startingHits(clip, clip.classes)).flat()).toEqual([]);
			expect(clip.striker.kick.length).toBeGreaterThan(0);
			const audio = samples(wav16([mix], RATE));
			for (const t of relative(song.hits.kick, entry.start, clip.seconds)) {
				const at = Math.round(t * RATE);
				expect(firstAbove(audio.subarray(at - 2, at + 200), 1e-4), `kick ${t}`).toBe(2);
			}
			for (const cls of STRIKER2_CLASSES) {
				expect(clip.striker[cls]).toEqual(relative(heard.drums[cls].times, 2.5, 6));
			}
			expect(clip.downbeats).toEqual(relative(heard.downbeats, 2.5, 6));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('a page-aligned clip', () => {
	// Downbeats every 2 s from 1.3 s: from 0.5 s the pages are [0, 2.8), [2.8, 6.8), ...
	const downbeats = Array.from({ length: 40 }, (_, i) => 1.3 + 2 * i);
	type Page = { from: number; to: number };

	it('ends on the page end nearest the length asked for, in whole two-bar pages', () => {
		const cases = [[0.5, 30, 30.8], [0.5, 28.7, 26.8], [5.3, 30.5, 32], [1.3, 7, 8]];
		for (const [start, wanted, want] of cases) {
			const seconds = alignedSeconds(downbeats, start, wanted, 100);
			expect(seconds, `${start} ${wanted}`).toBe(want);
			const clip = { downbeats: relative(downbeats, start, seconds), seconds };
			const pages = buildPages(clip) as Page[];
			expect(pages.at(-1)?.to).toBe(seconds);
			const bars = (p: Page) => clip.downbeats.filter((d) => d > p.from && d < p.to).length;
			const whole = (p: Page) => bars(p) === 1 && Math.abs(p.to - p.from - 4) < 1e-9;
			expect(pages.slice(1).every(whole), `${start} ${wanted}`).toBe(true);
		}
	});

	it('keeps the length asked for when there are too few downbeats to page by', () => {
		expect(alignedSeconds([40], 0.5, 30, 100)).toBe(30);
		expect(alignedSeconds(downbeats, 70, 30, 75)).toBe(5);
	});
});

describe('the lanes of a Striker 2.0 clip', () => {
	it('band the mix without moving an attack', () => {
		const x = new Float32Array(RATE);
		x[22050] = 1;
		for (const [cls, band] of Object.entries(BANDS)) {
			const y = bandOf(x, RATE, band as [number, number]);
			let peak = 0;
			for (let i = 1; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[peak])) peak = i;
			expect(peak, cls).toBe(22050);
			for (const k of [1, 7, 50, 400]) {
				expect(y[22050 + k], `${cls} ${k}`).toBeCloseTo(y[22050 - k], 5);
			}
		}
	});

	it('snap to the nearest proposal within 35 ms, or to none', () => {
		const list = [{ t: 1 }, { t: 1.03 }, { t: 1.2 }];
		expect(nearestProposal(list, 1.016)).toBe(1.03);
		expect(nearestProposal(list, 1.014)).toBe(1);
		expect(nearestProposal(list, 1.11)).toBeNull();
		expect(nearestProposal([], 1)).toBeNull();
	});
});
