import { describe, expect, it } from 'vitest';
import type { EffectDef } from '../contracts/effect.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { makePalette } from '../color/palette.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { BUILT_IN_EFFECTS } from './index.ts';
import { halftimeBounce } from './halftimeBounce.ts';

const g = buildGeometry(DEFAULT_ROOM);
const palette = makePalette({ base: 330, accent: 165 });

function kickFrame(def: EffectDef, strength: number) {
	const effect = def.create(g);
	const f = createShowFrame();
	f.dt = 1 / 60;
	f.section = 'chorus';
	f.energy = 0.8;
	f.bands.fill(0.4);
	f.spectrum.fill(0.3);
	f.beatPhase = 0.37;
	f.barPhase = 0.2;
	const out = new Float32Array(g.count * 3);
	const ctx = { f, g, palette, hueShift: 0, motion: 1, p: Object.fromEntries(def.params.map(p => [p.key, p.default])) };
	for (let i = 0; i < 120; i++) {
		f.t = i * f.dt;
		effect.render(out, ctx);
	}
	f.t += f.dt;
	f.kick = strength > 0;
	f.kickEnv = strength;
	effect.render(out, ctx);
	return out;
}

const level = (pixels: Float32Array) => {
	let sum = 0;
	for (let i = 0; i < pixels.length; i += 3) sum += Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
	return sum / g.count;
};

const lifted = (pixels: Float32Array, rest: Float32Array) => {
	let sum = 0;
	for (let i = 0; i < pixels.length; i += 3) {
		const before = Math.max(rest[i], rest[i + 1], rest[i + 2]);
		const after = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
		sum += Math.max(0, after - before);
	}
	return sum / g.count;
};

describe('individual kick accents', () => {
	it.each(BUILT_IN_EFFECTS.filter(e => e.taste.kickAccent))('$id accents a kick immediately without a beat event', (def) => {
		const rest = kickFrame(def, 0);
		const ghost = kickFrame(def, 0.25);
		const strong = kickFrame(def, 1);
		expect(level(strong) - level(rest)).toBeGreaterThan(0.025);
		// A ghost kick may concentrate light in the corners while dimming the wall centres.
		expect(lifted(ghost, rest)).toBeGreaterThan(0);
		expect(lifted(ghost, rest)).toBeLessThan(lifted(strong, rest) * 0.65);
	});

	it('lifts Halftime Bounce in place without adding a competing movement or color', () => {
		const rest = kickFrame(halftimeBounce, 0);
		const struck = kickFrame(halftimeBounce, 1);
		const gain = level(struck) / level(rest);
		expect(gain).toBeGreaterThan(1.8);
		expect(gain).toBeLessThan(2.5);
		for (let i = 0; i < rest.length; i++) expect(struck[i]).toBeCloseTo(rest[i] * gain, 5);
	});
});
