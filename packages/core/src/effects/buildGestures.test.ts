import { describe, expect, it } from 'vitest';
import type { EffectDef } from '../contracts/effect.ts';
import { createShowFrame, type ShowFrame } from '../contracts/frame.ts';
import { STROBE_MAX_HZ } from '../contracts/show.ts';
import { makePalette } from '../color/palette.ts';
import { buildGeometry, DEFAULT_ROOM } from '../geometry.ts';
import { Mixer } from '../mixer.ts';
import { buildStrobe } from './buildStrobe.ts';
import { glitchScan } from './glitchScan.ts';

const g = buildGeometry(DEFAULT_ROOM);
const palette = makePalette({ base: 140, accent: 320 });

interface Options {
	fps?: number;
	duration?: number;
	bpm?: number;
	motion?: number;
	frame?: (f: ShowFrame) => void;
}

function performance(def: EffectDef, options: Options = {}) {
	const fps = options.fps ?? 60;
	const duration = options.duration ?? 8;
	const m = new Mixer(g);
	m.palette = palette;
	m.intensity = 0.68;
	m.motion = options.motion ?? 1;
	m.layers[def.role].setEffect(def, g);
	const f = createShowFrame();
	const rows: { t: number; raw: number; mean: number; peak: number; pale: number }[] = [];
	for (let k = 0; k < duration * fps; k++) {
		f.t = k / fps;
		f.dt = 1 / fps;
		f.beatPeriod = 60 / (options.bpm ?? 138);
		const beat = f.t / f.beatPeriod;
		f.beatIndex = Math.floor(beat);
		f.beatPhase = beat - f.beatIndex;
		f.barIndex = Math.floor(beat / 4);
		f.section = 'build';
		f.buildProgress = f.t / duration;
		f.energy = 0.8;
		f.spectrum.fill(0.8);
		options.frame?.(f);
		m.render(f);
		let raw = 0;
		let mean = 0;
		let peak = 0;
		let pale = 0;
		const out = m.layers[def.role].buf;
		for (let i = 0; i < g.count; i++) {
			const at = i * 3;
			raw += Math.max(out[at], out[at + 1], out[at + 2]);
			const v = Math.max(m.bytes[at], m.bytes[at + 1], m.bytes[at + 2]);
			mean += v;
			peak = Math.max(peak, v);
			if (v > 100 && Math.min(m.bytes[at], m.bytes[at + 1], m.bytes[at + 2]) / v > 0.5) pale++;
		}
		rows.push({ t: f.t, raw: raw / g.count, mean: mean / g.count, peak, pale: pale / g.count });
	}
	return rows;
}

const mean = (rows: ReturnType<typeof performance>) =>
	rows.reduce((total, row) => total + row.mean, 0) / rows.length;
const peaks = (rows: ReturnType<typeof performance>) =>
	rows.filter((row, i) => row.raw > 0.002 && (i === 0 || row.raw > rows[i - 1].raw * 1.4));

describe('Build Strobe', () => {
	it('leaves the entire first half of a build free of flashes', () => {
		const rows = performance(buildStrobe);
		expect(rows.filter((r) => r.t < 4).every((r) => r.raw === 0)).toBe(true);
		expect(rows.some((r) => r.t >= 4 && r.raw > 0.05)).toBe(true);
	});

	it('does not create a flash when changing subdivision between scheduled pulses', () => {
		const rows = performance(buildStrobe, {
			duration: 2,
			bpm: 120,
			frame: (f) => { f.buildProgress = f.t < 0.27 ? 0.6 : 0.82; }
		});
		const edges = peaks(rows).map((r) => r.t);
		expect(edges.slice(0, 3)).toEqual([0, 1, 1.25]);
	});

	it('keeps every pulse on the musical grid across the rate changes', () => {
		const fps = 120;
		const tempo = 60 / 138;
		for (const row of peaks(performance(buildStrobe, { fps }))) {
			const phase = row.t / tempo * 2;
			const sinceEdge = phase - Math.floor(phase + 1e-6);
			expect(sinceEdge).toBeLessThanOrEqual(2 / fps / tempo + 1e-6);
		}
	});

	it.each([60, 120, 180, 300])('respects the flash ceiling at %i bpm', (bpm) => {
		const fps = 120;
		const edges = peaks(performance(buildStrobe, {
			fps, bpm, duration: 3, motion: 1.8,
			frame: (f) => { f.buildProgress = 0.99; }
		}));
		expect(edges.length).toBeGreaterThan(2);
		for (let i = 1; i < edges.length; i++) {
			expect(edges[i].t - edges[i - 1].t).toBeGreaterThanOrEqual(1 / STROBE_MAX_HZ - 1 / fps);
		}
	});

	it('builds intensity and coverage while retaining headroom below a room-wide white flash', () => {
		const rows = performance(buildStrobe);
		const opening = rows.filter((r) => r.t >= 4 && r.t < 5.3);
		const finish = rows.filter((r) => r.t >= 6.8);
		expect(mean(finish)).toBeGreaterThan(mean(opening) * 3);
		expect(Math.max(...finish.map((r) => r.peak))).toBeGreaterThan(100);
		expect(Math.max(...rows.map((r) => r.peak))).toBeLessThan(225);
		expect(Math.max(...rows.map((r) => r.pale))).toBeLessThan(0.6);
	});

	it('articulates a vocal swell within the running pulse without adding a pulse edge', () => {
		const run = (notes: boolean) => performance(buildStrobe, {
			duration: 2, bpm: 120,
			frame: (f) => {
				f.buildProgress = 0.9;
				f.spectrum.fill(notes && f.t >= 1.25 && f.t < 1.4 ? 0.9 : 0.2);
			}
		});
		const played = run(true);
		const steady = run(false);
		expect(played[80].raw).toBeGreaterThan(steady[80].raw * 1.15);
		expect(peaks(played).map((r) => r.t)).toEqual(peaks(steady).map((r) => r.t));
	});
});

