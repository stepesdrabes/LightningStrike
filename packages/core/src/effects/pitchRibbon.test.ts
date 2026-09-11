import { describe, expect, it } from 'vitest';
import { makePalette } from '../color/palette.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { pitchRibbon } from './pitchRibbon.ts';
import { runGate } from './gate.ts';

const g = buildGeometry(DEFAULT_ROOM);
const home = Array.from({ length: g.count }, (_, i) => i).filter((i) => g.perim[i] < 0);

function setup(fps = 60) {
	const effect = pitchRibbon.create(g);
	const out = new Float32Array(g.count * 3);
	const f = createShowFrame();
	f.dt = 1 / fps;
	f.beatPeriod = 0.48;
	f.energy = 0.8;
	f.bands.fill(0.8);
	f.spectrum.fill(0.18);
	const ctx = { g, f, palette: makePalette({ base: 320, accent: 170, third: 245 }), motion: 1.25, hueShift: 0,
		p: Object.fromEntries(pitchRibbon.params.map((p) => [p.key, p.default])) };
	const render = (frames = 1) => { for (let i = 0; i < frames; i++) effect.render(out, ctx); };
	render(fps * 2);
	return { f, out, render };
}

const levels = (out: Float32Array) => home.map((i) => Math.max(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]));
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const centre = (values: number[]) => values.reduce((sum, v, i) => sum + v * i, 0) / values.reduce((sum, v) => sum + v, 0);

describe('Pitch Ribbon', () => {
	it.each([30, 60, 120])('articulates an offbeat note at %i Hz without drums or coarse-band changes', (fps) => {
		const s = setup(fps);
		const before = mean(levels(s.out));
		s.f.spectrum.fill(0.65, 6, 14);
		s.render(Math.round(fps * 0.1));
		const attack = mean(levels(s.out));
		expect(attack).toBeGreaterThan(before * 2);
		s.render(fps * 3);
		expect(mean(levels(s.out))).toBeLessThan(attack * 0.75);
		s.f.spectrum.fill(0);
		s.render(fps * 2);
		expect(mean(levels(s.out))).toBeLessThan(0.001);
	});

	it('keeps competing spectral peaks in the same broad, coloured beam region', () => {
		const s = setup();
		for (const band of [6, 12, 7, 11]) {
			s.f.spectrum.fill(0.1);
			s.f.spectrum[band] = 0.9;
			s.render(30);
			const v = levels(s.out);
			expect(centre(v)).toBeCloseTo((home.length - 1) / 2, 4);
			expect(v.filter((x) => x > Math.max(...v) * 0.5).length / home.length).toBeGreaterThan(0.35);
			const at = home[Math.floor(home.length / 2)] * 3;
			const rgb = Array.from(s.out.subarray(at, at + 3));
			expect(Math.min(...rgb) / Math.max(...rgb)).toBeLessThan(0.4);
		}
	});

	it('does not chase cymbals or invent grid pulses over a sustained note', () => {
		const a = setup();
		const b = setup();
		for (let i = 0; i < 120; i++) {
			b.f.spectrum.fill(i % 2 ? 1 : 0.1, 15);
			b.f.beat = i % 30 === 0;
			b.f.downbeat = i % 120 === 0;
			b.f.hat = i % 15 === 0;
			b.f.hatEnv = b.f.hat ? 1 : 0;
			a.render(); b.render();
			expect(b.out).toEqual(a.out);
		}
	});

	it('passes the deterministic bounded-output gate', () => {
		expect(runGate(pitchRibbon, g).failures).toEqual([]);
	});
});
