import { describe, expect, it } from 'vitest';
import type { EffectDef } from './contracts/effect.ts';
import { createShowFrame } from './contracts/frame.ts';
import { DEFAULT_ROOM, buildGeometry } from './geometry.ts';
import { SLOT } from './contracts/palette.ts';
import { sample } from './color/palette.ts';
import { Mixer } from './mixer.ts';

const g = buildGeometry(DEFAULT_ROOM);

/** A flat field at a known level, so what comes out of the mixer is arithmetic rather than art. */
function flat(id: string, level: number): EffectDef {
	return {
		id,
		name: id,
		role: 'master',
		blurb: id,
		taste: { energy: 1, sections: ['intro'], minBars: 1, maxBars: 8, peakReserved: false },
		params: [],
		create: () => ({
			reset() {},
			render(out) {
				out.fill(level);
			}
		})
	};
}

const A = flat('a', 0.8);
const B = flat('b', 0.2);

/** The master layer is opacity 1 and blends `add`, so `frame` is the layer times the scale. */
function mixerAt(intensity: number): Mixer {
	const m = new Mixer(g);
	m.intensity = intensity;
	m.floor = 0;
	return m;
}

describe('Layer handover', () => {
	it('cuts with no fade, leaving nothing of the effect it replaced', () => {
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 1 / 60;

		m.layers.master.setEffect(A, g);
		m.compose(f);
		m.layers.master.setEffect(B, g);
		m.compose(f);

		expect(m.frame[0]).toBeCloseTo(0.2 * 1.4, 5);
	});

	/** Crossfades must preserve squared light at the midpoint, not halve the authoring values. */
	it('sits halfway between the two effects in light, halfway through a fade', () => {
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 0.5;

		m.layers.master.setEffect(A, g);
		m.compose(f);
		m.layers.master.setEffect(B, g, 1);
		m.compose(f);

		const light = (v: number) => v * v;
		expect(light(m.frame[0] / 1.4)).toBeCloseTo((light(0.8) + light(0.2)) / 2, 5);
		// And well above where an arithmetic mix would have put it.
		expect(m.frame[0]).toBeGreaterThan(0.5 * 1.4);
	});

	it('arrives on the incoming effect and stops rendering the outgoing one', () => {
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 1 / 60;

		m.layers.master.setEffect(A, g);
		m.compose(f);
		m.layers.master.setEffect(B, g, 0.5);
		for (let i = 0; i < 60; i++) m.compose(f);

		expect(m.frame[0]).toBeCloseTo(0.2 * 1.4, 5);
	});

	it('fades out to nothing when a scene drops a layer entirely', () => {
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 1 / 60;

		m.layers.master.setEffect(A, g);
		m.compose(f);
		m.layers.master.setEffect(null, g, 0.5);
		m.compose(f);
		// Still contributing on the way out, which is the whole point.
		expect(m.frame[0]).toBeGreaterThan(0.5);

		for (let i = 0; i < 60; i++) m.compose(f);
		expect(m.frame[0]).toBe(0);
	});

	it('forgets an outgoing effect on reset rather than fading it in later', () => {
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 1 / 60;

		m.layers.master.setEffect(A, g);
		m.compose(f);
		m.layers.master.setEffect(B, g, 5);
		m.compose(f);
		m.reset();
		m.compose(f);

		expect(m.frame[0]).toBeCloseTo(0.2 * 1.4, 5);
	});
});

describe('the hit floor', () => {
	// Inspect compose before output processing: master opacity 1, additive blend, headroom 1.4.
	const composed = (intensity: number, dim = 1): number => {
		const m = mixerAt(intensity);
		m.dim = dim;
		m.layers.master.setEffect(A, g);
		m.compose(createShowFrame());
		return m.frame[0];
	};

	it('renders a hit under a dimmed cue at the level a build would give it', () => {
		// The breath before a drop dims its cue to 0.31; the strobe inside it is a hit and
		// takes the floor's level instead.
		expect(composed(0.31)).toBeCloseTo(0.8 * 0.68 * 1.4, 5);
		expect(composed(0.31)).toBeCloseTo(composed(0.68), 5);
	});

	it('leaves a hit over a louder cue exactly where it was', () => {
		expect(composed(0.92)).toBeCloseTo(0.8 * 0.92 * 1.4, 5);
	});

	it('never floors a hit out of a blackout', () => {
		expect(composed(0.31, 0.02)).toBeCloseTo(0.8 * 0.68 * 1.4 * 0.02, 5);
	});

	it('keeps the other layers on the cue, not on the floor', () => {
		const m = mixerAt(0.31);
		const bed: EffectDef = { ...A, id: 'bed', role: 'bed' };
		m.layers.bed.setEffect(bed, g);
		m.layers.bed.opacity = 1;
		m.compose(createShowFrame());
		expect(m.frame[0]).toBeCloseTo(0.8 * 0.31 * 1.4, 5);
	});
});

