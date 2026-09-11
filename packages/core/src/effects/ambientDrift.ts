import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt, spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Slow drift ignores level. listen adds spectral position, palette reach and shallow band
 * relief;
 * per-band relief preserves articulation that sparse spectra lose in aggregate readings.
 */
export const ambientDrift: EffectDef = {
	id: 'ambientDrift',
	name: 'Ambient Drift',
	role: 'bed',
	blurb: 'Calm idle wash. Very slow, very dim, shaped by whatever little is playing.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0,
		quiet: 2.07
	},
	params: [INTENSITY, param('period', 'Period', 0.5), param('listen', 'How much it hears', 0.45)],
	create(g) {
		const lean = new BeatHold(0.4);
		const spread = new BeatHold(0.4);
		// Sample a few ring points and interpolate instead of allocating one latch per pixel.
		const TAPS = 10;
		const taps = Array.from({ length: TAPS }, () => new BeatHold(0.3));
		const held = new Float32Array(TAPS);
		let phase = 0;
		let heard = 0;
		let reach = 0;
		return {
			reset() {
				phase = 0;
				heard = 0;
				reach = 0;
				lean.reset();
				spread.reset();
				for (const t of taps) t.reset();
				held.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				phase += (f.dt / (30 + p.period * 30)) * motion;
				const gain = 0.5 + p.intensity * 0.6;

				// Latch and ease over bars so the gradient does not twitch.
				const ease = alphaFor(f.dt, Math.max(0.5, f.beatPeriod * 8));
				heard += (lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod) - heard) * ease;
				reach += (spread.update(spectrumFocus(f), f.beat, f.dt, f.beatPeriod) - reach) * ease;
				const listen = clamp(p.listen);

				// The spectrum moves colour and position; cue intensity owns the level.
				const slide = phase + (heard - 0.5) * listen * 0.9;
				const stretch = 0.7 + reach * listen * 0.5;
				// Keep spectral colour movement in base..glow, the nearly constant-flux
				// saturation span.
				const top = lerp(SLOT.base, SLOT.glow, clamp(reach * listen));

				for (let k = 0; k < TAPS; k++) {
					held[k] = taps[k].update(bandAt(f, k / (TAPS - 1)), f.beat, f.dt, f.beatPeriod);
				}
				// Unity-centred relief shapes the wash without dimming it; beat latching avoids
				// frame shimmer.
				const depth = 0.8 * listen;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const v = 0.35 + 0.65 * sinewave(u * stretch + slide);
					// Mirror low-to-high spectra from the front wall on both halves.
					const fold = (u < 0.5 ? u * 2 : (1 - u) * 2) * (TAPS - 1);
					const k = Math.min(TAPS - 2, Math.floor(fold));
					const band = held[k] + (held[k + 1] - held[k]) * (fold - k);
					const slot = lerp(SLOT.deep, top, v);
					const level = v * gain * (1 + depth * (band - 0.5));
					setSample(out, i, palette, slot + sinewave(phase * 0.3) * 0.06 + hueShift, level);
				}
			}
		};
	}
};
