import { makePalette } from '../color/palette.ts';
import { describe, expect, it } from 'vitest';
import { MASTER, quantize } from '../output.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { Mixer } from '../mixer.ts';
import { BUILT_IN_EFFECTS } from './index.ts';
import { runGate, scriptFrames } from './gate.ts';

const g = buildGeometry(DEFAULT_ROOM);

// One gate run per effect, shared by the per-effect blocks and the aggregate below. The gate
// renders a 21-bar journey at 60 fps, so a second full pass over the catalog is half a minute
// of duplicate work inside a single test's timeout.
const GATE = new Map(BUILT_IN_EFFECTS.map((d) => [d.id, runGate(d, g)] as const));

describe.each(BUILT_IN_EFFECTS.map((d) => [d.id, d] as const))('%s', (_id, def) => {
	const result = GATE.get(def.id)!;

	it('passes the admission gate', () => {
		expect(result.failures).toEqual([]);
	});

	it('declares taste metadata the linter can use', () => {
		expect(def.taste.sections.length).toBeGreaterThan(0);
		expect(def.taste.energy).toBeGreaterThanOrEqual(1);
		expect(def.taste.energy).toBeLessThanOrEqual(5);
		expect(def.taste.maxBars).toBeGreaterThanOrEqual(def.taste.minBars);
	});

	it('exposes an intensity param unless it is pure darkness', () => {
		if (def.id === 'blackout') return;
		expect(def.params.some((p) => p.key === 'intensity')).toBe(true);
	});
});

it('every effect emits light', () => {
	const dark = BUILT_IN_EFFECTS.filter((d) => !GATE.get(d.id)!.producesLight).map((d) => d.id);
	expect(dark).toEqual([]);
});

/**
 * How much of the room an effect lights, and how much of that is in the brightest tenth of the
 * pixels. Run through the mixer rather than off the effect's own buffer, so it is gamma and the
 * output chain that decide what counts as lit.
 */
function coverage(def: (typeof BUILT_IN_EFFECTS)[number]): {
	fill: number;
	top10: number;
	balance: number;
} {
	const mixer = new Mixer(g);
	mixer.palette = makePalette({ base: 0, accent: 180, third: 60 });
	mixer.intensity = 1;
	mixer.floor = 0;
	mixer.layers[def.role].setEffect(def, g);

	let lit = 0;
	let pixels = 0;
	let concentration = 0;
	let counted = 0;
	const levels: number[] = [];
	const perStrip = new Float64Array(g.strips.length);

	for (const f of scriptFrames()) {
		mixer.render(f);
		const n = mixer.bytes.length / 3;
		levels.length = 0;
		let total = 0;
		for (let k = 0; k < n; k++) {
			const i = k * 3;
			const v = Math.max(mixer.bytes[i], mixer.bytes[i + 1], mixer.bytes[i + 2]);
			pixels++;
			// Byte 24, not byte 8: gamma 2.2 leaves byte 8 barely distinguishable from off, and
			// a spotlight in a black room scores full marks against it.
			if (v >= 24) lit++;
			levels.push(v);
			total += v;
		}
		if (total < 1) continue;
		levels.sort((a, b) => b - a);
		const tenth = Math.max(1, Math.round(n / 10));
		let top = 0;
		for (let k = 0; k < tenth; k++) top += levels[k];
		concentration += top / total;
		counted++;

		for (const [si, strip] of g.strips.entries()) {
			let sum = 0;
			for (let k = 0; k < strip.count; k++) {
				const i = (strip.offset + k) * 3;
				sum += Math.max(mixer.bytes[i], mixer.bytes[i + 1], mixer.bytes[i + 2]);
			}
			perStrip[si] += sum / strip.count;
		}
	}

	// Dimmest wall against brightest. Neither `fill` nor `top10` can see a field that lights
	// half the room perfectly evenly and leaves the other half dark, which is what a waterline
	// or a front-of-room spotlight does and what a photograph of an intro showed as a bright
	// beam over near-black walls.
	let dimmest = Infinity;
	let brightest = 0;
	for (const v of perStrip) {
		if (v < dimmest) dimmest = v;
		if (v > brightest) brightest = v;
	}
	return {
		fill: pixels > 0 ? lit / pixels : 0,
		top10: counted > 0 ? concentration / counted : 1,
		balance: brightest > 1e-6 ? dimmest / brightest : 0
	};
}

/**
 * `carries` is what the planner trusts when it picks the one texture over a bed in a quiet cue,
 * so an effect claiming it and not meaning it is not a documentation slip: it is a dark room.
 * Three accents claimed it by omission and could not, and one of them was what lit an intro as
 * a single bright wall with the rest of the room at byte 20.
 */
