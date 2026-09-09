import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { pulse } from '../dsl/wave.ts';
import { Follower, PulseEnv } from '../dsl/env.ts';
import { bandBetween, spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The duck is the groove: the gap a kick carves out of everything else is what an ear hears as
 * the pump, so this is one gesture the whole room shares.
 *
 * It arrives across the room rather than everywhere at once. A sidechain in a physical space
 * reaches the far wall after the near one, and the room is five metres deep; without the lag
 * this filled 83% of the room with one flat level and one flat hue, which is a layer that
 * swamps everything mixed under it while saying less than any of them.
 */
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
		// The passage's own level. `f.energy` is beat resolution whatever it is passed through,
		// so this only ever says how loud the passage is, and it belongs slow.
		const passage = new Follower(0.08, 0.6);
		/**
		 * Which of the show's colours the room pumps in.
		 *
		 * Slow, and deliberately not the level: the slots differ in luminance as well as hue, so
		 * a colour driven at the speed of the kick is a second brightness envelope fighting the
		 * first. This walks over about a bar, so it reads as the passage changing rather than as
		 * the room flickering.
		 */
		const tone = new Follower(0.18, 0.7);
		// How much kick there is to duck against. A sidechain with no kick under it is a flat
		// wall of colour, so as this fades the bar grid takes the groove over.
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
				// The sustain sits at half of full: the duck is the gesture, and a room that is
				// white between kicks has nowhere to duck from that the eye can see.
				base = envelope(base, clamp(0.55 + 0.3 * passage.update(f.energy, f.dt)), f.dt, 0.06, 0.4);
				drive = envelope(drive, clamp(f.kickEnv * 1.4), f.dt, 0.01, f.beatPeriod * 3);

				// How far behind the near wall the far one is, as a fraction of the ducking
				// gesture. Small: past about a fifth the room stops reading as one pump and starts
				// reading as two.
				const lag = p.sweep * 0.18;

				// Where the mix is sitting decides which colour the room pumps in, and how much
				// low end there is decides how deep into it. A bass-only passage stays home; one
				// that has opened up at the top answers in the third.
				const bright = bandBetween(f, 0.45, 1);
				const colour = tone.update(clamp(spectralTilt(f) * 0.7 + bright * 0.6), f.dt);

				// Low on purpose: this is a wall of colour under three other layers, and the mixer
				// adds them before gamma. Alone it is dim; in a stack it is a fifth of the sum.
				const gain = p.intensity * 0.45;
				const decayed =
					p.duck > 0.5 ? 0 : env.decay(f.dt, f.beatPeriod, p.decay / Math.max(0.05, motion));
				if (p.duck <= 0.5 && f.downbeat) env.fire(1);

				for (let i = 0; i < g.count; i++) {
					// 0 at the near wall, 1 at the far one. The duck reaches here this much later,
					// and the far wall also sits further up the palette: the room pumps as a
					// gradient rather than as one colour, and how far the gradient opens is how
					// far the mix has opened. A single slot written to every pixel is what made
					// this one flat hue across 83% of the room.
					const depth = (g.ny[i] - lo) / span;
					const slot =
						lerp(SLOT.base, SLOT.third, depth * (0.45 + colour * 0.55)) + ctx.hueShift;
					let level: number;
					if (p.duck > 0.5) {
						// Sidechain: the gap the kick carves out IS the groove. The lag is taken off
						// the beat phase rather than off the envelope, so the far wall ducks to the
						// same shape a moment later instead of to a shallower one.
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
