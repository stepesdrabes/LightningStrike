/**
 * node bench/introprobe.ts [--id ID] [--cache DIR] [--analysis FILE] [--show FILE]
 *   [--before-analysis FILE] [--before-shows FILE] [--before-core DIR] [--out FILE]
 *
 * Intro reactivity of one track: delivered room bytes over the opening at 30, 60 and 120 Hz,
 * with the snares silenced, the level track flattened and the spectrum flattened in turn, the
 * lift around each snare, effect-state determinism after a backward seek, and whether anything
 * after the intro changed. The before side takes a frozen show snapshot and, optionally, a
 * frozen core source directory. The after-intro count only means something when both sides
 * share an analysis and the shows differ in the intro alone.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_ROOM, RoomDirector, buildGeometry, encodeBase64, decodeBase64, type Show, type TrackAnalysis } from '@mv/core';
import { composeShow } from '@mv/author-engine';
import { benchmarkCache } from './cache.ts';

const args = process.argv.slice(2);
const option = (flag: string): string | undefined => {
	const i = args.indexOf(flag);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const id = option('--id') ?? '9vWNauaZAgg';
const cache = benchmarkCache(option('--cache'));
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const meta = read<{ artHue?: number | null }>(join(cache, `${id}.meta.json`));
const contextPath = join(cache, `${id}.context.json`);
const context = existsSync(contextPath) ? read<Parameters<typeof composeShow>[1]['context']>(contextPath) : undefined;

const after = read<TrackAnalysis>(option('--analysis') ?? join(cache, `${id}.analysis.json`));
const afterShowPath = option('--show');
const afterShow = afterShowPath ? read<Show>(afterShowPath) : composeShow(after, { context, artHue: meta.artHue });
const before = read<TrackAnalysis>(option('--before-analysis') ?? join(cache, `${id}.analysis.json`));
const beforeShowsPath = option('--before-shows');
const beforeShow = beforeShowsPath
	? read<Record<string, Show>>(beforeShowsPath)[id]
	: composeShow(before, { context, artHue: meta.artHue });
if (!beforeShow) throw new Error(`${id} is not in ${beforeShowsPath}`);
const beforeCore = option('--before-core');
const BeforeDirector = beforeCore
	? ((await import(pathToFileURL(join(resolve(beforeCore), 'director.ts')).href)) as { RoomDirector: typeof RoomDirector }).RoomDirector
	: RoomDirector;
const out = option('--out');

const end = after.sections[0].endTime;
const g = buildGeometry(DEFAULT_ROOM);
const state = { playing: true, hasShow: true, lounge: false, rest: true };
const mean = (v: number[]) => v.reduce((sum, x) => sum + x, 0) / Math.max(1, v.length);
const range = (v: number[]) => Math.max(...v) - Math.min(...v);

function capture(analysis: TrackAnalysis, show: Show, fps: number, frozen = false) {
	const d = frozen ? new BeforeDirector(g) : new RoomDirector(g);
	d.load(analysis, show);
	const levels: number[] = [];
	const bytes: Uint8Array[] = [];
	const lamps: number[] = [];
	const snares: number[] = [];
	let peak = 0;
	for (let i = 0; i < Math.ceil(end * fps); i++) {
		const f = d.update(i / fps, 1 / fps, state);
		const l: number[] = [];
		for (let k = 0; k < g.count; k++) {
			const value = Math.max(d.bytes[k * 3], d.bytes[k * 3 + 1], d.bytes[k * 3 + 2]);
			l.push(value);
			peak = Math.max(peak, value);
		}
		levels.push(mean(l));
		lamps.push(Math.max(...d.bounce));
		bytes.push(Uint8Array.from(d.bytes));
		if (f.snare) snares.push(i / fps);
	}
	return { levels, bytes, lamps, snares, peak };
}

/** The same analysis with one evidence stream removed, to measure what it contributes. */
function without(analysis: TrackAnalysis, stream: 'snares' | 'level' | 'spectrum'): TrackAnalysis {
	const copy = structuredClone(analysis);
	if (stream === 'snares') copy.onsets.snare = { times: [], levels: [] };
	if (stream === 'level' && copy.level) {
		const data = decodeBase64(copy.level.data);
		const count = Math.min(Math.floor(end * copy.level.fps), data.length);
		let total = 0;
		for (let i = 0; i < count; i++) total += data[i];
		data.fill(Math.round(total / Math.max(1, count)), 0, count);
		copy.level = { ...copy.level, data: encodeBase64(data) };
	}
	if (stream === 'spectrum') {
		const data = decodeBase64(copy.spectrum.data);
		const bands = copy.spectrum.bands;
		const count = Math.min(Math.floor(end * copy.spectrum.fps), Math.floor(data.length / bands));
		for (let band = 0; band < bands; band++) {
			let total = 0;
			for (let frame = 0; frame < count; frame++) total += data[frame * bands + band];
			const average = Math.round(total / Math.max(1, count));
			for (let frame = 0; frame < count; frame++) data[frame * bands + band] = average;
		}
		copy.spectrum = { ...copy.spectrum, data: encodeBase64(data) };
	}
	return copy;
}