it('every effect claiming to carry a room can actually fill one', () => {
	// Beds and accents only: those are the two layers a quiet cue is made of, and the only two
	// the planner ever asks to carry. A transient is a one-shot by definition and a master is
	// fired by punctuation the gate script does not contain.
	const liars = BUILT_IN_EFFECTS.filter(
		(d) => (d.role === 'bed' || d.role === 'accent') && d.taste.carries !== false && d.id !== 'blackout'
	)
		.map((d) => ({ id: d.id, role: d.role, ...coverage(d) }))
		// A bed IS the room in a quiet cue, so what it owes is evenness: a third of its light in
		// a tenth of the pixels means the rest of the room is the dark between the bright parts,
		// which is what a photograph of an intro showed. An accent sits on top of a bed, so it is
		// held to reaching the room rather than to filling it evenly.
		.filter((r) =>
			r.role === 'bed'
				? r.top10 > 0.32 || r.fill < 0.22 || r.balance < 0.35
				: r.top10 > 0.55 || r.fill < 0.22
		)
		.map(
			(r) =>
				`${r.id} (fills ${(100 * r.fill).toFixed(0)}%, ${(100 * r.top10).toFixed(0)}% of it in a tenth of the pixels, dimmest wall ${(100 * r.balance).toFixed(0)}% of the brightest)`
		);
	expect(liars).toEqual([]);
});

it('offers more than one carrying accent for the passages that need one', () => {
	// A quiet cue is a bed and one texture, and the planner requires that texture to carry.
	// With a single candidate every intro in every show gets the same one.
	for (const section of ['intro', 'outro', 'breakdown'] as const) {
		const pool = BUILT_IN_EFFECTS.filter(
			(d) => d.role === 'accent' && d.taste.carries !== false && d.taste.sections.includes(section)
		);
		expect(pool.length, `carrying accents for ${section}`).toBeGreaterThanOrEqual(2);
	}
});

it('blackout reads as darkness next to the wash it replaces', () => {
	const mean = (id: string) => {
		const def = BUILT_IN_EFFECTS.find((d) => d.id === id)!;
		const effect = def.create(g);
		const out = new Float32Array(g.count * 3);
		const frames = scriptFrames();
		const p: Record<string, number> = {};
		for (const spec of def.params) p[spec.key] = spec.default;
		const ctx = {
			g,
			f: frames[0],
			p,
			palette: makePalette({ base: 320, accent: 185 }),
			hueShift: 0,
			motion: 1
		};
		let sum = 0;
		for (const f of frames.slice(0, 600)) {
			ctx.f = f;
			effect.render(out, ctx);
			for (let i = 0; i < out.length; i++) sum += out[i];
		}
		return sum / (600 * out.length);
	};

	expect(mean('blackout')).toBeLessThan(mean('wash') * 0.05);
});

it('ids are unique', () => {
	const ids = BUILT_IN_EFFECTS.map((d) => d.id);
	expect(new Set(ids).size).toBe(ids.length);
});

describe('output stage', () => {
	it('drives an LED for the eye, not for a monitor', () => {
		// The exponent is gamma, not 1/gamma. An LED is linear in PWM duty and the eye is not,
		// so half-brightness is about 22 per cent duty. Encoding the sRGB way round drives it at
		// 73 per cent and every show comes out pale.
		// Against MASTER rather than 255, because the dimmer is a scale on the encoder's output
		// and not a change of curve: what this pins is the exponent's direction, which shows up
		// as half-brightness landing near a fifth of full scale rather than near three quarters.
		const full = Math.round(255 * MASTER);
		const buf = Float32Array.from([1, 0.5, 0.25, 0, 0, 0]);
		const out = new Uint8Array(6);
		quantize(buf, out, 2.2);
		expect(out[0]).toBe(full);
		expect(out[1] / full).toBeGreaterThan(0.19);
		expect(out[1] / full).toBeLessThan(0.25);
		expect(out[2] / full).toBeGreaterThan(0.03);
		expect(out[2] / full).toBeLessThan(0.07);
		expect(out[3]).toBe(0);
	});

	it('never shimmers a full-scale pixel', () => {
		// Full scale is whatever the master leaves of 255. What must not vary is that every dither
		// position agrees on it.
		const full = Math.round(255 * MASTER);
		const buf = new Float32Array(24).fill(1);
		const out = new Uint8Array(24);
		quantize(buf, out, 2.2);
		for (const byte of out) expect(byte).toBe(full);
	});

	it('keeps deep shades reachable rather than crushing them to black', () => {
		// The reason for 2.2 over Adafruit's 2.8, which puts everything under 0.1 on zero.
		const buf = Float32Array.from([0.1, 0.15, 0.2]);
		const out = new Uint8Array(3);
		quantize(buf, out, 2.2);
		for (const byte of out) expect(byte).toBeGreaterThan(0);
	});
});
