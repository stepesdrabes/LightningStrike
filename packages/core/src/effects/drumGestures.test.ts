import { describe, expect, it } from 'vitest';
import type { RenderCtx } from '../contracts/effect.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { makePalette } from '../color/palette.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { FlashEnvelope } from '../dsl/env.ts';
import { Mixer } from '../mixer.ts';
import { BUILT_IN_EFFECTS } from './index.ts';

const g = buildGeometry(DEFAULT_ROOM);
const palette = makePalette({ base: 320, accent: 175, third: 260 });

interface Hit {
	t: number;
	power: number;
}

interface Reading {
	t: number;
	mean: number;
	peak: number;
	fill: number;
	pale: number;
	raw: number;
}

function render(id: string, hits: Hit[], fps = 60, duration = 2.5): Reading[] {
	const def = BUILT_IN_EFFECTS.find((d) => d.id === id)!;
	const mixer = new Mixer(g);
	mixer.palette = palette;
	mixer.intensity = 0.85;
	mixer.motion = 1.2;
	mixer.layers[def.role].setEffect(def, g);
	const f = createShowFrame();
	f.dt = 1 / fps;
	f.beatPeriod = 0.5;
	f.section = 'chorus';
	f.energy = 0.8;
	f.bands.fill(0.5);
	f.spectrum.fill(0.3);
	const env = new FlashEnvelope();
	const readings: Reading[] = [];
	for (let k = 0; k < Math.round(duration * fps); k++) {
		f.t = k / fps;
		f.beat = k % (fps / 2) === 0;
		f.beatIndex = Math.floor(k / (fps / 2));
		f.beatPhase = (k % (fps / 2)) / (fps / 2);
		const hit = hits.find((h) => Math.round(h.t * fps) === k);
		if (hit) env.fire(hit.power);
		const strength = env.update(f.dt);
		f.snare = id === 'snareBlade' && !!hit;
		f.kick = id !== 'snareBlade' && !!hit;
		f.snareEnv = id === 'snareBlade' ? strength : 0;
		f.kickEnv = id !== 'snareBlade' ? strength : 0;
		mixer.render(f);
		let mean = 0;
		let peak = 0;
		let fill = 0;
		let pale = 0;
		let raw = 0;
		for (let i = 0; i < g.count; i++) {
			const at = i * 3;
			const r = mixer.bytes[at];
			const gr = mixer.bytes[at + 1];
			const b = mixer.bytes[at + 2];
			const v = Math.max(r, gr, b);
			mean += v;
			peak = Math.max(peak, v);
			if (v >= 24) fill++;
			if (v >= 100 && Math.min(r, gr, b) / v > 0.5) pale++;
			const buf = mixer.layers[def.role].buf;
			raw += Math.max(buf[at], buf[at + 1], buf[at + 2]);
		}
		readings.push({ t: f.t, mean: mean / g.count, peak, fill: fill / g.count, pale: pale / g.count, raw: raw / g.count });
	}
	return readings;
}

const maximum = (rows: Reading[], key: keyof Omit<Reading, 't'>) => Math.max(...rows.map((r) => r[key]));
const during = (rows: Reading[], from: number, to: number) => rows.filter((r) => r.t >= from && r.t < to);