describe('Glitch Scan', () => {
	it('rests through quiet bars, including the former four-bar inversion', () => {
		const rows = performance(glitchScan, {
			frame: (f) => { f.energy = 0.04; f.spectrum.fill(0.04); }
		});
		expect(rows.every((r) => r.raw === 0)).toBe(true);
	});

	it('answers offbeat vocal swells with the beat and drum triggers held still', () => {
		const rows = performance(glitchScan, {
			duration: 2,
			frame: (f) => {
				f.beatIndex = 0;
				f.beatPhase = 0;
				f.energy = 0.04;
				f.spectrum.fill(f.t >= 0.137 && f.t < 0.34 ? 0.85 : 0.04);
			}
		});
		expect(rows.filter((r) => r.t < 0.137).every((r) => r.raw === 0)).toBe(true);
		expect(rows.some((r) => r.t >= 0.137 && r.t < 0.2 && r.mean > 0.2)).toBe(true);
		expect(rows.filter((r) => r.t >= 1).every((r) => r.mean === 0)).toBe(true);
	});

	it('keeps loud phrases punchy and coloured without raising an inverted background', () => {
		const rows = performance(glitchScan);
		expect(Math.max(...rows.map((r) => r.peak))).toBeGreaterThan(50);
		expect(Math.max(...rows.map((r) => r.pale))).toBe(0);
		expect(mean(rows.filter((r) => r.t >= 7))).toBeLessThan(mean(rows.filter((r) => r.t < 6)) * 1.5);
	});

	it('settles fully when a loud passage becomes quiet', () => {
		const rows = performance(glitchScan, {
			duration: 4,
			frame: (f) => { if (f.t >= 1) { f.energy = 0.04; f.spectrum.fill(0.04); } }
		});
		expect(rows.filter((r) => r.t >= 1.5).every((r) => r.mean === 0)).toBe(true);
	});
});

describe.each([buildStrobe, glitchScan])('$name playback stability', (def) => {
	it('keeps delivered light consistent across frame rates', () => {
		const levels = [30, 60, 120].map((fps) => mean(performance(def, { fps })));
		expect((Math.max(...levels) - Math.min(...levels)) / levels[1], levels.join(', ')).toBeLessThan(0.12);
	});

	it('replays after reset and holds an unchanged paused frame', () => {
		const effect = def.create(g);
		const out = new Float32Array(g.count * 3);
		const f = createShowFrame();
		const ctx = {
			g, f, palette, hueShift: 0, motion: 1,
			p: Object.fromEntries(def.params.map((p) => [p.key, p.default]))
		};
		const run = () => {
			const snapshots: Float32Array[] = [];
			for (let k = 0; k < 180; k++) {
				f.t = k / 60;
				f.dt = 1 / 60;
				f.beatPeriod = 0.5;
				f.beatIndex = Math.floor(f.t * 2);
				f.beatPhase = f.t * 2 - f.beatIndex;
				f.buildProgress = 0.5 + f.t / 6;
				f.energy = 0.7;
				f.spectrum.fill(0.45 + Math.sin(f.t * 7) * 0.3);
				effect.render(out, ctx);
				if (k % 15 === 0) snapshots.push(Float32Array.from(out));
			}
			return snapshots;
		};
		const first = run();
		effect.reset();
		out.fill(0);
		expect(run()).toEqual(first);
		const paused = Float32Array.from(out);
		f.dt = 0;
		for (let k = 0; k < 5; k++) effect.render(out, ctx);
		expect(out).toEqual(paused);
	});
});
