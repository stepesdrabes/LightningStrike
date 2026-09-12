/**
 * node bench/transitionprobe.ts [--cache DIR] [--ids A,B,C] [--core DIR] [--out FILE]
 *   [--compare FILE]
 *
 * Frame-to-frame byte deltas across every transition the room makes: track to track, a queue
 * jump, pause and resume, seeks, lounge on and off, the dissolve into rest and the wake,
 * hardware clock jitter and a stale sync, cue boundaries and a scene handover at rest. Each
 * case reports the worst single-frame move (mean absolute byte change over the fixture) and,
 * where a second room can play the same positions without the transition, the worst move in
 * excess of the show's own; spikes count the frames whose excess (or move, where there is no
 * reference) exceeds what a dissolve can produce. `--core` renders with another checkout's
 * core source so a change can be compared before and after; `--compare` prints both side by
 * side.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RoomDirector, Show, TrackAnalysis } from '@mv/core';
import { benchmarkCache } from './cache.ts';

const args = process.argv.slice(2);
const option = (flag: string): string | undefined => {
	const i = args.indexOf(flag);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const cache = benchmarkCache(option('--cache'));
const ids = (option('--ids') ?? '9vWNauaZAgg,bEgS_KJCxTU,B2mmDEv0OEk').split(',');
const coreDir = resolve(option('--core') ?? join(import.meta.dirname, '..', 'packages', 'core', 'src'));
const out = option('--out');
const compare = option('--compare');

type Core = typeof import('@mv/core');
const core = (await import(pathToFileURL(join(coreDir, 'index.ts')).href)) as Core;
const g = core.buildGeometry(core.DEFAULT_ROOM);

const DT = 1 / 60;
const PLAYING = { playing: true, hasShow: true, lounge: false, rest: true };
const STOPPED = { playing: false, hasShow: true, lounge: false, rest: true };
const LOUNGE = { playing: true, hasShow: true, lounge: true, rest: true };
const NO_SHOW = { playing: false, hasShow: false, lounge: false, rest: true };

/** A move a dissolve cannot make in one frame, in mean bytes over the fixture. */
const SPIKE = 4;

interface Track {
	id: string;
	analysis: TrackAnalysis;
	show: Show;
	/** Where the audio really stops, by the level track. */
	audioEnd: number;
	/** The first drop-class section, or 30 s in. */
	drop: number;
	/** A calm passage after the drop to seek into: the next breakdown, verse or outro. */
	calm: number;
}

function loadTrack(id: string): Track | null {
	const a = join(cache, `${id}.analysis.json`);
	const s = join(cache, `${id}.show.json`);
	if (!existsSync(a) || !existsSync(s)) return null;
	const analysis = JSON.parse(readFileSync(a, 'utf8')) as TrackAnalysis;
	const show = JSON.parse(readFileSync(s, 'utf8')) as Show;
	let audioEnd = analysis.duration;
	if (analysis.level?.data) {
		const level = core.decodeBase64(analysis.level.data);
		let last = level.length - 1;
		while (last > 0 && level[last] <= 6) last--;
		audioEnd = Math.min(analysis.duration, (last + 1) / analysis.level.fps);
	}
	const drop = analysis.sections.find((x) => core.sectionBase(x.kind) === 'drop')?.startTime ?? 30;
	const calm =
		analysis.sections.find(
			(x) => x.startTime > drop + 8 && ['breakdown', 'verse', 'groove', 'outro'].includes(x.kind)
		)?.startTime ?? Math.min(drop + 30, analysis.duration - 10);
	return { id, analysis, show, audioEnd, drop, calm };
}

const registries = new WeakMap<RoomDirector, InstanceType<Core['EffectRegistry']>>();

function director(): RoomDirector {
	const registry = new core.EffectRegistry();
	const d = new core.RoomDirector(g, registry);
	registries.set(d, registry);
	return d;
}

/** Generated effects live in the registry the director was built with, as in the app. */
function load(d: RoomDirector, track: Track): void {
	const registry = registries.get(d)!;
	registry.clearGenerated();
	for (const gen of track.show.generatedEffects) {
		const compiled = core.compileGenerated(gen, g);
		if (compiled.def) registry.add(compiled.def);
	}
	d.load(track.analysis, track.show);
}

/** Mean absolute byte change between two frames: what a jump looks like on the wire. */
function delta(a: Uint8Array, b: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
	return sum / a.length;
}