function delta(x: ReturnType<typeof capture>, y: ReturnType<typeof capture>) {
	let total = 0;
	let maximum = 0;
	for (let i = 0; i < x.bytes.length; i++) {
		for (let k = 0; k < x.bytes[i].length; k++) {
			const d = Math.abs(x.bytes[i][k] - y.bytes[i][k]);
			total += d;
			maximum = Math.max(maximum, d);
		}
	}
	return {
		meanChannelBytes: total / x.bytes.length / x.bytes[0].length,
		maximumChannelBytes: maximum,
		meanLevelBytes: mean(x.levels.map((v, i) => Math.abs(v - y.levels[i]))),
		maximumLampBytes: Math.max(...x.lamps.map((v, i) => Math.abs(v - y.lamps[i])))
	};
}

const summarize = (x: ReturnType<typeof capture>) => ({
	meanRoom: mean(x.levels), rangeRoom: range(x.levels), peakPixel: x.peak, snareEdges: x.snares
});

const results = [30, 60, 120].map((fps) => {
	const old = capture(before, beforeShow, fps, true);
	const current = capture(after, afterShow, fps);
	const ablations = Object.fromEntries((['snares', 'level', 'spectrum'] as const).map((stream) => [stream, {
		before: delta(old, capture(without(before, stream), beforeShow, fps, true)),
		after: delta(current, capture(without(after, stream), afterShow, fps))
	}]));
	const hits = after.onsets.snare.times.flatMap((time, index) => {
		if (time >= end) return [];
		const start = Math.max(0, Math.ceil((time - 0.04) * fps));
		const stop = Math.min(current.levels.length, Math.ceil((time + 0.17) * fps));
		const prior = Math.max(0, start - Math.ceil(0.133 * fps));
		const swing = (x: typeof old) => Math.max(...x.levels.slice(start, stop)) - mean(x.levels.slice(prior, start));
		return [{ time, strength: after.onsets.snare.levels[index], beforeRoomLift: swing(old), afterRoomLift: swing(current) }];
	});
	return { fps, before: summarize(old), after: summarize(current), ablations, hits };
});

// Effects in a director that replayed the intro must agree with fresh ones after a backward
// seek; layer buffers are compared because the output stages legitimately carry history.
const reused = new RoomDirector(g);
const fresh = new RoomDirector(g);
reused.load(after, afterShow);
fresh.load(after, afterShow);
for (let i = 0; i < Math.ceil(end * 60); i++) reused.update(i / 60, 1 / 60, state);
let seekMaximumDelta = 0;
for (let i = 30; i < Math.ceil(end * 60); i++) {
	reused.update(i / 60, 1 / 60, state);
	fresh.update(i / 60, 1 / 60, state);
	for (const role of ['bed', 'rhythm', 'transient', 'accent'] as const) {
		const x = reused.showMix.layers[role].buf;
		const y = fresh.showMix.layers[role].buf;
		for (let k = 0; k < x.length; k++) seekMaximumDelta = Math.max(seekMaximumDelta, Math.abs(x[k] - y[k]));
	}
}

// Everything after the intro should be untouched by an intro change.
const original = new BeforeDirector(g);
const current = new RoomDirector(g);
original.load(before, beforeShow);
current.load(after, afterShow);
let laterDifferences = 0;
let maxLater = 0;
for (let i = 0; i < Math.ceil(after.duration * 30); i++) {
	original.update(i / 30, 1 / 30, state);
	current.update(i / 30, 1 / 30, state);
	if (i / 30 < end + 3) continue;
	for (let k = 0; k < current.bytes.length; k++) {
		const d = Math.abs(current.bytes[k] - original.bytes[k]);
		if (d) laterDifferences++;
		maxLater = Math.max(maxLater, d);
	}
}

const report = {
	id, title: after.title, introEnd: end, cueBefore: beforeShow.cues[0], cueAfter: afterShow.cues[0],
	results, seekMaximumDelta, afterIntro: { differingChannels: laterDifferences, maxByteDelta: maxLater },
	frameRateMeanSpread: range(results.map((r) => r.after.meanRoom)) / Math.max(1e-6, results[1].after.meanRoom)
};
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
const r60 = results[1];
console.log(`${after.title}: intro ${end.toFixed(2)} s, room mean ${r60.before.meanRoom.toFixed(1)} -> ${r60.after.meanRoom.toFixed(1)} bytes, `
	+ `range ${r60.before.rangeRoom.toFixed(1)} -> ${r60.after.rangeRoom.toFixed(1)}, peak pixel ${r60.before.peakPixel} -> ${r60.after.peakPixel}`);
for (const [stream, a] of Object.entries(r60.ablations)) {
	console.log(`  without ${stream.padEnd(8)} mean level change ${a.before.meanLevelBytes.toFixed(2)} -> ${a.after.meanLevelBytes.toFixed(2)} bytes, max channel ${a.before.maximumChannelBytes} -> ${a.after.maximumChannelBytes}`);
}
for (const h of r60.hits) console.log(`  snare ${h.time.toFixed(2)} s (${h.strength.toFixed(2)}): room lift ${h.beforeRoomLift.toFixed(1)} -> ${h.afterRoomLift.toFixed(1)} bytes`);
console.log(`  frame-rate mean spread ${(100 * report.frameRateMeanSpread).toFixed(2)}%, seek max layer delta ${seekMaximumDelta.toFixed(4)}, after-intro differing channels ${laterDifferences} (max ${maxLater})`);
