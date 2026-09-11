import { describe, expect, it } from 'vitest';
import type { EffectDef } from '../contracts/effect.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { makePalette } from '../color/palette.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { Mixer } from '../mixer.ts';
import { harmonicRibbon } from './harmonicRibbon.ts';
import { vocalGlow } from './vocalGlow.ts';

const g = buildGeometry(DEFAULT_ROOM);

function setup(def: EffectDef, fps = 60) {
	const mixer = new Mixer(g);
	mixer.palette = makePalette({ base: 320, accent: 170, third: 260 });
	mixer.intensity = 0.54;
	mixer.floor = 0.34;
	mixer.motion = 0.5;
	mixer.layers.accent.setEffect(def, g);
	const f = createShowFrame();
	f.dt = 1 / fps;
	f.beatPeriod = 0.5;
	f.section = 'intro';
	f.energy = 0.2;
	f.bands.fill(0.2);
	f.spectrum.fill(0.25);
	for (let i = 0; i < fps * 2; i++) mixer.render(f);
	return { mixer, f };
}

function levels(mixer: Mixer): number[] {
	return Array.from({ length: g.count }, (_, i) =>
		Math.max(...mixer.bytes.subarray(i * 3, i * 3 + 3))
	);
}

function mean(values: number[]): number {
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe.each([vocalGlow, harmonicRibbon])('$id continuous note response', (def) => {
	it('makes an offbeat note visible with fixed tempo, drums and coarse bands', () => {
		const { mixer, f } = setup(def);
		const before = levels(mixer);
		// A middle-register note arrives halfway between beats. Only the continuous spectrum changes.
		f.spectrum.fill(0.8, 7, 16);
		for (let i = 0; i < 8; i++) mixer.render(f);
		const peak = levels(mixer);
		expect(mean(peak)).toBeGreaterThan(mean(before) * 1.18);
		expect(Math.max(...peak)).toBeLessThan(150);

		// The attack stays colored even at the brightest point in the voice.
		const at = peak.indexOf(Math.max(...peak)) * 3;
		const rgb = mixer.bytes.subarray(at, at + 3);
		expect(Math.min(...rgb) / Math.max(...rgb)).toBeLessThan(0.4);

		// Sustaining the note should relax, rather than pin its attack at full level.
		for (let i = 0; i < 150; i++) mixer.render(f);
		expect(mean(levels(mixer))).toBeLessThan(mean(peak) * 0.9);
	});

	it('keeps the note gesture in place while its level rises', () => {
		const { mixer, f } = setup(def);
		const before = Float32Array.from(mixer.layers.accent.buf);
		f.spectrum.fill(0.8, 7, 16);
		for (let i = 0; i < 8; i++) mixer.render(f);
		const after = mixer.layers.accent.buf;
		const beforeSum = before.reduce((sum, v) => sum + v, 0);
		const afterSum = after.reduce((sum, v) => sum + v, 0);
		let shapeChange = 0;
		for (let i = 0; i < before.length; i++) {
			shapeChange += Math.abs(before[i] / beforeSum - after[i] / afterSum);
		}
		expect(shapeChange).toBeLessThan(0.1);
	});

	it('does not invent a beat pulse over an unchanged sustained spectrum', () => {
		const a = setup(def);
		const b = setup(def);
		for (let i = 0; i < 180; i++) {
			b.f.beat = i % 30 === 0;
			b.f.beatIndex = Math.floor(i / 30);
			b.f.beatPhase = (i % 30) / 30;
			a.mixer.render(a.f);
			b.mixer.render(b.f);
			expect(b.mixer.bytes).toEqual(a.mixer.bytes);
		}
	});
});
