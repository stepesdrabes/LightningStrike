import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { pulse } from '../dsl/wave.ts';
import { Follower, PulseEnv } from '../dsl/env.ts';
import { bandBetween, spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Delay the duck across the room so the layer preserves spatial structure under the stack. */
export const pump: EffectDef = {
	id: 'pump',
	name: 'Pump',
	role: 'rhythm',
	blurb: 'The room pulses on the downbeat, or ducks on every kick. Duck mode is the EDM signature.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		kit: 'kick'
	},
	params: [
		INTENSITY,
		param('duck', 'Duck mode', 1, 0, 1, 1),
		param('depth', 'Depth', 0.78),
		param('decay', 'Decay beats', 0.5, 0.1, 2),
		param('sweep', 'How far the duck lags across the room', 0.5)
	],
	create(g) {
		const env = new PulseEnv();
		// Smooth beat energy for passage level.
		const passage = new Follower(0.08, 0.6);
		/**
		 * Move colour over about a bar; faster slot changes would add a competing brightness
		 * envelope.
		 */
		const tone = new Follower(0.18, 0.7);
		// When kicks disappear, the bar grid retains the ducking groove.
		let drive = 0;
		let base = 0;

		// The room's depth axis, normalised, so the duck can travel along it.
		let lo = Infinity;
		let hi = -Infinity;
		for (let i = 0; i < g.count; i++) {
			if (g.ny[i] < lo) lo = g.ny[i];
			if (g.ny[i] > hi) hi = g.ny[i];
		}
		const span = hi - lo || 1;

		return {
			reset() {
				env.reset();
				passage.reset();
				tone.reset();
				drive = 0;
				base = 0;
			},
			render(out, ctx) {
				const { f, p, palette, motion } = ctx;
				// Keep sustain at half scale so the duck retains visible contrast.
				base = envelope(base, clamp(0.55 + 0.3 * passage.update(f.energy, f.dt)), f.dt, 0.06, 0.4);
				drive = envelope(drive, clamp(f.kickEnv * 1.4), f.dt, 0.01, f.beatPeriod * 3);

				// Keep depth lag below roughly a fifth of the gesture so the room still reads
				// as one pump.
				const lag = p.sweep * 0.18;

				// Spectral tilt and low-end strength set palette reach.
				const bright = bandBetween(f, 0.45, 1);
				const colour = tone.update(clamp(spectralTilt(f) * 0.7 + bright * 0.6), f.dt);

				// Low gain leaves headroom for the three additive layers above this field.
				const gain = p.intensity * 0.45;
				const decayed =
					p.duck > 0.5 ? 0 : env.decay(f.dt, f.beatPeriod, p.decay / Math.max(0.05, motion));
				if (p.duck <= 0.5 && f.downbeat) env.fire(1);

				for (let i = 0; i < g.count; i++) {
					// Map depth to both delayed ducking and a palette gradient, preserving
					// spatial variety.
					const depth = (g.ny[i] - lo) / span;
					const slot =
						lerp(SLOT.base, SLOT.third, depth * (0.45 + colour * 0.55)) + ctx.hueShift;
					let level: number;
					if (p.duck > 0.5) {
						// Delay the beat phase, not envelope amplitude, so the far wall
						// receives the same duck shape.
						const phase = f.beatPhase - depth * lag;
						const grid = (1 - drive) * pulse(phase - Math.floor(phase), 5);
						const duck = Math.max(clamp(f.kickEnv) * (1 - depth * lag * 2.2), grid);
						level = base * (1 - duck * p.depth);
					} else {
						const held = Math.max(0, decayed - depth * lag);
						level = base * (1 - p.depth + held * p.depth);
					}
					setSample(out, i, palette, slot, level * gain);
				}
			}
		};
	}
};
