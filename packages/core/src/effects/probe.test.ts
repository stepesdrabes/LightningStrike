import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { compileGenerated } from './sandbox.ts';
import { measureEffect } from './probe.ts';
import type { GeneratedEffect } from '../contracts/show.ts';

const geometry = buildGeometry(DEFAULT_ROOM);
const params = [{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 1 }];

function measure(id: string, source: string) {
	const gen: GeneratedEffect = { id, name: id, role: 'bed', blurb: '', params, source };
	const result = compileGenerated(gen, geometry);
	expect(result.failures).toEqual([]);
	return measureEffect(result.def!, geometry);
}

describe('fill and concentration', () => {
	it('separates a room-filling wash from a spotlight', () => {
		const wash = measure(
			'probeWash',
			`function create(g) { return { reset() {}, render(out, ctx) {
				for (let i = 0; i < g.count; i++) setSample(out, i, ctx.palette, SLOT.base, 0.8);
			} }; }`
		);
		const spot = measure(
			'probeSpot',
			`function create(g) { return { reset() {}, render(out, ctx) {
				out.fill(0);
				for (let i = 0; i < 8; i++) setSample(out, i, ctx.palette, SLOT.base, 1);
			} }; }`
		);

		expect(wash.fill).toBeGreaterThan(0.95);
		expect(spot.fill).toBeLessThan(0.02);
		// A wash spreads its light evenly, so its brightest tenth holds about a tenth of it.
		expect(wash.top10).toBeLessThan(0.15);
		expect(spot.top10).toBeGreaterThan(0.9);
	});
});

describe('palette fidelity', () => {
	// Palette fidelity must reject foreign hues while accepting colours emitted by the actual
	// ramp.
	it('passes an effect that addresses colour by slot', () => {
		const c = measure(
			'probeSlot',
			`function create(g) { return { reset() {}, render(out, ctx) {
				for (let i = 0; i < g.count; i++) setSample(out, i, ctx.palette, SLOT.accent, 0.9);
			} }; }`
		);
		expect(c.hue).toBeGreaterThan(0.99);
	});

	it('fails an effect that reaches past the palette for a hue of its own', () => {
		const c = measure(
			'probeRogue',
			`function create(g) { return { reset() {}, render(out, ctx) {
				for (let i = 0; i < g.count; i++) setPixel(out, i, 0.9, 0, 0.9);
			} }; }`
		);
		expect(c.hue).toBeLessThan(0.05);
	});
});

describe('reactivity', () => {
	it('scores zero for an effect that never reads the frame', () => {
		const c = measure(
			'probeDeaf',
			`function create(g) { return { reset() {}, render(out, ctx) {
				for (let i = 0; i < g.count; i++) setSample(out, i, ctx.palette, SLOT.base, 0.7);
			} }; }`
		);
		expect(c.react).toBeLessThan(0.02);
		expect(c.quiet).toBeLessThan(0.02);
	});

	it('scores an effect driven by the drums, and finds it still in a passage with none', () => {
		const c = measure(
			'probeDrums',
			`function create(g) { return { reset() {}, render(out, ctx) {
				for (let i = 0; i < g.count; i++) setSample(out, i, ctx.palette, SLOT.base, 0.2 + 0.8 * ctx.f.kickEnv);
			} }; }`
		);
		expect(c.react).toBeGreaterThan(0.05);
		// The whole point of the second column: an intro has no kit, so this holds still exactly
		// where the room was reported dead.
		expect(c.quiet).toBeLessThan(0.02);
	});

	it('scores an effect driven by the spectrum in both', () => {
		const c = measure(
			'probeSpectrum',
			`function create(g) { return { reset() {}, render(out, ctx) {
				for (let i = 0; i < g.count; i++) {
					setSample(out, i, ctx.palette, SLOT.base, 0.15 + 0.85 * bandAt(ctx.f, ringU(g, i)));
				}
			} }; }`
		);
		expect(c.react).toBeGreaterThan(0.05);
		expect(c.quiet).toBeGreaterThan(0.05);
	});
});
