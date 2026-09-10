// What the Bounce Lamp actually makes, all the way through its own firmware.
//
//   node bench/lampprobe.ts                  # every cached track, one row each
//   node bench/lampprobe.ts sicko            # one track, with the per-section table
//   node bench/lampprobe.ts sicko            # one track, with the per-section table
//
// The lamp is two halves that can each make it dim, and the complaint "too dim, no punch" does
// not say which. Host-side, `bounce.ts` decides a level; board-side, `lamp/src/fixture.rs`
// decides what is done with it. So this reports both:
//
//   `wire` is what leaves the host, as a share of full scale on the strongest channel, and `top`
//   is the highest that channel ever reached over the whole track. `top` under 100 means the show
//   never asked this fixture for everything it has.
//   `light` is what the fixture makes of it, as a share of what its three colour dies could emit
//   together. The white gate is dark during a show, so it is not in this number.
//
// `punch` is the direct question, asked the way `punchprobe` asks it of the room: at each kick,
// how much brighter is the lamp within 120 ms (the eye's integration window and a little) than
// it was in the 120 ms before? A RATIO, so it survives a recalibration - 1.0 is a lamp that does
// not answer the kit at all, 2.0 is a doubling, and the weakest tenth beside the median is what
// separates a lamp that answers every kick from one that answers the loud ones and sleeps
// through the rest.
//
// `light` and `peak` are per-hue and cannot be compared across tracks with different accents: a
// hue is one die, and green has about three times the luminance of red and four times blue.
//
// Measured 2026-09-10 over the seven cached tracks, across the round (ranges over the per-track
// columns, `punch` as the median of the medians). The middle rows spent the white phosphors and
// are kept as a record of what that bought and cost:
//
//                            wire%   light%    peak%   punch
//   at the start of the day   18-35  1.2-2.8  1.8-6.7  1.3x
//   phosphors above a knee    31-44  1.2-5.7   18-26   5.0x
//   that knee at full duty    46-61  1.7-8.2   80-92   20x
//   an emitter class each     72-86   17-41    98-99   3.0x
//
// Those four all normalise `light`/`peak` against a fixture that includes the white gate, so they
// do not compare with what ships, which is the dies alone:
//
//                            wire%  top%  kick%  light%  peak%  punch
//   dies only, no phosphor    35-49  100  90-96   6-31   24-71  2.0-2.5x
//
// `top` and `kick` are the answer to "is this the full potential of the LED": the strongest die
// reaches full scale on every track, and a typical kick gets it to nine tenths. The rest of the
// spread is the kit's own dynamics. The phosphors went because they outnumber the dies on this
// reel, so any share of them large enough to see is large enough to pale the accent, and their
// weight against a hue depends on which die that hue is.
//
// Read `light%` and `peak%` together with `punch`, never `punch` alone. The 20x row reached it by
// resting near black.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	DEFAULT_ROOM,
	RoomDirector,
	buildGeometry,
	sectionBase,
	type SectionKind,
	type TrackAnalysis,
	type TrackContext
} from '@mv/core';
import { CACHE_DIR } from '@mv/analysis';
import { composeShow } from '@mv/author-engine';

const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? Number(argv[i + 1]) : undefined;
};
const wanted = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));

/** Relative luminous output of each gate at full duty, the three colour dies summing to one. */
const LUM = [0.21, 0.65, 0.14];
/** `TRIM` in `lamp/src/fixture.rs`, 256 unity. Kept in step by hand. The white gate is dark. */
const TRIM = [256, 256, 256];

const FPS = 60;
const DT = 1 / FPS;
/** The eye integrates over roughly this long, and perceived brightness peaks inside it. */
const WINDOW = 0.12;

/**
 * One frame of `director.bounce` as the board would light it: `present` in `lamp/src/fixture.rs`.
 *
 * Returns light rather than duty, as a share of what all four gates could emit at once. The
 * bytes arrive gamma-encoded, so they are already linear in light and the only steps left are
 * the white derivation and the trim.
 */
function fixtureLight(px: Uint8Array): number {
	const gate = (v: number, trim: number) => (v / 255) * (trim / 256);
	return LUM[0] * gate(px[0], TRIM[0]) + LUM[1] * gate(px[1], TRIM[1]) + LUM[2] * gate(px[2], TRIM[2]);
}

/** What left the host, before the fixture has an opinion: the strongest channel, 0..1. */
function wireLevel(px: Uint8Array): number {
	return Math.max(px[0], px[1], px[2]) / 255;
}

interface Sample {
	t: number;
	light: number;
	wire: number;
	kick: boolean;
	section: SectionKind;
}

