import { describe, expect, it } from 'vitest';
import { makePalette } from '../color/palette.ts';
import { createShowFrame } from '../contracts/frame.ts';
import type { RenderCtx } from '../contracts/effect.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { kitTicks } from './kitTicks.ts';

const g = buildGeometry(DEFAULT_ROOM);
const palette = makePalette({ base: 30, accent: 210, third: 60 });
const beam = g.strips.find((s) => !s.inPerimeter)!;

function ctxFor(f = createShowFrame()): RenderCtx {
	f.beatPeriod = 0.5;
	f.dt = 1 / 60;
	f.level = 0.7;
	return { g, f, palette, hueShift: 0, motion: 1,
		p: Object.fromEntries(kitTicks.params.map((param) => [param.key, param.default])) };
}

/** Brightest pixel on the beam and where it sits, 0..1 along the strip. */
function beamPeak(out: Float32Array): { value: number; at: number } {
	let value = 0;
	let at = 0;
	for (let i = 0; i < beam.count; i++) {
		const k = beam.offset + i;
		const v = Math.max(out[k * 3], out[k * 3 + 1], out[k * 3 + 2]);
		if (v > value) {
			value = v;
			at = i / (beam.count - 1);
		}
	}
	return { value, at };
}

describe('kit ticks', () => {
	it('marks a hat where it falls in the bar and lets it go within a beat', () => {
		const effect = kitTicks.create(g);
		const ctx = ctxFor();
		const out = new Float32Array(g.count * 3);
		ctx.f.barPhase = 0.75;
		ctx.f.hat = true;
		ctx.f.hatEnv = 0.9;
		effect.render(out, ctx);
		const struck = beamPeak(out);
		expect(struck.value).toBeGreaterThan(0.2);
		expect(struck.at).toBeCloseTo(0.75, 1);
		ctx.f.hat = false;
		for (let k = 1; k <= 30; k++) {
			ctx.f.t = k / 60;
			effect.render(out, ctx);
		}
		expect(beamPeak(out).value).toBeLessThan(struck.value * 0.05);
	});

	it('strokes a snare wider than a hat tick and softens both where the record is quiet', () => {
		const widthOf = (voice: 'hat' | 'snare', level: number) => {
			const effect = kitTicks.create(g);
			const ctx = ctxFor();
			ctx.f.level = level;
			for (let k = 0; k < 30; k++) effect.render(new Float32Array(g.count * 3), ctx);
			const out = new Float32Array(g.count * 3);
			ctx.f.barPhase = 0.5;
			ctx.f[voice] = true;
			ctx.f[voice === 'hat' ? 'hatEnv' : 'snareEnv'] = 0.9;
			effect.render(out, ctx);
			const peak = beamPeak(out).value;
			let lit = 0;
			for (let i = 0; i < beam.count; i++) {
				const k = beam.offset + i;
				if (Math.max(out[k * 3], out[k * 3 + 1], out[k * 3 + 2]) > peak * 0.3) lit++;
			}
			return { lit, peak };
		};
		expect(widthOf('snare', 0.7).lit).toBeGreaterThan(widthOf('hat', 0.7).lit * 2);
		expect(widthOf('hat', 0).peak).toBeLessThan(widthOf('hat', 0.9).peak * 0.6);
	});

	it('clears its marks on reset', () => {
		const effect = kitTicks.create(g);
		const ctx = ctxFor();
		const out = new Float32Array(g.count * 3);
		ctx.f.kick = true;
		ctx.f.kickEnv = 1;
		effect.render(out, ctx);
		expect(beamPeak(out).value).toBeGreaterThan(0);
		effect.reset();
		ctx.f.kick = false;
		effect.render(out, ctx);
		expect(beamPeak(out).value).toBe(0);
	});
});
