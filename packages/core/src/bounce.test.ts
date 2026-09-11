import { describe, expect, it } from 'vitest';
import { createShowFrame } from './contracts/frame.ts';
import { SLOT } from './contracts/palette.ts';
import { makePalette, sample } from './color/palette.ts';
import { BounceLamp } from './bounce.ts';
import { FlashEnvelope } from './dsl/env.ts';

const PALETTE = makePalette({ base: 320, accent: 185 });
const DT = 1 / 60;

function room(level: number, pixels = 720): Float32Array {
	return new Float32Array(pixels * 3).fill(level);
}

function run(frames: number, level: number, kick = 0): Uint8Array {
	const lamp = new BounceLamp();
	const out = new Uint8Array(3);
	const f = createShowFrame();
	const lit = room(level);
	const tint = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);
	for (let i = 0; i < frames; i++) {
		f.kickEnv = kick;
		lamp.render(lit, f, tint, DT, out);
	}
	return out;
}

const brightness = (b: Uint8Array) => Math.max(b[0], b[1], b[2]);

describe('the bounce lamp', () => {
	it('is dark when the room is', () => {
		expect([...run(120, 0)]).toEqual([0, 0, 0]);
	});

	it('holds a floor rather than going out under a quiet passage', () => {
		expect(brightness(run(240, 0.05))).toBeGreaterThan(0);
	});

	it('is brighter in a drop than in an intro', () => {
		expect(brightness(run(240, 0.9))).toBeGreaterThan(brightness(run(240, 0.28)));
	});

	function onHit(strength: number): Uint8Array {
		const lamp = new BounceLamp();
		const out = new Uint8Array(3);
		const f = createShowFrame();
		const lit = room(0.5);
		const tint = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);
		for (let i = 0; i < 240; i++) lamp.render(lit, f, tint, DT, out);
		f.kickEnv = strength;
		lamp.render(lit, f, tint, DT, out);
		return out.slice();
	}

	it('drives the colour to full scale on a hit and rests well below it', () => {
		expect(brightness(onHit(1))).toBe(255);
		expect(brightness(onHit(0))).toBeLessThan(160);
	});

	// Every hit must move the lamp, including quiet kicks.
	it('answers a quiet hit as well as a hard one', () => {
		expect(brightness(onHit(0.2))).toBeGreaterThan(brightness(onHit(0)));
		expect(brightness(onHit(1))).toBeGreaterThan(brightness(onHit(0.2)));
	});

	// The show keeps the white gate dark; saturated accents must stay saturated on the wire.
	it('never desaturates the accent to ask for white', () => {
		for (const strength of [0, 0.2, 1]) {
			const out = onHit(strength);
			expect(Math.min(...out)).toBeLessThan(brightness(out) * 0.12);
		}
	});

	it('answers a kick on the frame it arrives on', () => {
		const lamp = new BounceLamp();
		const out = new Uint8Array(3);
		const f = createShowFrame();
		const lit = room(0.4);
		const tint = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);

		for (let i = 0; i < 240; i++) lamp.render(lit, f, tint, DT, out);
		const settled = brightness(out);

		f.kickEnv = 1;
		lamp.render(lit, f, tint, DT, out);
		expect(brightness(out)).toBeGreaterThan(settled);

		// And lets go of it: ~100 ms, so six frames is most of the way back down.
		f.kickEnv = 0;
		const hit = brightness(out);
		for (let i = 0; i < 12; i++) lamp.render(lit, f, tint, DT, out);
		expect(brightness(out)).toBeLessThan(hit);
	});

	it('holds its passage glow through snares and hats without extra flashes', () => {
		const lamp = new BounceLamp();
		const out = new Uint8Array(3);
		const f = createShowFrame();
		const lit = room(0.5);
		const tint = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);
		for (let i = 0; i < 240; i++) lamp.render(lit, f, tint, DT, out);
		const settled = [...out];
		for (let i = 0; i < 60; i++) {
			f.snareEnv = i % 15 === 0 ? 1 : 0;
			f.hatEnv = 1;
			lamp.render(lit, f, tint, DT, out);
			expect([...out]).toEqual(settled);
		}
	});

	it.each([30, 60, 120])('lets fast kicks separate at %i fps without a second release tail', (fps) => {
		const lamp = new BounceLamp();
		const env = new FlashEnvelope();
		const out = new Uint8Array(3);
		const f = createShowFrame();
		const lit = room(0.8);
		const tint = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);
		for (let i = 0; i < fps * 4; i++) lamp.render(lit, f, tint, 1 / fps, out);
		const bed = brightness(out);
		env.fire();
		f.kickEnv = env.update(1 / fps);
		lamp.render(lit, f, tint, 1 / fps, out);
		const peak = brightness(out);
		for (let i = 1; i < fps / 4; i++) {
			f.kickEnv = env.update(1 / fps);
			lamp.render(lit, f, tint, 1 / fps, out);
		}
		expect(peak).toBe(255);
		expect(brightness(out) - bed).toBeLessThan((peak - bed) * 0.15);
	});

	it('keeps an authored blackout dark even during a kick', () => {
		expect([...run(1, 0, 1)]).toEqual([0, 0, 0]);
	});

	// Hue must not change the strongest channel at a given level.
	it('puts the same level on the wire whatever the accent hue is', () => {
		const at = (accent: number) => {
			const lamp = new BounceLamp();
			const out = new Uint8Array(3);
			const f = createShowFrame();
			const lit = room(0.9);
			const tint = sample(makePalette({ base: 320, accent }), SLOT.accent, 1, [0, 0, 0]);
			for (let i = 0; i < 240; i++) lamp.render(lit, f, tint, DT, out);
			return brightness(out);
		};
		const levels = [0, 60, 120, 185, 240, 300].map(at);
		expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(1);
	});

	it('shows the palette accent, not the room colour', () => {
		const out = run(240, 0.9);
		const accent = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);
		const order = (v: number[]) => [...v.keys()].sort((a, b) => v[b] - v[a]);
		expect(order([...out])).toEqual(order([...accent]));
	});

	it('is deterministic, so a seek reproduces the frame', () => {
		expect([...run(180, 0.6, 0.4)]).toEqual([...run(180, 0.6, 0.4)]);
	});

	it('starts again from a reset', () => {
		const lamp = new BounceLamp();
		const fresh = new Uint8Array(3);
		const reused = new Uint8Array(3);
		const f = createShowFrame();
		const tint = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);

		for (let i = 0; i < 300; i++) lamp.render(room(0.9), f, tint, DT, reused);
		lamp.reset();
		for (let i = 0; i < 30; i++) lamp.render(room(0.2), f, tint, DT, reused);

		const other = new BounceLamp();
		for (let i = 0; i < 30; i++) other.render(room(0.2), f, tint, DT, fresh);
		expect([...reused]).toEqual([...fresh]);
	});
});