async function walk(id: string): Promise<Sample[] | null> {
	let analysis: TrackAnalysis;
	try {
		analysis = JSON.parse(await readFile(join(CACHE_DIR, `${id}.analysis.json`), 'utf8')) as TrackAnalysis;
	} catch {
		return null;
	}
	let context: TrackContext | null = null;
	try {
		context = JSON.parse(await readFile(join(CACHE_DIR, `${id}.context.json`), 'utf8')) as TrackContext;
	} catch {
		// Uncontexted is a legal state.
	}
	const meta = JSON.parse(await readFile(join(CACHE_DIR, `${id}.meta.json`), 'utf8')) as {
		artHue?: number | null;
	};

	const director = new RoomDirector(buildGeometry(DEFAULT_ROOM));
	director.load(analysis, composeShow(analysis, { artHue: meta.artHue, context }));

	const out: Sample[] = [];
	const state = { playing: true, hasShow: true, lounge: false, rest: true };
	for (let n = 0; n * DT < analysis.duration; n++) {
		const t = n * DT;
		const f = director.update(t, DT, state);
		out.push({
			t,
			light: fixtureLight(director.bounce),
			wire: wireLevel(director.bounce),
			kick: f.kick,
			section: f.section
		});
	}
	return out;
}

const pct = (sorted: number[], p: number) =>
	sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];

/** The strongest channel each kick actually reached, sorted. 1.0 means the die went to full. */
function kickPeaks(samples: Sample[]): number[] {
	const span = Math.round(WINDOW * FPS);
	const out: number[] = [];
	for (let i = 0; i < samples.length - span; i++) {
		if (!samples[i].kick) continue;
		let top = 0;
		for (let j = i; j < i + span; j++) top = Math.max(top, samples[j].wire);
		out.push(top);
	}
	return out.sort((a, b) => a - b);
}

/**
 * How much brighter each kick made the lamp than the window before it.
 *
 * Both windows are `WINDOW` long: the max after against the mean before, because a hit is a peak
 * and a bed is an average. A floor on the denominator keeps a kick landing in a blackout from
 * reporting an infinite punch it did not deliver.
 */
function punches(samples: Sample[]): number[] {
	const span = Math.round(WINDOW * FPS);
	const out: number[] = [];
	for (let i = span; i < samples.length - span; i++) {
		if (!samples[i].kick) continue;
		let before = 0;
		for (let j = i - span; j < i; j++) before += samples[j].light;
		before /= span;
		let after = 0;
		for (let j = i; j < i + span; j++) after = Math.max(after, samples[j].light);
		out.push(after / Math.max(before, 0.004));
	}
	return out.sort((a, b) => a - b);
}

const metas = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.meta.json'));
interface Row {
	title: string;
	wire: number;
	wireTop: number;
	kickTop: number;
	light: number;
	peak: number;
	weak: number;
	punch: number;
	best: number;
}
const rows: Row[] = [];

for (const file of metas) {
	const meta = JSON.parse(await readFile(join(CACHE_DIR, file), 'utf8')) as { id: string; title: string };
	if (wanted.length > 0 && !wanted.some((w) => meta.title.toLowerCase().includes(w.toLowerCase()))) continue;

	const samples = await walk(meta.id);
	if (!samples) continue;

	const lit = samples.filter((s) => s.light > 0);
	const light = lit.map((s) => s.light).sort((a, b) => a - b);
	const wire = lit.map((s) => s.wire).sort((a, b) => a - b);
	const p = punches(samples);

	rows.push({
		title: meta.title.slice(0, 30),
		wire: pct(wire, 50),
		wireTop: wire.length > 0 ? wire[wire.length - 1] : 0,
		kickTop: pct(kickPeaks(samples), 50),
		light: pct(light, 50),
		peak: pct(light, 99),
		weak: pct(p, 10),
		punch: pct(p, 50),
		best: pct(p, 99)
	});

	if (wanted.length > 0) {
		console.log(`\n${meta.title}`);
		const kinds = [...new Set(samples.map((s) => sectionBase(s.section)))];
		console.log('  section      wire%  light%   bed%   hit%   swing');
		for (const kind of kinds) {
			const inKind = samples.filter((s) => sectionBase(s.section) === kind);
			const l = inKind.map((s) => s.light).sort((a, b) => a - b);
			const w = inKind.map((s) => s.wire).sort((a, b) => a - b);
			const bed = pct(l, 10);
			const hit = pct(l, 95);
			console.log(
				`  ${kind.padEnd(11)}${(pct(w, 50) * 100).toFixed(1).padStart(6)}` +
					`${(pct(l, 50) * 100).toFixed(1).padStart(8)}${(bed * 100).toFixed(1).padStart(7)}` +
					`${(hit * 100).toFixed(1).padStart(7)}${(hit / Math.max(bed, 0.002)).toFixed(2).padStart(8)}x`
			);
		}
	}
}

console.log(`\n${FPS} fps, colour dies only\n`);
console.log('track                            wire%   top%   kick%  light%   peak%    weak  punch');
for (const r of rows.sort((a, b) => b.punch - a.punch)) {
	console.log(
		`${r.title.padEnd(32)}${(r.wire * 100).toFixed(1).padStart(6)}${(r.wireTop * 100).toFixed(1).padStart(7)}${(r.kickTop * 100).toFixed(1).padStart(8)}${(r.light * 100).toFixed(1).padStart(8)}` +
			`${(r.peak * 100).toFixed(1).padStart(8)}${r.weak.toFixed(2).padStart(8)}x${r.punch.toFixed(2).padStart(6)}x`
	);
}