/** Delivered light per pixel, all channels. */
function light(bytes: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < bytes.length; i++) sum += bytes[i];
	return sum / (bytes.length / 3);
}

interface Window {
	worst: number;
	/** The worst move beyond the reference room's own, or null without a reference. */
	excess: number | null;
	darkest: number;
	brightest: number;
	spikes: number;
}

function window(): Window {
	return { worst: 0, excess: null, darkest: Infinity, brightest: 0, spikes: 0 };
}

class Walker {
	readonly d: RoomDirector;
	private prev: Uint8Array;
	/** The last move this room made, for a reference to subtract. */
	moved = 0;

	constructor(d: RoomDirector) {
		this.d = d;
		this.prev = Uint8Array.from(d.bytes);
	}

	/** Step frames, calling `at` for the position of each, and measure the window. */
	walk(frames: number, at: (i: number) => number, state: typeof PLAYING, ref?: Walker): Window {
		const w = window();
		for (let i = 0; i < frames; i++) {
			this.d.update(at(i), DT, state);
			if (ref) ref.d.update(at(i), DT, state);
			this.record(w, ref);
		}
		return w;
	}

	/** `against` is the reference room's own move, when a number rather than a walker. */
	record(w: Window, ref?: Walker | number): void {
		this.moved = delta(this.d.bytes, this.prev);
		this.prev = Uint8Array.from(this.d.bytes);
		w.worst = Math.max(w.worst, this.moved);
		let judged = this.moved;
		if (ref instanceof Walker) {
			ref.moved = delta(ref.d.bytes, ref.prev);
			ref.prev = Uint8Array.from(ref.d.bytes);
			ref = ref.moved;
		}
		if (typeof ref === 'number') {
			judged = Math.max(0, this.moved - ref);
			w.excess = Math.max(w.excess ?? 0, judged);
		}
		if (judged > SPIKE) w.spikes++;
		const lit = light(this.d.bytes);
		w.darkest = Math.min(w.darkest, lit);
		w.brightest = Math.max(w.brightest, lit);
	}
}

interface Result {
	name: string;
	track: string;
	/** The show's own worst single-frame move in ordinary playback nearby. */
	steady: number;
	worst: number;
	excess: number | null;
	spikes: number;
	darkest: number;
	brightest: number;
}

function summarise(name: string, track: string, steady: number, windows: Window[]): Result {
	const r: Result = {
		name,
		track,
		steady,
		worst: 0,
		excess: null,
		spikes: 0,
		darkest: Infinity,
		brightest: 0
	};
	for (const w of windows) {
		r.worst = Math.max(r.worst, w.worst);
		if (w.excess !== null) r.excess = Math.max(r.excess ?? 0, w.excess);
		r.spikes += w.spikes;
		r.darkest = Math.min(r.darkest, w.darkest);
		r.brightest = Math.max(r.brightest, w.brightest);
	}
	return r;
}

/** Settle at `from`, then measure two seconds of ordinary playback. */
function steadyAt(w: Walker, from: number): number {
	w.walk(60 * 3, (i) => from + i * DT, PLAYING);
	return w.walk(60 * 2, (i) => from + 3 + i * DT, PLAYING).worst;
}

/** A room playing the same track through `at` with no transition, settled two seconds before. */
function referenceAt(track: Track, at: number): Walker {
	const r = new Walker(director());
	load(r.d, track);
	const from = Math.max(0, at - 2);
	r.walk(Math.round((at - from) / DT), (i) => from + i * DT, PLAYING);
	return r;
}

const seek = (d: RoomDirector) => (d as unknown as { seek?: () => void }).seek?.();

function trackEnd(a: Track, b: Track): Result {
	const d = director();
	load(d, a);
	const w = new Walker(d);
	const end = a.analysis.duration;
	const steady = steadyAt(w, Math.max(0, a.audioEnd - 12));
	const windows = [
		w.walk(Math.round(60 * (end - a.audioEnd + 1.5)), (i) => a.audioEnd - 1.5 + i * DT, PLAYING),
		w.walk(60, () => end, STOPPED)
	];
	d.clearShow();
	windows.push(w.walk(20, () => end, NO_SHOW));
	load(d, b);
	windows.push(w.walk(60 * 4, (i) => i * DT, PLAYING, referenceAt(b, 0)));
	return summarise('track end into next', `${a.id} > ${b.id}`, steady, windows);
}