describe('Snare Blade', () => {
	it('lands immediately as a focused coloured stroke, with room left around it', () => {
		const rows = render('snareBlade', [{ t: 0.5, power: 1 }]);
		const hit = during(rows, 0.5, 0.62);
		expect(hit[0].mean).toBeGreaterThan(5);
		expect(maximum(hit, 'fill')).toBeGreaterThanOrEqual(0.1);
		expect(maximum(hit, 'fill')).toBeLessThan(0.25);
		expect(maximum(hit, 'pale')).toBe(0);
		expect(maximum(hit, 'peak')).toBeLessThan(235);
	});

	it('keeps repeated snare strokes from accumulating brighter cores', () => {
		const single = render('snareBlade', [{ t: 0.5, power: 1 }]);
		const roll = render('snareBlade', Array.from({ length: 8 }, (_, i) => ({ t: 0.5 + i / 8, power: 1 })));
		expect(maximum(roll, 'peak')).toBeLessThanOrEqual(maximum(single, 'peak') * 1.05);
		expect(maximum(roll, 'pale')).toBe(0);
	});

	it('does not lend an earlier loud snare to the next ghost note', () => {
		const ghost = render('snareBlade', [{ t: 1.5, power: 0.2 }]);
		const afterLoud = render('snareBlade', [{ t: 0.5, power: 1 }, { t: 1.5, power: 0.2 }]);
		const weak = maximum(during(ghost, 1.5, 1.7), 'raw');
		const next = maximum(during(afterLoud, 1.5, 1.7), 'raw');
		expect(next).toBeLessThanOrEqual(weak * 1.08);
	});
});

describe('Ember Bump', () => {
	it('answers a kick with real light and releases its background between hits', () => {
		const rows = render('emberBump', [{ t: 0.5, power: 1 }]);
		expect(maximum(during(rows, 0, 0.5), 'mean')).toBe(0);
		expect(maximum(during(rows, 0.5, 0.62), 'mean')).toBeGreaterThan(8);
		expect(maximum(during(rows, 1.2, 2), 'mean')).toBeLessThan(0.1);
	});
});

describe('Splash', () => {
	it('gives the first kick the same footprint as later equal kicks', () => {
		const rows = render('splash', [{ t: 0.5, power: 1 }, { t: 1.5, power: 1 }]);
		const first = during(rows, 0.5, 0.6);
		const next = during(rows, 1.5, 1.6);
		expect(maximum(first, 'fill')).toBeGreaterThan(0.06);
		expect(maximum(first, 'mean') / maximum(next, 'mean')).toBeGreaterThan(0.9);
		expect(maximum(first, 'mean') / maximum(next, 'mean')).toBeLessThan(1.1);
		expect(maximum(rows, 'pale')).toBe(0);
	});

	it('uses kick velocity independently of the coarse sub envelope', () => {
		const def = BUILT_IN_EFFECTS.find((d) => d.id === 'splash')!;
		const result: number[] = [];
		for (const sub of [0, 1]) {
			const effect = def.create(g);
			const out = new Float32Array(g.count * 3);
			const f = createShowFrame();
			f.kick = true;
			f.kickEnv = 0.7;
			f.bands[0] = sub;
			const ctx: RenderCtx = { g, f, palette, motion: 1, hueShift: 0, p: Object.fromEntries(def.params.map((p) => [p.key, p.default])) };
			effect.render(out, ctx);
			result.push(out.reduce((sum, v) => sum + v, 0));
		}
		expect(result[0]).toBeGreaterThan(0);
		expect(result[0]).toBeCloseTo(result[1], 6);
	});
});

describe.each(['snareBlade', 'emberBump', 'splash'])('%s musical response', (id) => {
	it('stays dark without detected drum events despite an active beat grid', () => {
		expect(maximum(render(id, []), 'mean')).toBe(0);
	});

	it('keeps ghost hits softer than full hits', () => {
		const weak = render(id, [{ t: 0.5, power: 0.25 }]);
		const strong = render(id, [{ t: 0.5, power: 1 }]);
		expect(maximum(weak, 'raw')).toBeLessThan(maximum(strong, 'raw') * 0.4);
		expect(maximum(weak, 'raw')).toBeGreaterThan(0);
	});

	it('preserves delivered pulse energy across playback frame rates', () => {
		const hits = Array.from({ length: 7 }, (_, i) => ({ t: 0.5 + i * 0.5, power: i % 2 === 0 ? 1 : 0.6 }));
		const energy = [30, 60, 120].map((fps) => {
			const rows = render(id, hits, fps, 4.5);
			return rows.reduce((sum, r) => sum + r.mean, 0) / rows.length;
		});
		expect((Math.max(...energy) - Math.min(...energy)) / energy[1], energy.join(', ')).toBeLessThan(0.15);
	});
});
