import { describe, expect, it } from 'vitest';
import type { EffectDef } from './contracts/effect.ts';
import { createShowFrame } from './contracts/frame.ts';
import { DEFAULT_ROOM, buildGeometry } from './geometry.ts';
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

	/**
	 * Halfway means halfway in LIGHT, not halfway in the authoring number.
	 *
	 * These values are gamma-encoded on the way to the wire, so an LED's output goes as the square
	 * of them. Mixing them arithmetically halves both looks at the midpoint and lands at a fifth of
	 * the light, which is a handover anyone in the room can see dipping. Squares in, root out, so
	 * the square of the result is the midpoint even though the result itself is not.
	 */
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
	// `frame` is read after `compose`, before the output chain, so the numbers are the scale
	// arithmetic and nothing else: master opacity 1, blend add, headroom 1.4.
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