function queueJump(a: Track, b: Track): Result {
	const d = director();
	load(d, a);
	const w = new Walker(d);
	const steady = steadyAt(w, a.drop);
	const at = a.drop + 5;
	const windows = [w.walk(30, (i) => at + i * DT, PLAYING)];
	d.clearShow();
	windows.push(w.walk(20, () => at + 0.5, NO_SHOW));
	load(d, b);
	windows.push(w.walk(60 * 4, (i) => i * DT, PLAYING, referenceAt(b, 0)));
	return summarise('queue jump mid-song', `${a.id} > ${b.id}`, steady, windows);
}

function pauseResume(a: Track): Result {
	const d = director();
	load(d, a);
	const w = new Walker(d);
	const steady = steadyAt(w, a.drop);
	const at = a.drop + 5;
	const windows = [
		w.walk(60 * 2, () => at, STOPPED),
		w.walk(60 * 3, (i) => at + i * DT, PLAYING, referenceAt(a, at))
	];
	return summarise('pause and resume', a.id, steady, windows);
}

function seeks(a: Track): Result {
	const d = director();
	load(d, a);
	const w = new Walker(d);
	const steady = steadyAt(w, a.drop);
	seek(d);
	const windows = [w.walk(60 * 3, (i) => a.calm + i * DT, PLAYING, referenceAt(a, a.calm))];
	seek(d);
	const back = Math.max(0, a.drop - 15);
	windows.push(w.walk(60 * 3, (i) => back + i * DT, PLAYING, referenceAt(a, back)));
	return summarise('seek forward and back', a.id, steady, windows);
}

function loungeToggle(a: Track): Result {
	const d = director();
	load(d, a);
	const w = new Walker(d);
	const steady = steadyAt(w, a.drop);
	const at = a.drop + 5;
	const windows = [
		w.walk(60 * 8, (i) => at + i * DT, LOUNGE),
		w.walk(60 * 4, (i) => at + 8 + i * DT, PLAYING, referenceAt(a, at + 8))
	];
	return summarise('lounge on and off mid-song', a.id, steady, windows);
}

function restAndWake(a: Track): Result {
	const d = director();
	load(d, a);
	const w = new Walker(d);
	const steady = steadyAt(w, a.drop);
	const at = a.drop + 5;
	const windows = [
		w.walk(60 * 12, () => at, STOPPED),
		w.walk(60 * 3, (i) => at + i * DT, PLAYING, referenceAt(a, at))
	];
	return summarise('rest and wake', a.id, steady, windows);
}

/** The hardware renderer: fed positions twice a second, extrapolating in between. */
interface Remote {
	sync(position: number, playing: boolean, ms: number): void;
	read(ms: number): { t: number; playing: boolean; seek: boolean };
}

function remote(): Remote {
	const Clock = (core as { RemoteClock?: new (staleMs: number) => Remote }).RemoteClock;
	if (Clock) return new Clock(3000);
	// The renderer before the clock existed: snap to every sync and extrapolate from it.
	let position = 0;
	let playing = false;
	let syncedAt = Number.NaN;
	return {
		sync(p, on, ms) {
			position = p;
			playing = on;
			syncedAt = ms;
		},
		read(ms) {
			const sounding = playing && ms - syncedAt < 3000;
			return {
				t: sounding ? position + (ms - syncedAt) / 1000 : position,
				playing: sounding,
				seek: false
			};
		}
	};
}

function serverRun(
	a: Track,
	name: string,
	jitter: (k: number) => number,
	stale: [number, number] | null
): Result {
	const clean = new Walker(director());
	load(clean.d, a);
	const steady = steadyAt(clean, a.drop);

	const d = director();
	load(d, a);
	const w = new Walker(d);
	const clock = remote();
	const win = window();
	const from = a.drop;
	// The followed clock may sit a few frames off the true position, so a hit lands on a
	// neighbouring frame: judge against the clean room's busiest frame within two either way.
	const AHEAD = 2;
	const recent: number[] = [];
	let k = 0;
	for (let i = 0; i < 60 * 14 + AHEAD; i++) {
		const seconds = i / 60;
		clean.d.update(from + seconds, DT, PLAYING);
		clean.moved = delta(clean.d.bytes, clean.prev);
		clean.prev = Uint8Array.from(clean.d.bytes);
		recent.push(clean.moved);
		if (recent.length > 2 * AHEAD + 1) recent.shift();
		if (i < AHEAD) continue;

		const j = i - AHEAD;
		const ms = (j * 1000) / 60;
		const at = j / 60;
		const inStale = stale !== null && at >= stale[0] && at < stale[1];
		if (j % 30 === 0 && !inStale) {
			clock.sync(from + at + jitter(k), true, ms);
			k++;
		}
		const r = clock.read(ms);
		if (r.seek) seek(d);
		d.update(r.t, DT, { ...PLAYING, playing: r.playing });
		// Judge only after the opening settled, and never the stall itself: the stale room
		// holds still while the clean one plays on.
		const busiest = Math.max(...recent);
		if (at > 4 && !inStale) w.record(win, busiest);
		else w.record(window(), busiest);
	}
	return summarise(name, a.id, steady, [win]);
}

