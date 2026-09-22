/**
 * node bench/parity.ts --core DIR [--cache DIR] [--ids A,B,C] [--tracks N]
 *
 * Renders the same work through this checkout's core and another's (`--core`, its `src`
 * directory) and reports the first frame where they differ: the Frame's geometry, every
 * built-in effect over the gate journey, and cached shows through the room director and its
 * lamp across play, a seek, a pause into rest, lounge and a resume. A refactor that must not
 * change a show proves it here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Geometry, Show, TrackAnalysis } from '@mv/core';
import { benchmarkCache } from './cache.ts';

type Core = typeof import('@mv/core');

const args = process.argv.slice(2);
const option = (flag: string): string | undefined => {
	const i = args.indexOf(flag);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const baseDir = option('--core');
if (!baseDir) throw new Error('--core <other checkout>/packages/core/src is required');
const cache = benchmarkCache(option('--cache'));
const wanted = option('--ids')?.split(',');
const trackLimit = Number(option('--tracks') ?? 8);

const load = async (dir: string): Promise<Core> =>
	(await import(pathToFileURL(join(resolve(dir), 'index.ts')).href)) as Core;
const here = await load(join(import.meta.dirname, '..', 'packages', 'core', 'src'));
const base = await load(baseDir);

let failures = 0;
function report(label: string, difference: string | null): void {
	if (difference) failures++;
	console.log(`${difference ? 'DIFFERS' : 'same   '}  ${label}${difference ? `: ${difference}` : ''}`);
}

function firstDifference(a: ArrayLike<number>, b: ArrayLike<number>): string | null {
	if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
	for (let i = 0; i < a.length; i++) {
		if (!Object.is(a[i], b[i])) return `index ${i}: ${a[i]} vs ${b[i]}`;
	}
	return null;
}

// 1. Geometry.
const gBase = base.buildGeometry(base.DEFAULT_ROOM);
const gHere = here.buildGeometry(here.DEFAULT_ROOM);
const fields = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'r', 'theta', 'dist', 'strip', 'local', 'perim', 'normal'] as const;
for (const f of fields) report(`geometry ${f}`, firstDifference(gBase[f], gHere[f]));
for (const f of ['count', 'pitch', 'extent', 'perimeterLength'] as const) {
	report(`geometry ${f}`, gBase[f] === gHere[f] ? null : `${gBase[f]} vs ${gHere[f]}`);
}
const stripKeys = (g: Geometry) =>
	JSON.stringify(g.strips.map((s) => [s.id, s.name, s.offset, s.count, s.start, s.end, s.normal, s.inPerimeter]));
report('geometry strips', stripKeys(gBase) === stripKeys(gHere) ? null : `${stripKeys(gBase)}\n  vs ${stripKeys(gHere)}`);

// 2. Every built-in effect over the gate journey.
const framesBase = base.scriptFrames(130);
const framesHere = here.scriptFrames(130);
for (const defBase of base.BUILT_IN_EFFECTS) {
	const defHere = here.BUILT_IN_EFFECTS.find((d) => d.id === defBase.id);
	if (!defHere) {
		report(`effect ${defBase.id}`, 'missing here');
		continue;
	}
	const run = (core: Core, def: typeof defBase, g: Geometry, frames: typeof framesBase) => {
		const effect = def.create(g);
		const p: Record<string, number> = {};
		for (const spec of def.params) p[spec.key] = spec.default;
		if ('trigger' in p) p.trigger = 1;
		const ctx = { g, f: frames[0], p, palette: core.makePalette({ base: 320, accent: 185 }), hueShift: 0, motion: 1 };
		const out = new Float32Array(g.count * 3);
		const snapshots: Float32Array[] = [];
		for (const f of frames) {
			ctx.f = f;
			effect.render(out, ctx);
			snapshots.push(Float32Array.from(out));
		}
		return snapshots;
	};
	const a = run(base, defBase, gBase, framesBase);
	const b = run(here, defHere, gHere, framesHere);
	let difference: string | null = null;
	for (let i = 0; i < a.length && !difference; i++) {
		const d = firstDifference(a[i], b[i]);
		if (d) difference = `frame ${i}, ${d}`;
	}
	report(`effect ${defBase.id}`, difference);
}

// 3. Cached shows through the director, lamp included.
function tracks(): { id: string; analysis: TrackAnalysis; show: Show }[] {
	if (!existsSync(cache)) return [];
	const ids = wanted ?? readdirSync(cache).filter((f) => f.endsWith('.show.json')).map((f) => f.slice(0, -'.show.json'.length));
	const out: { id: string; analysis: TrackAnalysis; show: Show }[] = [];
	for (const id of ids) {
		const a = join(cache, `${id}.analysis.json`);
		const s = join(cache, `${id}.show.json`);
		if (!existsSync(a) || !existsSync(s)) continue;
		const analysis = JSON.parse(readFileSync(a, 'utf8')) as TrackAnalysis;
		const show = JSON.parse(readFileSync(s, 'utf8')) as Show;
		if (show.analysisHash !== analysis.hash) continue;
		out.push({ id, analysis, show });
		if (out.length >= trackLimit) break;
	}
	return out;
}

/** The first lamp's bytes, wherever this checkout keeps them. */
function lampBytes(director: object): Uint8Array {
	const d = director as { bounce?: Uint8Array; lamps?: Uint8Array };
	return d.lamps ?? d.bounce!;
}

type Step = { t: number; playing: boolean; lounge: boolean; seek?: boolean };
function journey(analysis: TrackAnalysis): Step[] {
	const dt = 1 / 60;
	const drop = analysis.sections.find((s) => s.kind === 'drop' || s.kind === 'chorus')?.start ?? 30;
	const steps: Step[] = [];
	let t = 0;
	const play = (seconds: number, lounge = false) => {
		for (let i = 0; i < seconds * 60; i++, t += dt) steps.push({ t, playing: true, lounge });
	};
	const hold = (seconds: number) => {
		for (let i = 0; i < seconds * 60; i++) steps.push({ t, playing: false, lounge: false });
	};
	play(12);
	t = drop;
	steps.push({ t, playing: true, lounge: false, seek: true });
	play(10);
	hold(9);
	play(5);
	play(8, true);
	play(4);
	return steps;
}

for (const track of tracks()) {
	const directors = [base, here].map((core) => {
		const g = core === base ? gBase : gHere;
		const d = new core.RoomDirector(g, new core.EffectRegistry());
		d.load(track.analysis, track.show);
		return d;
	});
	let difference: string | null = null;
	const steps = journey(track.analysis);
	for (let i = 0; i < steps.length && !difference; i++) {
		const s = steps[i];
		for (const d of directors) {
			if (s.seek) d.seek();
			d.update(s.t, 1 / 60, { playing: s.playing, hasShow: true, lounge: s.lounge, rest: true });
		}
		const bytes = firstDifference(directors[0].bytes, directors[1].bytes);
		const lamp = firstDifference(lampBytes(directors[0]), lampBytes(directors[1]));
		if (bytes) difference = `frame ${i} bytes ${bytes}`;
		else if (lamp) difference = `frame ${i} lamp ${lamp}`;
	}
	report(`show ${track.id} (${track.show.title ?? ''}, ${steps.length} frames)`, difference);
}

console.log(failures === 0 ? '\nidentical' : `\n${failures} difference(s)`);
process.exitCode = failures === 0 ? 0 : 1;