describe('Mixer.finish', () => {
	it('freezes auto-exposure when it is told the room is not being measured', () => {
		const dim = flat('dim', 0.08);
		const lift = (alive: boolean) => {
			const m = mixerAt(1);
			m.layers.master.setEffect(dim, g);
			const f = createShowFrame();
			f.dt = 1 / 60;
			f.energy = 0.5;
			for (let i = 0; i < 60 * 90; i++) {
				f.t = i / 60;
				m.compose(f);
				m.finish(f, alive);
			}
			return m.bytes[0];
		};
		// Auto-exposure only ever lifts, so the difference is one-directional and unambiguous.
		expect(lift(true)).toBeGreaterThan(lift(false));
	});
});

describe('Layer replacement', () => {
	/** An effect that low-passes toward a level, the way trail and field effects do. */
	function settling(id: string, level: number, rate: number): EffectDef {
		return {
			...flat(id, level),
			create: () => ({
				reset() {},
				render(out) {
					for (let i = 0; i < out.length; i++) out[i] += (level - out[i]) * rate;
				}
			})
		};
	}

	it('starts a replacement from the frame it replaces rather than from black', () => {
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 1 / 60;
		m.layers.master.setEffect(A, g);
		m.compose(f);
		m.layers.master.setEffect(settling('s', 0.2, 0.5), g);
		m.compose(f);
		expect(m.frame[0]).toBeCloseTo(0.5 * 1.4, 5);
	});

	it('starts a layer that was empty from black', () => {
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 1 / 60;
		m.layers.master.setEffect(settling('s', 0.2, 0.5), g);
		m.compose(f);
		expect(m.frame[0]).toBeCloseTo(0.1 * 1.4, 5);
	});

	it('fades a new layer in from black when a scene adds one', () => {
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 0.5;
		m.layers.master.setEffect(A, g, 1);
		m.compose(f);
		expect(m.frame[0]).toBeCloseTo(Math.sqrt(0.5 * 0.64) * 1.4, 5);
	});

	it('renders an outgoing effect on the frame it was made for', () => {
		const byBar: EffectDef = {
			...flat('bar', 0),
			create: () => ({
				reset() {},
				render(out, ctx) {
					out.fill(ctx.f.barIndex / 10);
				}
			})
		};
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 0.5;
		f.barIndex = 5;
		m.layers.master.setEffect(byBar, g);
		m.compose(f);
		m.layers.master.setEffect(B, g, 1);
		const other = createShowFrame();
		other.barIndex = 8;
		m.outgoingFrame = other;
		f.barIndex = 0;
		m.compose(f);
		expect(m.frame[0]).toBeCloseTo(Math.sqrt(0.5 * 0.04 + 0.5 * 0.64) * 1.4, 5);
	});
});

describe('the transport fade', () => {
	it('takes the hits down with it but leaves the house floor lit', () => {
		const at = (fade: number) => {
			const m = mixerAt(1);
			m.floor = 0.5;
			m.fade = fade;
			m.layers.master.setEffect(A, g);
			const f = createShowFrame();
			f.dt = 1 / 60;
			m.compose(f);
			const lift = sample(m.palette, SLOT.base, 1)[0] * 0.5;
			return { lift, hit: (m.frame[0] - lift) / (1 - lift) };
		};
		const full = at(1);
		const half = at(0.5);
		expect(half.lift).toBe(full.lift);
		expect(half.hit).toBeCloseTo(full.hit * 0.5, 5);
	});
});

describe('a scene arriving at another opacity', () => {
	it('crossfades the opacity with the buffers instead of stepping the level', () => {
		const m = mixerAt(1);
		const f = createShowFrame();
		f.dt = 1 / 60;
		m.layers.master.opacity = 0.4;
		m.layers.master.setEffect(A, g);
		m.compose(f);
		const before = m.frame[0];
		m.layers.master.setEffect(B, g, 7);
		m.layers.master.opacity = 1;
		m.compose(f);
		expect(Math.abs(m.frame[0] - before)).toBeLessThan(before * 0.02);
		for (let i = 0; i < 60 * 8; i++) m.compose(f);
		expect(m.frame[0]).toBeCloseTo(0.2 * 1.4, 5);
	});
});