function cueBoundaries(a: Track): Result {
	const d = director();
	load(d, a);
	const w = new Walker(d);
	const steady = steadyAt(w, 0);
	const tempo = a.analysis.tempo;
	const starts = [...a.show.cues]
		.sort((x, y) => x.bar - y.bar)
		.map((c) => core.barTimeAt(tempo, c.bar))
		.filter((t) => t > 6 && t < 96);
	const win = window();
	for (let i = 0; i < 60 * 91; i++) {
		const t = 5 + i * DT;
		d.update(t, DT, PLAYING);
		if (starts.some((s) => Math.abs(s - t) < 0.12)) w.record(win);
		else w.record(window());
	}
	return summarise('cue boundaries', a.id, steady, [win]);
}

function restScenes(a: Track): Result {
	const d = director();
	load(d, a);
	d.ambientSettings = { ...core.DEFAULT_AMBIENT, dwell: 45 };
	const w = new Walker(d);
	const steady = steadyAt(w, a.drop);
	// Into rest, then a few scene handovers.
	w.walk(60 * 12, () => a.drop + 5, STOPPED);
	const win = w.walk(60 * 200, () => a.drop + 5, STOPPED);
	return summarise('scene handovers at rest', a.id, steady, [win]);
}

const tracks = ids.map(loadTrack).filter((t): t is Track => t !== null);
if (tracks.length === 0) {
	throw new Error(`no cached analysis and show for ${ids.join(', ')} in ${cache}`);
}

const results: Result[] = [];
for (let i = 0; i < tracks.length; i++) {
	const a = tracks[i];
	const b = tracks[(i + 1) % tracks.length];
	results.push(trackEnd(a, b));
	results.push(queueJump(a, b));
	results.push(pauseResume(a));
	results.push(seeks(a));
	results.push(loungeToggle(a));
	results.push(restAndWake(a));
	const jitter = [0.018, -0.02, 0.012, -0.016, 0.006, -0.011];
	results.push(serverRun(a, 'hardware clock jitter', (k) => jitter[k % jitter.length], null));
	results.push(serverRun(a, 'hardware stale sync', () => 0, [5, 9]));
	results.push(cueBoundaries(a));
	results.push(restScenes(a));
	console.error(`${a.id}: done`);
}

const num = (v: number | null, digits: number) => (v === null ? '-' : v.toFixed(digits));

function table(rows: Result[], before?: Result[]): string {
	const lines: string[] = [];
	const head = before
		? 'case | track | steady | excess before | excess after | spikes before | spikes after | darkest before | darkest after'
		: 'case | track | steady | worst | excess | spikes | darkest | brightest';
	lines.push(head);
	lines.push(head.replace(/[^|]/g, '-'));
	for (const r of rows) {
		const b = before?.find((x) => x.name === r.name && x.track === r.track);
		lines.push(
			before
				? `${r.name} | ${r.track} | ${r.steady.toFixed(1)} | ${b ? num(b.excess ?? b.worst, 1) : '?'} | ${num(r.excess ?? r.worst, 1)} | ${b ? b.spikes : '?'} | ${r.spikes} | ${b ? b.darkest.toFixed(0) : '?'} | ${r.darkest.toFixed(0)}`
				: `${r.name} | ${r.track} | ${r.steady.toFixed(1)} | ${r.worst.toFixed(1)} | ${num(r.excess, 1)} | ${r.spikes} | ${r.darkest.toFixed(0)} | ${r.brightest.toFixed(0)}`
		);
	}
	return lines.join('\n');
}

const before = compare
	? (JSON.parse(readFileSync(compare, 'utf8')) as { results: Result[] }).results
	: undefined;
console.log(table(results, before));
if (out) {
	writeFileSync(out, JSON.stringify({ core: coreDir, cache, results }, null, '\t'));
	console.error(`wrote ${out}`);
}
